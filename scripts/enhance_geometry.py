#!/usr/bin/env python3
"""enhance_geometry.py — subdivide + feature-enhance the body for close-up work.

The refined asset is uniform and clean, but 7.8 mm triangles are still visible
as facets on a face-sized crop, and the smoothing passes that removed the scan
noise also rounded off the features worth keeping (lip line, eyelid crease,
nostril, knuckles, clavicle, spine groove).

This pass:

  1. Loop-subdivides the mesh (each triangle -> 4), giving ~3.9 mm edges. Loop
     is an approximating scheme, so it also removes the last of the faceting
     instead of just splitting it.
  2. Re-sharpens the features the smoothing rounded off, with an unsharp mask
     on the surface: the high-pass of the normal-projected umbrella operator
     is pushed back into the surface, clamped to a fraction of a millimetre so
     nothing can blow up.
  3. Re-transfers `_REGIONID` / `_THICKNESS` from the source (nearest-vertex
     vote, so region borders stay exactly where picking expects them) and
     re-bakes `_AO` / `_CURV` at the new resolution.
  4. Recomputes area-weighted normals and applies the bilateral polish.

Usage:
  python3 scripts/enhance_geometry.py build/male-refined.bvmesh build/male-hi.bvmesh
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_render import load_mesh  # noqa: E402
from refine_body_mesh import (  # noqa: E402
    area_weighted_normals,
    bake_ao_formfactor,
    mean_curvature,
    write_mesh,
)
from polish_normals import bilateral_normals, edge_list, smooth_scalar  # noqa: E402
from sculpt_face import rescale_head, sculpt as sculpt_face  # noqa: E402


def log(msg):
    print(f"[enhance] {msg}", flush=True)


# ------------------------------------------------------------ subdivision
def loop_subdivide(pos, idx):
    """One Loop subdivision step on a closed manifold triangle mesh."""
    nv = len(pos)
    # directed half-edges -> undirected edge ids
    he = np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
    opp = np.concatenate([idx[:, 2], idx[:, 0], idx[:, 1]])          # far vertex
    key = np.sort(he, axis=1)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    ne = len(uniq)

    # edge points: 3/8 (a+b) + 1/8 (c+d)
    ep = np.zeros((ne, 3))
    np.add.at(ep, inv, pos[opp] * (1.0 / 8.0))
    cnt = np.zeros(ne)
    np.add.at(cnt, inv, 1.0)
    if not np.all(cnt == 2):
        log(f"warning: {(cnt != 2).sum()} non-manifold/boundary edges — using midpoints there")
        # boundary/non-manifold: fall back to the plain midpoint
        ep[cnt != 2] = 0.0
    ep += (pos[uniq[:, 0]] + pos[uniq[:, 1]]) * (3.0 / 8.0)
    ep[cnt != 2] = (pos[uniq[cnt != 2, 0]] + pos[uniq[cnt != 2, 1]]) * 0.5

    # vertex points: (1 - n beta) v + beta sum(neighbours)
    nb_sum = np.zeros((nv, 3))
    val = np.zeros(nv)
    np.add.at(nb_sum, uniq[:, 0], pos[uniq[:, 1]])
    np.add.at(nb_sum, uniq[:, 1], pos[uniq[:, 0]])
    np.add.at(val, uniq[:, 0], 1.0)
    np.add.at(val, uniq[:, 1], 1.0)
    n = np.maximum(val, 3.0)
    beta = (1.0 / n) * (5.0 / 8.0 - (3.0 / 8.0 + 0.25 * np.cos(2.0 * np.pi / n)) ** 2)
    vp = (1.0 - n * beta)[:, None] * pos + beta[:, None] * nb_sum

    new_pos = np.vstack([vp, ep])
    e0, e1, e2 = inv[: len(idx)] + nv, inv[len(idx) : 2 * len(idx)] + nv, inv[2 * len(idx) :] + nv
    v0, v1, v2 = idx[:, 0], idx[:, 1], idx[:, 2]
    new_idx = np.vstack([
        np.stack([v0, e0, e2], 1),
        np.stack([e0, v1, e1], 1),
        np.stack([e2, e1, v2], 1),
        np.stack([e0, e1, e2], 1),
    ])
    return new_pos, new_idx.astype(np.int64), inv, nv


# --------------------------------------------------------- feature detail
def unsharp_features(pos, idx, nrm, amount=0.55, limit=0.0006, blur=3):
    """Unsharp mask on the surface: push back the detail smoothing removed.

    `h` is the normal component of the umbrella vector (metres, negative on
    convex features). Subtracting a blurred copy leaves only the fine detail;
    displacing against it deepens creases and lifts ridges without touching
    the overall shape. `limit` caps the displacement (default 0.6 mm).
    """
    ei, ej = edge_list(idx)
    lap = np.zeros_like(pos)
    cnt = np.zeros(len(pos))
    np.add.at(lap, ei, pos[ej] - pos[ei])
    np.add.at(lap, ej, pos[ei] - pos[ej])
    np.add.at(cnt, ei, 1.0)
    np.add.at(cnt, ej, 1.0)
    lap /= np.maximum(cnt, 1)[:, None]
    h = np.einsum("ij,ij->i", lap, nrm)
    hp = h - smooth_scalar(h, ei, ej, iters=blur, lam=0.5)
    disp = np.clip(-amount * hp, -limit, limit)
    log(f"unsharp: |disp| mean {np.abs(disp).mean()*1000:.3f} mm, max {np.abs(disp).max()*1000:.3f} mm")
    return pos + nrm * disp[:, None]


# ------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--levels", type=int, default=1, help="Loop subdivision steps")
    ap.add_argument("--unsharp", type=float, default=0.55)
    ap.add_argument("--limit-mm", type=float, default=0.6)
    ap.add_argument("--ao-clusters", type=int, default=4200)
    ap.add_argument("--no-ao", action="store_true", help="keep the interpolated AO (fast preview)")
    ap.add_argument("--no-face", action="store_true", help="skip the facial sculpt")
    ap.add_argument("--face-scale", type=float, default=1.0)
    ap.add_argument("--stubble", type=float, default=0.0,
                    help="beard shadow strength baked into _TINT (male: ~0.35)")
    ap.add_argument("--head-scale", type=float, default=1.0,
                    help="shrink the oversized scan head towards adult proportions")
    args = ap.parse_args()

    from scipy.spatial import cKDTree

    t0 = time.time()
    pos, nrm, rid, thk, idx, extra = load_mesh(args.src, with_extra=True)
    src_pos, src_rid, src_thk = pos.copy(), rid.copy(), thk.copy()
    src_ao = extra.get("_AO")
    log(f"in: {len(pos)} verts / {len(idx)} tris")

    for lvl in range(args.levels):
        pos, idx, _, _ = loop_subdivide(pos, idx)
        log(f"subdivided x{lvl + 1}: {len(pos)} verts / {len(idx)} tris")

    # region ids first: the facial sculpt is masked by them
    rid = src_rid[cKDTree(src_pos).query(pos, k=1)[1]]

    nrm = area_weighted_normals(pos, idx)

    if args.head_scale != 1.0:
        before = pos[:, 1].max() - pos[np.round(rid).astype(int) == 6, 1].min()
        pos = rescale_head(pos, rid, args.head_scale)
        after = pos[:, 1].max() - pos[np.round(rid).astype(int) == 6, 1].min()
        total = pos[:, 1].max() - pos[:, 1].min()
        log(f"head: {before * 100:.1f} -> {after * 100:.1f} cm "
            f"({total / before:.2f} -> {total / after:.2f} heads tall)")
        nrm = area_weighted_normals(pos, idx)

    tint = None
    extras_out = {}
    if not args.no_face:
        # sculpt before the channel bake so lids, lips and nostrils get their
        # own AO and curvature — the shader's cavity term does half the work
        disp, tint = sculpt_face(pos, nrm, rid, args.face_scale, args.stubble)
        pos = pos + nrm * disp[:, None]
        # blend the sculpt into the surrounding surface: two Laplacian steps
        # restricted to the vertices that moved, so nothing reads as a decal
        ei_f, ej_f = edge_list(idx)
        touched = np.abs(disp) > 1e-6
        # only the transition ring around the sculpt is relaxed — smoothing the
        # cores as well would flatten the very features we just added
        ring = smooth_scalar(touched.astype(float), ei_f, ej_f, iters=2, lam=0.5)
        w = np.clip((ring - touched.astype(float)) * 2.5, 0, 1)
        for _ in range(2):
            acc = np.zeros_like(pos)
            cnt = np.zeros(len(pos))
            np.add.at(acc, ei_f, pos[ej_f]); np.add.at(acc, ej_f, pos[ei_f])
            np.add.at(cnt, ei_f, 1.0); np.add.at(cnt, ej_f, 1.0)
            smoothed = acc / np.maximum(cnt, 1)[:, None]
            pos = pos + (smoothed - pos) * (0.35 * w)[:, None]
        nrm = area_weighted_normals(pos, idx)

    if args.unsharp > 0:
        pos = unsharp_features(pos, idx, nrm, args.unsharp, args.limit_mm / 1000.0)
        nrm = area_weighted_normals(pos, idx)

    # --- channels ---------------------------------------------------------
    tree = cKDTree(src_pos)
    dist, ind = tree.query(pos, k=4)
    wgt = 1.0 / np.maximum(dist, 1e-5) ** 2
    thk = (src_thk[ind] * wgt).sum(1) / wgt.sum(1)
    # `rid` was assigned from the undeformed positions before the head rescale
    # and the sculpt — re-querying here would drag region borders along with
    # the deformation, which is exactly what picking must not do.
    log(f"regions: {len(np.unique(np.round(rid)))} present, thickness reprojection "
        f"{dist[:, 0].max() * 1000:.2f} mm")

    if args.no_ao and src_ao is not None:
        ao = (src_ao[ind] * wgt).sum(1) / wgt.sum(1)
    else:
        ao = bake_ao_formfactor(pos, nrm, idx, clusters=args.ao_clusters)
    curv = mean_curvature(pos, nrm, idx)

    ei, ej = edge_list(idx)
    curv = np.clip(smooth_scalar(curv, ei, ej, iters=6, lam=0.5) * 1.25, -1, 1)
    ao = np.clip(smooth_scalar(ao, ei, ej, iters=1, lam=0.4), 0, 1)
    nrm = bilateral_normals(nrm, ei, ej, iters=3, sigma=0.14, keep=0.35)

    if tint is not None:
        # feather the pigment masks across a couple of rings so the hairline
        # and the brow edges are not a step function
        tint = smooth_scalar(tint, ei, ej, iters=2, lam=0.5)
        extras_out["_TINT"] = np.clip(tint, -1, 1).astype(np.float32)
        log(f"tint: hair {np.mean(tint > 0.25) * 100:.1f}% of verts, "
            f"lips {np.mean(tint < -0.25) * 100:.2f}%")

    log(f"ao mean {ao.mean():.3f} | curv p2 {np.percentile(curv, 2):+.3f} "
        f"p98 {np.percentile(curv, 98):+.3f}")
    extras_out["_AO"] = ao.astype(np.float32)
    extras_out["_CURV"] = curv.astype(np.float32)
    write_mesh(args.dst, pos, nrm, rid, thk, idx, extra=extras_out)
    log(f"wrote {args.dst} in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
