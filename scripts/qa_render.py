#!/usr/bin/env python3
"""
qa_render.py — offline software renderer for the BodyViewer asset.

Pure numpy z-buffer rasteriser that approximates what the WebGL viewer shows
(same three-point rig, wrap diffuse, thickness-driven subsurface, fresnel rim,
ACES tone mapping) so geometry and shading changes can be reviewed headlessly.

Usage:
  qa_render.py build/male.bvmesh out.png [--view front|back|side|face|hand|knee]
               [--width 720] [--mode shaded|normals|regions|wire|curvature]
"""
import argparse
import os
import sys

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from PIL import Image

MAGIC = b"BVMESH01"


# ------------------------------------------------------------------ mesh io
def load_mesh(path, with_extra=False):
    raw = np.fromfile(path, dtype=np.uint8)
    assert raw[:8].tobytes() == MAGIC, "bad mesh dump"
    vc, ic = np.frombuffer(raw[8:16].tobytes(), np.uint32)
    o = 16
    def take(dtype, n):
        nonlocal o
        nb = n * np.dtype(dtype).itemsize
        a = np.frombuffer(raw[o:o + nb].tobytes(), dtype).copy()
        o += nb
        return a
    pos = take(np.float32, vc * 3).reshape(-1, 3).astype(np.float64)
    nrm = take(np.float32, vc * 3).reshape(-1, 3).astype(np.float64)
    rid = take(np.float32, vc)
    thk = take(np.float32, vc)
    idx = take(np.uint32, ic).reshape(-1, 3).astype(np.int64)
    extra = {}
    while o + 16 + vc * 4 <= len(raw):
        name = raw[o:o + 16].tobytes().rstrip(b"\0").decode("ascii")
        o += 16
        extra[name] = take(np.float32, vc)
    if with_extra:
        return pos, nrm, rid, thk, idx, extra
    return pos, nrm, rid, thk, idx


# ------------------------------------------------------------------ cameras
VIEWS = {
    # name: (target, azimuth deg, elevation deg, distance, fov)
    "front":  ((0.0, 0.86, 0.0),   0.0,   4.0, 3.05, 35.0),
    "back":   ((0.0, 0.86, 0.0), 180.0,   4.0, 3.05, 35.0),
    "side":   ((0.0, 0.86, 0.0),  78.0,   4.0, 3.05, 35.0),
    "three4": ((0.0, 0.86, 0.0),  34.0,  10.0, 2.95, 35.0),
    "face":   ((0.0, 1.60, 0.02),  18.0,  6.0, 0.52, 30.0),
    "torso":  ((0.0, 1.20, 0.02),  16.0,  6.0, 1.15, 32.0),
    "hand":   ((-0.32, 0.72, 0.0), 22.0,  6.0, 0.42, 30.0),
    "knee":   ((-0.11, 0.46, 0.03), 16.0, 2.0, 0.55, 32.0),
    "shoulder": ((-0.19, 1.42, 0.02), 34.0, 10.0, 0.62, 32.0),
}


def look_at(eye, target, up=(0, 1, 0)):
    f = np.array(target, float) - np.array(eye, float)
    f /= np.linalg.norm(f)
    u = np.array(up, float)
    s = np.cross(f, u)
    s /= np.linalg.norm(s)
    u = np.cross(s, f)
    m = np.eye(4)
    m[0, :3], m[1, :3], m[2, :3] = s, u, -f
    m[:3, 3] = -m[:3, :3] @ np.array(eye, float)
    return m


# --------------------------------------------------------------- shading bits
def normalize(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def aces(x):
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0)


def srgb(x):
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.clip(x, 1e-8, 1), 1 / 2.4) - 0.055)


def hash3(p):
    q = np.sin(p @ np.array([127.1, 311.7, 74.7]))
    return np.modf(q * 43758.5453123)[0]


def vnoise(p):
    i = np.floor(p)
    f = p - i
    f = f * f * (3.0 - 2.0 * f)
    def h(dx, dy, dz):
        return hash3(i + np.array([dx, dy, dz]))
    n = (
        (h(0, 0, 0) * (1 - f[:, 0]) + h(1, 0, 0) * f[:, 0]) * (1 - f[:, 1])
        + (h(0, 1, 0) * (1 - f[:, 0]) + h(1, 1, 0) * f[:, 0]) * f[:, 1]
    ) * (1 - f[:, 2]) + (
        (h(0, 0, 1) * (1 - f[:, 0]) + h(1, 0, 1) * f[:, 0]) * (1 - f[:, 1])
        + (h(0, 1, 1) * (1 - f[:, 0]) + h(1, 1, 1) * f[:, 0]) * f[:, 1]
    ) * f[:, 2]
    return n



def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def fbm3(p, octaves=4, base=1.0, gain=0.5):
    total = np.zeros(len(p))
    amp, norm, freq = 1.0, 0.0, base
    rot = np.array([[0.8, 0.6, 0.0], [-0.6, 0.8, 0.0], [0.0, 0.0, 1.0]])
    q = p.copy()
    for _ in range(octaves):
        total += amp * vnoise(q * freq)
        norm += amp
        amp *= gain
        freq *= 2.07
        q = q @ rot
    return total / norm


def detail_fields(objpos, objnrm, detail_scale=11.0, macro_scale=4.5):
    """triplanar sample of the same detail tile the WebGL shader uses"""
    from lib.skin_detail import build_detail_tile, triplanar

    global _TILE
    if _TILE is None:
        _TILE = build_detail_tile()
    fine = triplanar(_TILE, objpos, objnrm, detail_scale)
    macro = triplanar(_TILE, objpos, objnrm, macro_scale)
    grad = np.stack([(fine[:, 0] - 0.5) * 2, (fine[:, 1] - 0.5) * 2, np.zeros(len(fine))], 1)
    return {
        "pore": fine[:, 2],
        "mottle": macro[:, 3] * 0.72 + fine[:, 3] * 0.28,
        "grad": grad,
    }


_TILE = None


def shadow_from(pos, idx, ldir, res=1024, bias=0.0016):
    """orthographic shadow map along `ldir` → per-vertex light visibility"""
    from refine_body_mesh import _raster_max

    d = normalize(np.asarray(ldir, float))
    up = np.array([0.0, 1.0, 0.0]) if abs(d[1]) < 0.95 else np.array([1.0, 0.0, 0.0])
    ex = np.cross(up, d); ex /= np.linalg.norm(ex)
    ey = np.cross(d, ex)
    centre = (pos.max(0) + pos.min(0)) / 2
    radius = np.linalg.norm(pos - centre, axis=1).max() * 1.02
    rel = pos - centre
    px = (rel @ ex / radius * 0.5 + 0.5) * (res - 1)
    py = (rel @ ey / radius * 0.5 + 0.5) * (res - 1)
    w = rel @ d
    depth = np.full((res, res), -np.inf)
    _raster_max(depth, px, py, w, idx, res)
    gx = np.clip(np.round(px).astype(int), 0, res - 1)
    gy = np.clip(np.round(py).astype(int), 0, res - 1)
    lit = np.zeros(len(pos))
    for ox in (-1, 0, 1):
        for oy in (-1, 0, 1):
            near = depth[np.clip(gy + oy, 0, res - 1), np.clip(gx + ox, 0, res - 1)]
            lit += (w >= near - bias).astype(float)
    return lit / 9.0


# ------------------------------------------------------------------ raster
def render(pos, nrm, rid, thk, idx, view="front", width=720, height=None, mode="shaded",
           ss=2, bg=(0.055, 0.06, 0.075), extra=None, shadows=True):
    extra = extra or {}
    ao_v = extra.get("_AO", np.ones(len(pos)))
    cv_v = extra.get("_CURV", np.zeros(len(pos)))
    target, az, el, dist, fov = VIEWS[view]
    height = height or int(width * 1.35)
    W, H = width * ss, height * ss

    a, e = np.radians(az), np.radians(el)
    eye = np.array(target, float) + dist * np.array(
        [np.sin(a) * np.cos(e), np.sin(e), np.cos(a) * np.cos(e)]
    )
    V = look_at(eye, target)
    aspect = W / H
    f = 1.0 / np.tan(np.radians(fov) / 2)
    near, far = 0.05, 30.0

    vp = (V @ np.hstack([pos, np.ones((len(pos), 1))]).T).T[:, :3]  # view space
    vn = (V[:3, :3] @ nrm.T).T

    z = -vp[:, 2]
    xs = (vp[:, 0] * f / aspect) / np.maximum(z, 1e-6)
    ys = (vp[:, 1] * f) / np.maximum(z, 1e-6)
    sx = (xs * 0.5 + 0.5) * W
    sy = (1 - (ys * 0.5 + 0.5)) * H

    tri = idx
    p0, p1, p2 = sx[tri[:, 0]], sx[tri[:, 1]], sx[tri[:, 2]]
    q0, q1, q2 = sy[tri[:, 0]], sy[tri[:, 1]], sy[tri[:, 2]]
    area = (p1 - p0) * (q2 - q0) - (p2 - p0) * (q1 - q0)
    front = area < 0  # ccw in screen space (y flipped)
    keep = front & (z[tri].min(1) > near) & (z[tri].max(1) < far)
    tri = tri[keep]

    shadow_mask = None
    if shadows and mode == "shaded":
        lit_v = shadow_from(pos, idx, np.array([-1.7, 2.7, 2.3]))
    zbuf = np.full((H, W), np.inf)
    fbuf = np.zeros((H, W, 3))
    # attribute buffers
    nbuf = np.zeros((H, W, 3))
    pbuf = np.zeros((H, W, 3))
    tbuf = np.zeros((H, W))
    rbuf = np.full((H, W), -1.0)
    obuf = np.zeros((H, W, 3))  # object-space position
    onbuf = np.zeros((H, W, 3))  # object-space normal
    aobuf = np.ones((H, W))
    shbuf = np.ones((H, W))
    cvbuf = np.zeros((H, W))
    mask = np.zeros((H, W), bool)

    # rasterise triangle by triangle over its bbox (fast enough at 22-90k tris)
    P = np.stack([sx, sy], 1)
    for t in tri:
        i0, i1, i2 = t
        x0, y0 = P[i0]; x1, y1 = P[i1]; x2, y2 = P[i2]
        minx = max(int(np.floor(min(x0, x1, x2))), 0)
        maxx = min(int(np.ceil(max(x0, x1, x2))), W - 1)
        miny = max(int(np.floor(min(y0, y1, y2))), 0)
        maxy = min(int(np.ceil(max(y0, y1, y2))), H - 1)
        if minx > maxx or miny > maxy:
            continue
        yy, xx = np.mgrid[miny:maxy + 1, minx:maxx + 1]
        px = xx + 0.5
        py = yy + 0.5
        d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(d) < 1e-12:
            continue
        l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / d
        l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / d
        l2 = 1 - l0 - l1
        inside = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
        if not inside.any():
            continue
        z0, z1, z2 = z[i0], z[i1], z[i2]
        iw = l0 / z0 + l1 / z1 + l2 / z2
        zi = 1.0 / np.maximum(iw, 1e-9)
        c0 = (l0 / z0) * zi
        c1 = (l1 / z1) * zi
        c2 = (l2 / z2) * zi
        sub = inside & (zi < zbuf[miny:maxy + 1, minx:maxx + 1])
        if not sub.any():
            continue
        ys_, xs_ = np.nonzero(sub)
        gy = ys_ + miny
        gx = xs_ + minx
        w0 = c0[sub][:, None]; w1 = c1[sub][:, None]; w2 = c2[sub][:, None]
        zbuf[gy, gx] = zi[sub]
        nbuf[gy, gx] = w0 * vn[i0] + w1 * vn[i1] + w2 * vn[i2]
        pbuf[gy, gx] = w0 * vp[i0] + w1 * vp[i1] + w2 * vp[i2]
        obuf[gy, gx] = w0 * pos[i0] + w1 * pos[i1] + w2 * pos[i2]
        tbuf[gy, gx] = (w0[:, 0] * thk[i0] + w1[:, 0] * thk[i1] + w2[:, 0] * thk[i2])
        onbuf[gy, gx] = w0 * nrm[i0] + w1 * nrm[i1] + w2 * nrm[i2]
        aobuf[gy, gx] = (w0[:, 0] * ao_v[i0] + w1[:, 0] * ao_v[i1] + w2[:, 0] * ao_v[i2])
        cvbuf[gy, gx] = (w0[:, 0] * cv_v[i0] + w1[:, 0] * cv_v[i1] + w2[:, 0] * cv_v[i2])
        if shadows and mode == "shaded":
            shbuf[gy, gx] = (w0[:, 0] * lit_v[i0] + w1[:, 0] * lit_v[i1] + w2[:, 0] * lit_v[i2])
        rbuf[gy, gx] = rid[i0]
        mask[gy, gx] = True

    m = mask
    N = np.zeros_like(nbuf)
    N[m] = normalize(nbuf[m])
    Vdir = np.zeros_like(pbuf)
    Vdir[m] = normalize(-pbuf[m])

    if mode == "normals":
        col = np.zeros((H, W, 3))
        col[m] = N[m] * 0.5 + 0.5
    elif mode == "regions":
        col = np.zeros((H, W, 3))
        ids = rbuf[m]
        rng = np.random.default_rng(7)
        pal = rng.random((256, 3)) * 0.8 + 0.2
        col[m] = pal[(ids.astype(int) % 256)]
    elif mode == "curvature":
        col = np.zeros((H, W, 3))
        # screen-space normal divergence ~ curvature; exposes lumpiness
        nx = np.zeros((H, W)); ny = np.zeros((H, W))
        nx[m] = N[m][:, 0]; ny[m] = N[m][:, 1]
        gx = np.gradient(nx, axis=1)
        gy = np.gradient(ny, axis=0)
        c = np.clip(0.5 + (gx + gy) * 14.0, 0, 1)
        col[m] = np.stack([c, c, c], -1)[m]
    elif mode == "ao":
        col = np.zeros((H, W, 3))
        col[m] = np.stack([aobuf[m]] * 3, -1)
    else:
        # ---- skin model, mirroring src/components/body/skinMaterial.ts ----
        # (same rig as BodyViewer.tsx: warm key + cool fill + cool-white rim)
        lights = [
            (np.array([-1.7, 2.7, 2.3]), np.array([1.0, 0.949, 0.886]), 2.1, True),
            (np.array([1.9, 1.3, 1.5]), np.array([0.863, 0.910, 1.0]), 0.42, False),
            (np.array([0.4, 2.6, -2.5]), np.array([1.0, 0.980, 0.957]), 1.25, False),
        ]
        wrap_rgb = np.array([0.55, 0.28, 0.20])
        sss_col = np.array([0.66, 0.27, 0.22]) ** 2.2
        base = np.array([0.788, 0.620, 0.561]) ** 2.2  # #c99e8f

        thin = 1.0 - np.clip((tbuf[m] - 0.004) / 0.051, 0, 1)
        thin = thin * thin * (3 - 2 * thin)
        curv = cvbuf[m]
        crease = np.clip((0.0 - curv) / 0.55, 0, 1) ** 1.0
        detail = detail_fields(obuf[m], normalize(onbuf[m]))
        cavity = (0.45 + 0.55 * detail["pore"]) * (1.0 - crease * 0.55)
        occ = np.clip((1.0 - 0.9 + 0.9 * aobuf[m]) * cavity, 0, 1)

        albedo = np.zeros((H, W, 3))
        alb = base[None, :] * np.ones((m.sum(), 1))
        alb = alb * (1 - 0.35 * thin[:, None]) + alb * np.array([1.1, 0.82, 0.76]) * (0.35 * thin[:, None])
        alb *= (0.989 + 0.022 * detail["mottle"])[:, None]
        alb *= (0.975 + 0.025 * detail["pore"])[:, None]
        shade = 1.0 - occ
        # blood pools in creases: shift hue red, do not paint a flat red on top
        alb *= (1.0 + np.array([0.03, -0.10, -0.16])[None, :] * (shade * 0.8)[:, None])
        albedo[m] = alb

        rough = np.zeros((H, W))
        rough[m] = np.clip(0.52 * (1.06 - 0.16 * detail["pore"]) - thin * 0.06 + shade * 0.08, 0.36, 0.72)

        # micro-detail normal perturbation (triplanar bump, as in the shader)
        Nd = N.copy()
        on = normalize(onbuf[m])
        up = np.where(np.abs(on[:, 1:2]) < 0.95, np.array([0.0, 1.0, 0.0]), np.array([1.0, 0.0, 0.0]))
        tan = np.cross(up, on); tan = normalize(tan)
        bit = np.cross(on, tan)
        offs = (tan * detail["grad"][:, 0:1] + bit * detail["grad"][:, 1:2]) * 0.35
        offs_view = (V[:3, :3] @ offs.T).T
        Nd[m] = normalize(N[m] + offs_view)

        out = np.zeros((H, W, 3))
        scatter = np.zeros((m.sum(), 3))
        shadow_mask = shbuf if shadows else None
        Rm = np.linalg.inv(V)[:3, :3].T
        for dirw, colw, inten, is_key in lights:
            L = normalize(Rm @ normalize(dirw))
            raw = Nd[m] @ L
            wrapped = np.clip((raw[:, None] + wrap_rgb[None, :]) / (1 + wrap_rgb[None, :]), 0, 1)
            atten = np.ones(m.sum())
            if is_key and shadows and shadow_mask is not None:
                atten = shadow_mask[m]
            rad = colw[None, :] * inten * atten[:, None]
            out[m] += wrapped * rad * albedo[m] / np.pi  # BRDF_Lambert
            # specular (GGX, F0 = 0.028 like real skin)
            Hv = normalize(L[None, :] + Vdir[m])
            NH = np.clip(np.einsum("ij,ij->i", Nd[m], Hv), 0, 1)
            NV = np.clip(np.einsum("ij,ij->i", Nd[m], Vdir[m]), 1e-4, 1)
            NL = np.clip(raw, 0, 1)
            a = np.maximum(rough[m] ** 2, 1e-3)
            d = a * a / (np.pi * ((NH * NH) * (a * a - 1) + 1) ** 2)
            k = a / 2
            g = (NL / (NL * (1 - k) + k)) * (NV / (NV * (1 - k) + k))
            f0 = 0.028
            fres_s = f0 + (1 - f0) * (1 - np.clip(np.einsum("ij,ij->i", Vdir[m], Hv), 0, 1)) ** 5
            spec = np.clip(d * g * fres_s / (4 * np.maximum(NV, 1e-4)), 0, 12)
            out[m] += (spec * NL)[:, None] * rad
            # scattering terms
            term = smoothstep(0.5, -0.25, raw) * smoothstep(-0.7, -0.05, raw)
            scatter += rad * sss_col[None, :] * (term * 0.26 * (0.35 + 0.65 * np.clip((curv + 0.1) / 0.55, 0, 1)))[:, None]
            trans = np.clip(np.einsum("ij,ij->i", Vdir[m], -normalize(L[None, :] + Nd[m] * 0.4)), 0, 1) ** 2.5
            scatter += rad * sss_col[None, :] * (trans * 0.26 * thin * 0.85)[:, None]

        # indirect: hemisphere ambient standing in for the studio HDRI, x AO
        up = np.clip(Nd[m][:, 1] * 0.5 + 0.5, 0, 1)[:, None]
        amb = (np.array([0.27, 0.295, 0.35]) * up + np.array([0.085, 0.07, 0.062]) * (1 - up))
        out[m] += albedo[m] * amb * 0.85 * occ[:, None]

        # subsurface + rim + tight oily lobe
        out[m] += np.minimum(scatter * albedo[m] * 2.2, 0.35) * occ[:, None]
        fres = (1 - np.clip(np.einsum("ij,ij->i", Nd[m], Vdir[m]), 0, 1)) ** 4
        out[m] += np.array([1.0, 0.89, 0.80]) ** 2.2 * (fres * 0.13 * (0.35 + 0.65 * occ))[:, None]
        Lk = normalize(Rm @ normalize(np.array([-1.7, 2.7, 2.3])))
        Hk = normalize(Lk[None, :] + Vdir[m])
        tight = np.clip(np.einsum("ij,ij->i", Nd[m], Hk), 0, 1) ** 220 * 0.14 * (1 - rough[m]) * occ
        out[m] += np.array([1.0, 0.945, 0.894])[None, :] * tight[:, None]

        col = np.zeros((H, W, 3))
        col[m] = aces(out[m] * 1.0)

    img = np.zeros((H, W, 3))
    img[:] = np.array(bg)
    img[m] = col[m] if mode == "shaded" else col[m]
    # vignette-ish floor gradient for readability
    out = srgb(np.clip(img, 0, 1)) if mode == "shaded" else np.clip(img, 0, 1)
    arr = (out * 255).astype(np.uint8)
    im = Image.fromarray(arr).resize((width, height), Image.LANCZOS)
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mesh")
    ap.add_argument("out")
    ap.add_argument("--view", default="front")
    ap.add_argument("--width", type=int, default=720)
    ap.add_argument("--mode", default="shaded")
    ap.add_argument("--ss", type=int, default=2)
    ap.add_argument("--no-shadows", action="store_true")
    args = ap.parse_args()
    pos, nrm, rid, thk, idx, extra = load_mesh(args.mesh, with_extra=True)
    views = args.view.split(",")
    ims = [render(pos, nrm, rid, thk, idx, v, args.width, mode=args.mode, ss=args.ss,
                  extra=extra, shadows=not args.no_shadows)
           for v in views]
    if len(ims) == 1:
        im = ims[0]
    else:
        w = sum(i.width for i in ims)
        h = max(i.height for i in ims)
        im = Image.new("RGB", (w, h), (14, 15, 19))
        x = 0
        for i in ims:
            im.paste(i, (x, 0))
            x += i.width
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    im.save(args.out)
    print("wrote", args.out, im.size)


if __name__ == "__main__":
    main()
