#!/usr/bin/env python3
"""Bilateral polish of the shading normals (and a light denoise of `_CURV`).

The refined body is geometrically clean, but it still carries centimetre-scale
lumpiness from the original scan. Positions cannot be smoothed further without
losing muscle definition, yet the *shading* normals can: a bilateral filter
averages a vertex normal with its 1-ring only where the neighbours already
agree, so scan ripples flatten out while real creases — nose-lip fold, spine
groove, clavicles, knuckles — keep their edge.

Nothing about the silhouette, the vertex positions, the triangle list or the
`_REGIONID` channel changes, so picking and the perf budget are untouched.

Usage:
    python scripts/polish_normals.py build/male.bvmesh build/male-polished.bvmesh
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_render import load_mesh  # noqa: E402

MAGIC = b"BVMESH01"


def write_mesh(path, pos, nrm, rid, thk, idx, extra):
    with open(path, "wb") as f:
        f.write(MAGIC)
        f.write(np.array([len(pos), idx.size], np.uint32).tobytes())
        for a in (pos, nrm):
            f.write(a.astype(np.float32).tobytes())
        for a in (rid, thk):
            f.write(a.astype(np.float32).tobytes())
        f.write(idx.astype(np.uint32).tobytes())
        for name, arr in extra.items():
            f.write(name.encode("ascii").ljust(16, b"\0"))
            f.write(arr.astype(np.float32).tobytes())


def edge_list(idx):
    e = np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
    e = np.sort(e, axis=1)
    e = np.unique(e, axis=0)
    return e[:, 0], e[:, 1]


def bilateral_normals(nrm, ei, ej, iters=4, sigma=0.14, keep=0.25):
    """sigma is in units of (1 - cos angle): 0.14 ~ 30 degrees."""
    n = nrm.copy()
    for _ in range(iters):
        cos = np.einsum("ij,ij->i", n[ei], n[ej])
        w = np.exp(-((1.0 - cos) ** 2) / (2.0 * sigma * sigma))
        acc = np.zeros_like(n)
        wsum = np.zeros(len(n))
        np.add.at(acc, ei, n[ej] * w[:, None])
        np.add.at(acc, ej, n[ei] * w[:, None])
        np.add.at(wsum, ei, w)
        np.add.at(wsum, ej, w)
        acc += n * np.maximum(wsum, 1e-6)[:, None] * (keep / (1.0 - keep))
        ln = np.linalg.norm(acc, axis=1, keepdims=True)
        n = np.where(ln > 1e-9, acc / np.maximum(ln, 1e-12), n)
    return n


def smooth_scalar(v, ei, ej, iters=3, lam=0.5):
    out = v.astype(np.float64).copy()
    for _ in range(iters):
        acc = np.zeros_like(out)
        cnt = np.zeros_like(out)
        np.add.at(acc, ei, out[ej])
        np.add.at(acc, ej, out[ei])
        np.add.at(cnt, ei, 1.0)
        np.add.at(cnt, ej, 1.0)
        out = (1.0 - lam) * out + lam * (acc / np.maximum(cnt, 1.0))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--iters", type=int, default=4)
    ap.add_argument("--sigma", type=float, default=0.14)
    ap.add_argument("--keep", type=float, default=0.25, help="weight of the original normal")
    ap.add_argument("--curv-iters", type=int, default=6)
    args = ap.parse_args()

    pos, nrm, rid, thk, idx, extra = load_mesh(args.src, with_extra=True)
    ei, ej = edge_list(idx)

    new_nrm = bilateral_normals(nrm, ei, ej, args.iters, args.sigma, args.keep)
    dev = np.degrees(np.arccos(np.clip(np.einsum("ij,ij->i", nrm, new_nrm), -1, 1)))
    print(f"[polish] normals moved: mean {dev.mean():.2f} deg, p99 {np.percentile(dev, 99):.2f} deg")

    if "_CURV" in extra and args.curv_iters:
        c = extra["_CURV"].astype(np.float64)
        s = smooth_scalar(c, ei, ej, args.curv_iters, 0.5)
        # deliberately NOT re-normalised: the per-vertex curvature of a scan is
        # dominated by noise, and stretching the smoothed field back to the old
        # range would just amplify that noise into blotches again. Real creases
        # are wide enough to survive the blur; scan ripples are not.
        lo, hi = np.percentile(c, 2), np.percentile(c, 98)
        extra["_CURV"] = np.clip(s * 1.25, -1, 1).astype(np.float32)
        print(f"[polish] curv p2/p98 {lo:+.3f}/{hi:+.3f} -> "
              f"{np.percentile(extra['_CURV'], 2):+.3f}/{np.percentile(extra['_CURV'], 98):+.3f}")

    write_mesh(args.dst, pos, new_nrm, rid, thk, idx, extra)
    print(f"[polish] wrote {args.dst} ({os.path.getsize(args.dst) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
