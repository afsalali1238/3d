#!/usr/bin/env python3
"""sculpt_face.py — give the mannequin head an actual face.

The BodyParts3D shell has a nose-shaped bump and two eye holes and that is it:
no lids, no lip line, no nostrils, no brow. Everything downstream (subdivision,
denoise, AO) only makes that smoother. This pass sculpts the missing anatomy
directly, as a sum of smooth analytic displacement fields evaluated in a head
frame that is measured from the mesh itself, so it works on both bodies and on
any future rescale.

Landmarks are detected, not hard-coded:
  * crown      = highest vertex of the head regions
  * chin       = lowest vertex of the jaw regions
  * nose tip   = front-most vertex in the mid-sagittal band of the mid face
  * eye line   = the vertical midpoint of the head, the classic canon, then
                 snapped to the socket concavity actually present in the mesh

Every feature is an anisotropic Gaussian in face-plane (x, y) coordinates,
weighted by how much the surface faces forward, and displaced along the vertex
normal. That keeps the sculpt watertight and region-preserving: no vertex is
added, removed or re-labelled, so the 81-region picking contract is untouched.

Usage:
  python3 scripts/sculpt_face.py build/male-hi.bvmesh build/male-face.bvmesh
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_render import load_mesh  # noqa: E402
from refine_body_mesh import area_weighted_normals, write_mesh  # noqa: E402

HEAD_REGIONS = (1, 2, 3, 4, 5, 6, 7)      # scalp, forehead, temples, face, jaws
FACE_REGIONS = (2, 3, 4, 5, 6, 7)


def log(msg):
    print(f"[face] {msg}", flush=True)


class Sculptor:
    """Accumulates displacement along the normal for the face vertices."""

    def __init__(self, pos, nrm, mask):
        self.pos = pos
        self.nrm = nrm
        self.mask = mask
        self.disp = np.zeros(len(pos))
        # >0 = hair (scalp, brows, lashes, stubble), <0 = lip vermilion
        self.tint = np.zeros(len(pos))
        # how frontal the surface is; the back of the head must never move
        self.front = np.clip(nrm[:, 2], 0.0, 1.0) ** 0.6 * mask

    def paint(self, w, value):
        """accumulate a tint mask (hair positive, lips negative)"""
        self.tint = np.where(
            np.abs(value * w) > np.abs(self.tint), value * w, self.tint
        )

    def blob(self, cx, cy, ax, ay, amount, power=1.0, zmin=None, facing=None):
        """anisotropic Gaussian bump/dent in face-plane coordinates"""
        x, y, z = self.pos[:, 0], self.pos[:, 1], self.pos[:, 2]
        d = ((x - cx) / ax) ** 2 + ((y - cy) / ay) ** 2
        w = np.exp(-d) ** power
        w = w * (self.front if facing is None else facing)
        if zmin is not None:
            w = w * (z > zmin)
        self.disp += amount * w
        return w

    def curve(self, cx, cy, half_width, sag, sigma, amount, taper=1.0):
        """groove/ridge along a shallow parabola  y = cy - sag*(x/half_width)^2"""
        x, y = self.pos[:, 0], self.pos[:, 1]
        t = (x - cx) / half_width
        line_y = cy - sag * t * t
        along = np.exp(-((t / taper) ** 4))          # flat-topped span, soft ends
        across = np.exp(-(((y - line_y) / sigma) ** 2))
        self.disp += amount * along * across * self.front


def measure(pos, rid):
    r = np.round(rid).astype(int)
    head = np.isin(r, HEAD_REGIONS)
    jaw = np.isin(r, (6, 7))
    crown = pos[head, 1].max()
    chin = pos[jaw, 1].min() if jaw.any() else pos[head, 1].min()
    hh = crown - chin
    mid = head & (np.abs(pos[:, 0]) < 0.008) & (pos[:, 1] > chin + 0.25 * hh) & (
        pos[:, 1] < chin + 0.62 * hh
    )
    tip = pos[mid][np.argmax(pos[mid, 2])]
    # the chin *point*, not the bottom of the jaw where it meets the neck: the
    # lowest mid-sagittal vertex that is still on the front of the face
    front = head & (np.abs(pos[:, 0]) < 0.010) & (pos[:, 2] > tip[2] - 0.055) & (
        pos[:, 1] < tip[1]
    )
    chin_pt = pos[front, 1].min() if front.any() else chin
    return dict(crown=crown, chin=chin, chin_pt=chin_pt, hh=hh, tip=tip)


def rescale_head(pos, rid, factor=0.93, blend=0.10):
    """Shrink the head about the base of the skull.

    The BodyParts3D shell is 6.5 heads tall; a real adult is 7.4-7.6. An
    oversized head is one of the strongest "this is a mannequin" cues there
    is, and it is far more visible than any amount of skin detail. The scale
    falls off smoothly through the neck so the join stays watertight.
    """
    r = np.round(rid).astype(int)
    head = np.isin(r, HEAD_REGIONS)
    if not head.any():
        return pos
    base_y = pos[head, 1].min()
    centre = np.array([pos[head, 0].mean(), base_y, pos[head, 2].mean()])
    # 1 over the head, easing to 0 a `blend` metres below the skull base
    t = np.clip((pos[:, 1] - (base_y - blend)) / blend, 0.0, 1.0)
    t = t * t * (3 - 2 * t)
    k = 1.0 + (factor - 1.0) * t
    return centre + (pos - centre) * k[:, None]


def sculpt(pos, nrm, rid, scale=1.0, stubble=0.0):
    m = measure(pos, rid)
    crown, chin, hh, tip = m["crown"], m["chin_pt"], m["hh"], m["tip"]
    log(f"head: crown {crown:.3f}  chin {chin:.3f} (jaw {m['chin']:.3f})  height {hh * 100:.1f} cm  "
        f"nose tip ({tip[0]:+.3f}, {tip[1]:.3f}, {tip[2]:+.3f})")

    r = np.round(rid).astype(int)
    face_mask = np.isin(r, FACE_REGIONS).astype(float)
    # feather the mask so nothing steps at a region border
    s = Sculptor(pos, nrm, face_mask)

    # canon proportions, anchored on landmarks the mesh actually has
    eye_y = tip[1] + 0.075 * hh          # eyes sit above the nose tip
    eye_x = 0.115 * hh                   # interpupillary ~ 0.23 head heights
    nose_base = tip[1] - 0.075 * hh
    mouth_y = nose_base - (nose_base - chin) / 3.0
    mm = scale / 1000.0                  # displacement unit: millimetres

    # Everything below is deliberately soft: features narrower than ~4 mm turn
    # into jagged scratches at this tessellation, and a scratched mannequin
    # looks far worse than a smooth one. Volumes first, lines only to separate
    # them.

    # ---- brow ridge -------------------------------------------------------
    for sx in (-1, 1):
        s.blob(sx * eye_x, eye_y + 0.075 * hh, 0.115 * hh, 0.034 * hh, 2.0 * mm)
    s.blob(0.0, eye_y + 0.070 * hh, 0.040 * hh, 0.026 * hh, -0.8 * mm)   # glabella

    # ---- eyes: an eyeball under closed lids -------------------------------
    for sx in (-1, 1):
        cx = sx * eye_x
        s.blob(cx, eye_y, 0.090 * hh, 0.048 * hh, 4.2 * mm)               # globe
        s.blob(cx, eye_y + 0.020 * hh, 0.086 * hh, 0.024 * hh, 1.0 * mm)  # upper lid
        s.curve(cx, eye_y - 0.010 * hh, 0.080 * hh, 0.012 * hh, 0.016 * hh,
                -1.5 * mm)                                                # lash line
        s.curve(cx, eye_y + 0.048 * hh, 0.072 * hh, -0.008 * hh, 0.018 * hh,
                -1.1 * mm)                                                # lid crease
        s.blob(cx, eye_y - 0.052 * hh, 0.095 * hh, 0.026 * hh, -0.7 * mm)  # orbital rim

    # ---- nose -------------------------------------------------------------
    for sx in (-1, 1):
        s.blob(sx * 0.045 * hh, nose_base + 0.014 * hh, 0.034 * hh, 0.026 * hh, 1.4 * mm)
        s.blob(sx * 0.038 * hh, nose_base + 0.004 * hh, 0.020 * hh, 0.015 * hh, -2.2 * mm)
    s.blob(0.0, nose_base + 0.008 * hh, 0.016 * hh, 0.016 * hh, 1.0 * mm)  # columella
    s.blob(0.0, tip[1], 0.034 * hh, 0.034 * hh, 1.2 * mm)                  # tip volume
    s.blob(0.0, (tip[1] + eye_y) / 2, 0.030 * hh, 0.070 * hh, 0.8 * mm)    # bridge

    # ---- mouth ------------------------------------------------------------
    s.blob(0.0, mouth_y + 0.024 * hh, 0.095 * hh, 0.024 * hh, 2.2 * mm)    # upper lip
    s.blob(0.0, mouth_y - 0.028 * hh, 0.090 * hh, 0.028 * hh, 2.6 * mm)    # lower lip
    s.curve(0.0, mouth_y, 0.110 * hh, 0.024 * hh, 0.015 * hh, -1.8 * mm)   # lip line
    s.blob(0.0, mouth_y + 0.048 * hh, 0.020 * hh, 0.028 * hh, -1.0 * mm)   # philtrum
    for sx in (-1, 1):                                                     # corners
        s.blob(sx * 0.110 * hh, mouth_y - 0.008 * hh, 0.026 * hh, 0.022 * hh, -1.2 * mm)
    s.curve(0.0, mouth_y - 0.068 * hh, 0.095 * hh, -0.014 * hh, 0.020 * hh, -0.9 * mm)
    s.blob(0.0, chin + 0.070 * hh, 0.110 * hh, 0.060 * hh, 1.4 * mm)       # chin ball

    # ---- cheeks -----------------------------------------------------------
    for sx in (-1, 1):
        s.blob(sx * 0.175 * hh, eye_y - 0.100 * hh, 0.085 * hh, 0.065 * hh, 1.6 * mm)

    # ---- pigment: hair, brows, lashes, lips, stubble -----------------------
    # These are baked as a vertex channel rather than sculpted: eyebrow hairs
    # are 0.1 mm wide, no tessellation is ever going to carry them, but the
    # shader can darken and roughen the skin underneath and that is what the
    # eye actually reads.
    r = np.round(rid).astype(int)
    x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]
    head = np.isin(r, HEAD_REGIONS)

    # Hairline: a smooth surface in head coordinates, not the scalp region
    # border — that border is a segmentation artefact and scallops badly. The
    # line sits a third of the way from brow to crown at the front and drops
    # to the nape at the back, which is where a real one is.
    front_h = crown - 0.19 * hh
    back_h = crown - 0.60 * hh
    t_back = np.clip((0.04 - z) / 0.10, 0.0, 1.0)
    t_back = t_back * t_back * (3 - 2 * t_back)
    hairline = front_h * (1 - t_back) + back_h * t_back
    feather = 0.030 * hh
    hair = np.clip((y - hairline) / feather + 0.5, 0.0, 1.0)
    hair = hair * hair * (3 - 2 * hair) * head
    # sideburns: let the hair run a little further down in front of the ears
    burn = np.clip((np.abs(x) - 0.20 * hh) / (0.08 * hh), 0.0, 1.0) * np.clip(
        (y - (front_h - 0.22 * hh)) / (0.10 * hh), 0.0, 1.0)
    hair = np.maximum(hair, np.minimum(burn, 0.85) * head * (z < 0.06))
    s.paint(hair, 1.0)

    for sx in (-1, 1):
        # brow: a tapered arc following the ridge, not a painted rectangle
        bx = (x - sx * eye_x) / (0.105 * hh)
        by = (y - (eye_y + 0.070 * hh - 0.018 * hh * bx * bx)) / (0.019 * hh)
        brow = np.exp(-(bx ** 6) - by * by) * (z > tip[2] - 0.09)
        s.paint(brow, 0.82)
        lx = (x - sx * eye_x) / (0.078 * hh)
        ly = (y - (eye_y - 0.010 * hh + 0.008 * hh * lx * lx)) / (0.014 * hh)
        lash = np.exp(-(lx ** 6) - ly * ly) * (z > tip[2] - 0.09)
        s.paint(lash, 0.75)

    # lips: the vermilion border only, and only just — a wide saturated patch
    # reads as lipstick, which is worse than no lips at all
    lx = x / (0.088 * hh)
    lyu = (y - (mouth_y + 0.018 * hh)) / (0.024 * hh)
    lyl = (y - (mouth_y - 0.022 * hh)) / (0.028 * hh)
    lip = np.exp(-(lx ** 4) - lyu * lyu) + np.exp(-(lx ** 4) - lyl * lyl)
    lip = np.clip(lip, 0, 1) * (z > tip[2] - 0.055)
    s.paint(lip, -1.0)

    if stubble > 0:
        beard = np.isin(r, (6, 7)).astype(float)
        beard = np.maximum(
            beard,
            np.exp(-((x / (0.130 * hh)) ** 4 + ((y - mouth_y) / (0.075 * hh)) ** 2))
            * (z > tip[2] - 0.07),
        )
        beard *= (y < nose_base + 0.02 * hh) * (1.0 - np.clip(lip, 0, 1))
        s.paint(beard * stubble, 0.85)

    return s.disp, s.tint


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--scale", type=float, default=1.0, help="overall feature depth multiplier")
    args = ap.parse_args()

    pos, nrm, rid, thk, idx, extra = load_mesh(args.src, with_extra=True)
    nrm = area_weighted_normals(pos, idx)
    disp = sculpt(pos, nrm, rid, args.scale)
    moved = np.abs(disp) > 1e-5
    log(f"moved {moved.sum()} verts, max {np.abs(disp).max() * 1000:.2f} mm, "
        f"mean {np.abs(disp[moved]).mean() * 1000:.2f} mm")
    pos = pos + nrm * disp[:, None]
    nrm = area_weighted_normals(pos, idx)
    write_mesh(args.dst, pos, nrm, rid, thk, idx, extra=extra)
    log(f"wrote {args.dst}")


if __name__ == "__main__":
    main()
