#!/usr/bin/env python3
"""Generate a neutral 1k studio HDRI (lat-long, RGBE .hdr) for the BodyViewer.

Soft grey gradient dome + three rectangular softboxes matching the analytic
three-point rig (warm key upper-front-left, cool fill front-right, bright rim
behind-above) + a dim floor bounce. Deliberately calm and clinical.
"""
import numpy as np, os, struct

W, H = 512, 256
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

# base dome: gentle top-lit grey gradient
t = np.clip(dy * 0.5 + 0.5, 0, 1)
base = 0.10 + 0.38 * t ** 1.4
img += base[..., None] * np.array([0.98, 1.0, 1.04])

# floor bounce (slightly warm)
floor = np.clip(-dy, 0, 1) ** 1.6
img += floor[..., None] * np.array([0.16, 0.145, 0.13])


def softbox(center, radius, color, power):
    c = np.array(center, np.float32)
    c /= np.linalg.norm(c)
    cosang = dx * c[0] + dy * c[1] + dz * c[2]
    m = np.clip((cosang - np.cos(radius)) / (1 - np.cos(radius)), 0, 1) ** 2.2
    img[:] += m[..., None] * np.array(color, np.float32) * power


softbox([-1.6, 2.6, 2.2], 0.42, [1.0, 0.94, 0.86], 5.5)   # warm key
softbox([1.8, 1.4, 1.6], 0.5, [0.88, 0.94, 1.0], 2.2)     # cool fill
softbox([0.4, 2.8, -2.4], 0.32, [1.0, 1.0, 1.0], 7.0)     # rim
softbox([0.0, 1.0, 0.0], 0.9, [1.0, 1.0, 1.0], 0.35)      # ceiling wash


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
