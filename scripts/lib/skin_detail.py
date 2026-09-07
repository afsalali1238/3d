#!/usr/bin/env python3
"""
Python mirror of src/components/body/skinDetail.ts.

Same periodic value-noise recipe, so the offline QA renders show the same
pore/mottle detail the WebGL shader samples at runtime. Keep the two in sync:
if you change one, change the other (scripts/qa_render.py --detail-tile writes
the tile out as a PNG for eyeballing).
"""
import numpy as np


def _hash2(ix, iy, period, seed):
    x = np.mod(ix, period).astype(np.int64)
    y = np.mod(iy, period).astype(np.int64)
    h = x * 374761393 + y * 668265263 + np.int64(seed) * 1442695041
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (np.abs(h) % 65536) / 65535.0


def _smootherstep(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def pnoise(x, y, period, seed):
    ix = np.floor(x)
    iy = np.floor(y)
    fx = _smootherstep(x - ix)
    fy = _smootherstep(y - iy)
    a = _hash2(ix, iy, period, seed)
    b = _hash2(ix + 1, iy, period, seed)
    c = _hash2(ix, iy + 1, period, seed)
    d = _hash2(ix + 1, iy + 1, period, seed)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(x, y, base, octaves, seed, gain=0.5):
    total = np.zeros_like(x)
    amp, norm, freq = 1.0, 0.0, base
    for o in range(octaves):
        total += amp * pnoise(x * freq, y * freq, freq, seed + o * 17)
        norm += amp
        amp *= gain
        freq *= 2
    return total / norm


def build_detail_tile(size=512, relief=1.0, seed=3):
    """returns float RGBA in [0,1]: RG = normal xy, B = pore cavity, A = mottle"""
    u, v = np.meshgrid(np.arange(size) / size, np.arange(size) / size, indexing="xy")
    peel = fbm(u, v, 38, 4, seed)
    r1 = 1 - np.abs(pnoise(u * 96, v * 96, 96, seed + 91) * 2 - 1)
    r2 = 1 - np.abs(pnoise(u * 168, v * 168, 168, seed + 143) * 2 - 1)
    pores = (r1 * 0.65 + r2 * 0.35) ** 2.4
    creases = fbm(u * 1.9, v, 48, 2, seed + 211)
    h = peel * 0.42 + creases * 0.22 - pores * 0.5
    mottle = fbm(u, v, 5, 3, seed + 401) * 0.7 + fbm(u, v, 11, 2, seed + 733) * 0.3
    mottle = (mottle - mottle.min()) / max(mottle.max() - mottle.min(), 1e-5)

    slope = relief * size * 0.012
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * slope
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * slope
    nx, ny, nz = -dx, -dy, np.ones_like(dx)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, np.clip(1 - pores, 0, 1), mottle], -1)
    return out.astype(np.float32)


def sample_tile(tile, uv):
    """bilinear, wrapping"""
    size = tile.shape[0]
    x = np.mod(uv[:, 0] * size, size)
    y = np.mod(uv[:, 1] * size, size)
    x0 = np.floor(x).astype(int) % size
    y0 = np.floor(y).astype(int) % size
    x1 = (x0 + 1) % size
    y1 = (y0 + 1) % size
    fx = (x - np.floor(x))[:, None]
    fy = (y - np.floor(y))[:, None]
    return (
        tile[y0, x0] * (1 - fx) * (1 - fy)
        + tile[y0, x1] * fx * (1 - fy)
        + tile[y1, x0] * (1 - fx) * fy
        + tile[y1, x1] * fx * fy
    )


def triplanar(tile, pos, nrm, scale):
    w = np.abs(nrm) ** 4
    w /= np.maximum(w.sum(1, keepdims=True), 1e-4)
    cx = sample_tile(tile, pos[:, [2, 1]] * scale)
    cy = sample_tile(tile, pos[:, [0, 2]] * scale)
    cz = sample_tile(tile, pos[:, [0, 1]] * scale)
    return cx * w[:, 0:1] + cy * w[:, 1:2] + cz * w[:, 2:3]


def planar(tile, pos, nrm, scale):
    """single dominant-axis sample — mirrors bvPlanar() in skinMaterial.ts"""
    a = np.abs(nrm)
    ax = (a[:, 0] > np.maximum(a[:, 1], a[:, 2]))
    ay = (~ax) & (a[:, 1] > a[:, 2])
    uv = pos[:, [0, 1]].copy()
    uv[ax] = pos[ax][:, [2, 1]]
    uv[ay] = pos[ay][:, [0, 2]]
    return sample_tile(tile, uv * scale)
