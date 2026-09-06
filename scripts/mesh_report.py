#!/usr/bin/env python3
"""Quick topology report: boundary loops (holes), non-manifold edges, sizes."""
import sys
import numpy as np
from collections import defaultdict
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from qa_render import load_mesh

pos, nrm, rid, thk, idx = load_mesh(sys.argv[1])
print(f"verts {len(pos)}  tris {len(idx)}  height {pos[:,1].max():.4f}")

edges = defaultdict(int)
for a, b, c in idx:
    for u, v in ((a, b), (b, c), (c, a)):
        edges[(min(u, v), max(u, v))] += 1
bnd = [e for e, n in edges.items() if n == 1]
nonman = [e for e, n in edges.items() if n > 2]
print(f"boundary edges {len(bnd)}  non-manifold edges {len(nonman)}")

# group boundary edges into loops
adj = defaultdict(list)
for u, v in bnd:
    adj[u].append(v)
    adj[v].append(u)
seen = set()
loops = []
for s in adj:
    if s in seen:
        continue
    loop = [s]
    seen.add(s)
    cur = s
    while True:
        nxt = [n for n in adj[cur] if n not in seen]
        if not nxt:
            break
        cur = nxt[0]
        seen.add(cur)
        loop.append(cur)
    loops.append(loop)
loops.sort(key=len, reverse=True)
for lp in loops[:12]:
    p = pos[lp]
    print(f"  loop {len(lp):4d} verts  centre ({p[:,0].mean():+.3f},{p[:,1].mean():.3f},{p[:,2].mean():+.3f})"
          f"  size {(p.max(0)-p.min(0)).round(3)}")

# triangle quality / edge length stats
e = np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
el = np.linalg.norm(pos[e[:, 0]] - pos[e[:, 1]], axis=1)
print(f"edge length mm: mean {el.mean()*1000:.1f} p5 {np.percentile(el,5)*1000:.1f} p95 {np.percentile(el,95)*1000:.1f} max {el.max()*1000:.1f}")

# dihedral roughness: angle between adjacent face normals
fn = np.cross(pos[idx[:, 1]] - pos[idx[:, 0]], pos[idx[:, 2]] - pos[idx[:, 0]])
fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
emap = defaultdict(list)
for ti, (a, b, c) in enumerate(idx):
    for u, v in ((a, b), (b, c), (c, a)):
        emap[(min(u, v), max(u, v))].append(ti)
ang = []
for tris in emap.values():
    if len(tris) == 2:
        d = np.clip(np.dot(fn[tris[0]], fn[tris[1]]), -1, 1)
        ang.append(np.degrees(np.arccos(d)))
ang = np.array(ang)
print(f"dihedral deg: mean {ang.mean():.2f} p50 {np.percentile(ang,50):.2f} p95 {np.percentile(ang,95):.2f} max {ang.max():.1f}")
print(f"regions present: {len(np.unique(rid))}  thickness range {thk.min():.4f}-{thk.max():.4f}")
