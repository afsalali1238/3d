#!/usr/bin/env python3
"""Generate a neutral 1k studio HDRI (lat-long, RGBE .hdr) for the BodyViewer.

Soft grey gradient dome + three rectangular softboxes matching the analytic
three-point rig (warm key upper-front-left, cool fill front-right, bright rim
behind-above) + a dim floor bounce. Deliberately calm and clinical.
"""
import numpy as np, os, struct

W, H = 512, 256
RNG = np.random.default_rng(7)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "textures", "studio.hdr")
os.makedirs(os.path.dirname(OUT), exist_ok=True)

# direction grid (lat-long): +Y up. u=0 -> -Z? three.js equirect: u maps azimuth.
v, u = np.meshgrid(np.linspace(0, 1, H), np.linspace(0, 1, W), indexing="ij")
theta = u * 2 * np.pi - np.pi          # azimuth
phi = v * np.pi                        # 0 top .. pi bottom
dx = np.sin(phi) * np.sin(theta)
dy = np.cos(phi)
dz = np.sin(phi) * np.cos(theta)      # +Z at u=0.5

img = np.zeros((H, W, 3), np.float32)

# base dome: gentle top-lit grey gradient, cooler at the zenith and a touch
# warmer towards the horizon (a real cyc wall picks up floor bounce)
t = np.clip(dy * 0.5 + 0.5, 0, 1)
base = 0.10 + 0.38 * t ** 1.4
zenith = np.array([0.94, 0.99, 1.08])
horizon = np.array([1.04, 1.00, 0.96])
tint = horizon[None, None, :] + (zenith - horizon)[None, None, :] * t[..., None] ** 1.2
img += base[..., None] * tint

# very low-frequency mottle so mirror-like reflections are not perfectly flat
mottle = RNG.normal(0.0, 1.0, (H // 16 + 2, W // 16 + 2)).astype(np.float32)
yi = np.linspace(0, mottle.shape[0] - 1, H)
xi = np.linspace(0, mottle.shape[1] - 1, W)
y0 = np.floor(yi).astype(int); x0 = np.floor(xi).astype(int)
y1 = np.minimum(y0 + 1, mottle.shape[0] - 1); x1 = np.minimum(x0 + 1, mottle.shape[1] - 1)
fy = (yi - y0)[:, None]; fx = (xi - x0)[None, :]
fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
sm = (mottle[np.ix_(y0, x0)] * (1 - fy) * (1 - fx) + mottle[np.ix_(y1, x0)] * fy * (1 - fx)
      + mottle[np.ix_(y0, x1)] * (1 - fy) * fx + mottle[np.ix_(y1, x1)] * fy * fx)
img *= (1.0 + 0.05 * sm)[..., None]

# floor bounce (slightly warm)
floor = np.clip(-dy, 0, 1) ** 1.6
img += floor[..., None] * np.array([0.16, 0.145, 0.13])


DW = np.sin(phi) * (np.pi / H) * (2 * np.pi / W)   # per-texel solid angle


def softbox(center, size, color, flux, up=(0, 1, 0), diffusion=0.55):
    """Rectangular area light with a flat core and a wide diffused halo.

    `size` is the angular half-extent (radians) along the box's local width and
    height, so a real 1x2 m softbox reads as an elongated specular highlight
    instead of the round dot a cone gives. `flux` is total emitted energy
    (radiance integrated over solid angle), so resizing a box changes how soft
    it is without changing how bright the body ends up.
    """
    c = np.array(center, np.float32)
    c /= np.linalg.norm(c)
    up_v = np.array(up, np.float32)
    right = np.cross(up_v, c)
    if np.linalg.norm(right) < 1e-4:
        right = np.cross(np.array([1.0, 0.0, 0.0], np.float32), c)
    right /= np.linalg.norm(right)
    top = np.cross(c, right)

    # gnomonic projection onto the panel plane: a true rectangle, with none of
    # the wrap-around arcs an angular (arcsin) parameterisation produces
    ndotc = dx * c[0] + dy * c[1] + dz * c[2]
    safe = ndotc > 0.30
    inv = np.where(safe, 1.0 / np.maximum(ndotc, 1e-3), 0.0)
    px = (dx * right[0] + dy * right[1] + dz * right[2]) * inv
    py = (dx * top[0] + dy * top[1] + dz * top[2]) * inv

    hw, hh = np.tan(size[0]), np.tan(size[1])

    def band(a, half):
        edge = half * diffusion
        return np.clip((half + edge - np.abs(a)) / max(edge, 1e-4), 0, 1)

    m = band(px, hw) * band(py, hh) * safe
    m = (m * m * (3 - 2 * m)).astype(np.float32)      # smoothstep edges
    m *= np.clip((ndotc - 0.30) / 0.15, 0, 1)         # fade the grazing cutoff
    m = m / max(float((m * DW).sum()), 1e-6)          # unit flux
    img[:] += m[..., None] * np.array(color, np.float32) * flux


# key: tall 45-degree softbox, upper front left
softbox([-1.6, 2.6, 2.2], (0.17, 0.27), [1.0, 0.945, 0.87], 0.933)
# fill: big, close, low-power white bounce card on the right
softbox([1.8, 1.2, 1.6], (0.30, 0.24), [0.89, 0.945, 1.0], 0.526)
# rim: narrow strip behind and above, the one that draws the silhouette
softbox([0.4, 2.8, -2.4], (0.09, 0.20), [1.0, 0.99, 0.98], 0.707)
# ceiling wash: broad and dim, keeps the top of the head from going dead
softbox([0.0, 1.0, 0.0], (0.60, 0.60), [1.0, 1.0, 1.0], 0.259)


def write_hdr(path, rgb):
    h, w, _ = rgb.shape
    with open(path, "wb") as f:
        f.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n")
        f.write(f"-Y {h} +X {w}\n".encode())
        for row in rgb:
            maxc = row.max(axis=1)
            e = np.zeros(w, np.int32)
            mant = np.zeros((w, 3), np.float32)
            nz = maxc > 1e-32
            e[nz] = np.ceil(np.log2(maxc[nz])).astype(np.int32) + 1
            scale = np.zeros(w, np.float32)
            scale[nz] = 256.0 / (2.0 ** e[nz])
            rgbe = np.zeros((w, 4), np.uint8)
            rgbe[:, :3] = np.clip(row * scale[:, None], 0, 255).astype(np.uint8)
            rgbe[nz, 3] = (e[nz] + 128).astype(np.uint8)
            # flat (uncompressed) scanlines
            f.write(rgbe.tobytes())


write_hdr(OUT, img)
print(f"wrote {OUT} ({os.path.getsize(OUT)/1e6:.2f} MB)")
