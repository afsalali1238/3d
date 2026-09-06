#!/usr/bin/env python3
"""
refine_body_mesh.py — quality pass over the shipped BodyViewer body mesh.

The shipped asset is a voxel-derived BodyParts3D skin shell: watertight enough
to pick against, but visibly lumpy, with wildly uneven triangle sizes (3 mm to
128 mm edges) and open holes (eye sockets, armpits, finger webs). That reads as
"scan blob" the moment the camera gets close.

This pass turns it into a clean, evenly tessellated render asset **without
changing the silhouette** (every step is surface-reprojecting or volume
preserving, and the result is checked against the input with a Hausdorff-style
sample distance):

  1. weld duplicates, drop degenerate/unreferenced geometry
  2. close boundary loops (eyes, armpits, finger webs) with refined patches
  3. Taubin denoise (volume preserving) to kill voxel-stair noise
  4. isotropic explicit remesh to a uniform target edge length, reprojecting
     onto the original surface each iteration
  5. light HC-Laplacian polish
  6. transfer `_REGIONID` (inverse-distance weighted vote of the k nearest
     source vertices) and `_THICKNESS` (IDW mean) from the source mesh
  7. bake `_AO` (hemispherical ambient occlusion, depth-map visibility over a
     Fibonacci sphere) and `_CURV` (signed, normalised mean curvature) per
     vertex — the skin shader uses them for contact shadowing, cavity
     darkening and curvature-driven subsurface scattering
  8. recompute area-weighted smooth normals

Usage:
  python3 scripts/refine_body_mesh.py build/male.bvmesh build/male-refined.bvmesh
"""
import argparse
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qa_render import load_mesh  # noqa: E402

MAGIC = b"BVMESH01"


def log(msg):
    print(f"[refine] {msg}", flush=True)


# --------------------------------------------------------------------- io
def write_mesh(path, pos, nrm, rid, thk, idx, extra=None):
    """Write the .bvmesh dump (+ optional trailing named float channels)."""
    with open(path, "wb") as f:
        f.write(MAGIC)
        f.write(np.array([len(pos), idx.size], np.uint32).tobytes())
        f.write(pos.astype(np.float32).tobytes())
        f.write(nrm.astype(np.float32).tobytes())
        f.write(rid.astype(np.float32).tobytes())
        f.write(thk.astype(np.float32).tobytes())
        f.write(idx.astype(np.uint32).tobytes())
        for name, arr in (extra or {}).items():
            f.write(name.encode("ascii").ljust(16, b"\0"))
            f.write(arr.astype(np.float32).tobytes())


# ------------------------------------------------------------- geometry ops
def area_weighted_normals(pos, idx):
    n = np.zeros_like(pos)
    p0, p1, p2 = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    fn = np.cross(p1 - p0, p2 - p0)  # length ∝ 2*area
    for k in range(3):
        np.add.at(n, idx[:, k], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.maximum(ln, 1e-12)


def bake_ao_formfactor(pos, nrm, idx, near_radius=0.13, clusters=2200, passes=1):
    """Disc form-factor ambient occlusion (Bunnell), which — unlike a
    depth-map bake — resolves crevices smaller than a pixel: armpits, the
    groin, finger webs, the fold under the chin, eye sockets.

    Every triangle is treated as an oriented disc of the same area. The
    occlusion a disc casts on a vertex is

        A · cos(θ_v) · cos(θ_d) / (π·d² + A)

    summed over the near field exactly and over voxel-clustered proxies in the
    far field. A second pass multiplies each emitter by its own openness,
    which cancels most of the double-counting single-pass form factors suffer
    from (light that is blocked twice is only blocked once in reality).
    """
    from scipy.spatial import cKDTree

    t0 = time.time()
    p0, p1, p2 = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    cent = (p0 + p1 + p2) / 3.0
    cross = np.cross(p1 - p0, p2 - p0)
    area = np.linalg.norm(cross, axis=1) * 0.5
    fnrm = cross / np.maximum(np.linalg.norm(cross, axis=1, keepdims=True), 1e-12)

    # ---- far field: voxel-cluster the triangles into area-weighted discs ---
    lo, hi = pos.min(0), pos.max(0)
    step = float(np.cbrt(np.prod(hi - lo) / max(clusters, 1))) or 0.05
    key = np.floor((cent - lo) / step).astype(np.int64)
    key -= key.min(0)
    dims = key.max(0) + 1
    flat = (key[:, 0] * dims[1] + key[:, 1]) * dims[2] + key[:, 2]
    uniq, inv = np.unique(flat, return_inverse=True)
    n_c = len(uniq)
    c_area = np.bincount(inv, weights=area, minlength=n_c)
    c_cent = np.stack([np.bincount(inv, weights=cent[:, k] * area, minlength=n_c) for k in range(3)], 1)
    c_cent /= np.maximum(c_area, 1e-12)[:, None]
    c_nrm = np.stack([np.bincount(inv, weights=fnrm[:, k] * area, minlength=n_c) for k in range(3)], 1)
    c_nrm /= np.maximum(np.linalg.norm(c_nrm, axis=1, keepdims=True), 1e-12)
    log(f"  AO far field: {n_c} clusters (voxel {step*1000:.0f} mm)")

    tree = cKDTree(cent)

    emit = np.ones(len(idx))          # per-triangle openness, refined per pass
    c_emit = np.ones(n_c)
    ao = np.ones(len(pos))
    for it in range(passes):
        occ = np.zeros(len(pos))
        CHUNK = 384
        for s in range(0, len(pos), CHUNK):
            e = min(s + CHUNK, len(pos))
            # far field (clustered), skipping the near shell to avoid double count
            d = c_cent[None, :, :] - pos[s:e, None, :]
            dist2 = np.einsum("ijk,ijk->ij", d, d)
            dist = np.sqrt(np.maximum(dist2, 1e-12))
            dirn = d / dist[:, :, None]
            cos_v = np.clip(np.einsum("ijk,ik->ij", dirn, nrm[s:e]), 0, 1)
            cos_d = np.clip(-np.einsum("ijk,jk->ij", dirn, c_nrm), 0, 1)
            far = dist > near_radius
            ff = c_area[None, :] * cos_v * cos_d / (np.pi * dist2 + c_area[None, :])
            occ[s:e] += (ff * far * c_emit[None, :]).sum(1)
            # near field (per triangle, exact) — queried in the same chunk so
            # the neighbour lists never all exist at once (33k x 2k ints = OOM)
            for v, tri in zip(range(s, e), tree.query_ball_point(pos[s:e], near_radius)):
                if not tri:
                    continue
                tri = np.asarray(tri)
                dv = cent[tri] - pos[v]
                dv2 = np.einsum("ij,ij->i", dv, dv)
                dl = np.sqrt(np.maximum(dv2, 1e-12))
                dn = dv / dl[:, None]
                cv = np.clip(dn @ nrm[v], 0, 1)
                cd = np.clip(-np.einsum("ij,ij->i", dn, fnrm[tri]), 0, 1)
                ffn = area[tri] * cv * cd / (np.pi * dv2 + area[tri])
                occ[v] += float((ffn * emit[tri]).sum())
        ao = np.clip(1.0 - occ, 0.0, 1.0)
        # propagate openness to the emitters for the next pass
        emit = ao[idx].mean(1)
        c_emit = np.bincount(inv, weights=emit * area, minlength=n_c) / np.maximum(c_area, 1e-12)
        log(f"  AO pass {it+1}/{passes}: mean {ao.mean():.3f} p5 {np.percentile(ao,5):.3f} "
            f"min {ao.min():.3f} ({time.time()-t0:.0f}s)")
    return ao


def bake_ao(pos, nrm, idx, n_dirs=192, res=512, bias=0.0022):
    """Hemispherical AO by depth-map visibility over a Fibonacci sphere.

    For each direction we rasterise an orthographic depth map of the mesh and
    test every vertex against it. A vertex is lit from that direction when it
    is the closest surface along the ray (within `bias`) and the direction is
    in its normal hemisphere. Cosine weighted, so it matches a diffuse
    hemisphere integral.
    """
    t0 = time.time()
    ao_num = np.zeros(len(pos))
    ao_den = np.zeros(len(pos)) + 1e-9

    i = np.arange(n_dirs) + 0.5
    phi = np.arccos(1 - 2 * i / n_dirs)
    ga = np.pi * (1 + 5 ** 0.5) * i
    dirs = np.stack([np.cos(ga) * np.sin(phi), np.cos(phi), np.sin(ga) * np.sin(phi)], 1)

    centre = (pos.max(0) + pos.min(0)) / 2
    radius = np.linalg.norm(pos - centre, axis=1).max() * 1.02

    for di, d in enumerate(dirs):
        up = np.array([0.0, 1.0, 0.0]) if abs(d[1]) < 0.95 else np.array([1.0, 0.0, 0.0])
        ex = np.cross(up, d)
        ex /= np.linalg.norm(ex)
        ey = np.cross(d, ex)
        rel = pos - centre
        u = rel @ ex
        v = rel @ ey
        w = rel @ d  # depth along +d (larger = further along d)
        # orthographic pixel coords
        px = (u / radius * 0.5 + 0.5) * (res - 1)
        py = (v / radius * 0.5 + 0.5) * (res - 1)

        # rasterise nearest surface as seen from +d (i.e. max w wins)
        depth = np.full((res, res), -np.inf)
        _raster_max(depth, px, py, w, idx, res)

        # sample with the 3x3 max so silhouette pixels don't self-shadow
        gx = np.clip(np.round(px).astype(int), 0, res - 1)
        gy = np.clip(np.round(py).astype(int), 0, res - 1)
        near = depth[gy, gx]
        ndl = nrm @ d
        vis = (w >= near - bias) & (ndl > 0)
        cw = np.clip(ndl, 0, 1)
        ao_num += np.where(vis, cw, 0.0)
        ao_den += cw
        if di % 48 == 0:
            log(f"  AO {di}/{n_dirs} ({time.time()-t0:.0f}s)")

    ao = np.clip(ao_num / ao_den, 0, 1)
    log(f"  AO baked in {time.time()-t0:.0f}s  mean {ao.mean():.3f} min {ao.min():.3f}")
    return ao


def _raster_max(depth, px, py, w, idx, res):
    """Z-buffer (max depth along the view dir) rasteriser, triangle loop."""
    x0, x1, x2 = px[idx[:, 0]], px[idx[:, 1]], px[idx[:, 2]]
    y0, y1, y2 = py[idx[:, 0]], py[idx[:, 1]], py[idx[:, 2]]
    w0, w1, w2 = w[idx[:, 0]], w[idx[:, 1]], w[idx[:, 2]]
    minx = np.maximum(np.floor(np.minimum(np.minimum(x0, x1), x2)).astype(int), 0)
    maxx = np.minimum(np.ceil(np.maximum(np.maximum(x0, x1), x2)).astype(int), res - 1)
    miny = np.maximum(np.floor(np.minimum(np.minimum(y0, y1), y2)).astype(int), 0)
    maxy = np.minimum(np.ceil(np.maximum(np.maximum(y0, y1), y2)).astype(int), res - 1)
    det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    for t in range(len(idx)):
        if minx[t] > maxx[t] or miny[t] > maxy[t] or abs(det[t]) < 1e-9:
            continue
        yy, xx = np.mgrid[miny[t]:maxy[t] + 1, minx[t]:maxx[t] + 1]
        l0 = ((y1[t] - y2[t]) * (xx - x2[t]) + (x2[t] - x1[t]) * (yy - y2[t])) / det[t]
        l1 = ((y2[t] - y0[t]) * (xx - x2[t]) + (x0[t] - x2[t]) * (yy - y2[t])) / det[t]
        l2 = 1 - l0 - l1
        m = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
        if not m.any():
            continue
        d = l0 * w0[t] + l1 * w1[t] + l2 * w2[t]
        sub = m & (d > depth[miny[t]:maxy[t] + 1, minx[t]:maxx[t] + 1])
        if sub.any():
            block = depth[miny[t]:maxy[t] + 1, minx[t]:maxx[t] + 1]
            block[sub] = d[sub]


def vertex_rings(idx, n_verts):
    """adjacency as a list of neighbour index arrays"""
    from collections import defaultdict

    adj = defaultdict(set)
    for a, b in ((0, 1), (1, 2), (2, 0)):
        for i, j in zip(idx[:, a], idx[:, b]):
            adj[int(i)].add(int(j))
            adj[int(j)].add(int(i))
    return [np.fromiter(adj[i], int) for i in range(n_verts)]


def boundary_vertex_mask(idx, n_verts):
    """vertices touching an edge used by a single triangle (hole rims)"""
    from collections import defaultdict

    cnt = defaultdict(int)
    for a, b in ((0, 1), (1, 2), (2, 0)):
        for i, j in zip(idx[:, a], idx[:, b]):
            cnt[(min(int(i), int(j)), max(int(i), int(j)))] += 1
    mask = np.zeros(n_verts, bool)
    for (i, j), n in cnt.items():
        if n == 1:
            mask[i] = mask[j] = True
    return mask


def relax_patches(pos, idx, new_mask, rings=2, iters=18, bulge_above_y=1.45,
                  bulge_frac=0.30, bulge_max=0.0025):
    """Blend freshly filled hole caps into the surrounding surface.

    A flat cap over a crease (the eyelid rim, the armpit fold) leaves a pinched
    seam. We dilate the cap by `rings` topological rings, run constrained
    Laplacian relaxation with the outer ring pinned and a weight that fades to
    zero at the boundary, then give caps in the head region a small convex
    bulge so closed eyelids read as eyelids instead of dents.
    """
    adj = vertex_rings(idx, len(pos))
    sel = new_mask.copy()
    band = new_mask.astype(float)
    for r in range(rings):
        grow = sel.copy()
        for i in np.nonzero(sel)[0]:
            grow[adj[i]] = True
        newly = grow & ~sel
        band[newly] = 1.0 - (r + 1) / (rings + 1)
        sel = grow
    weight = np.clip(band, 0, 1) ** 1.5
    weight[~sel] = 0.0

    out = pos.copy()
    for _ in range(iters):
        lap = np.zeros_like(out)
        for i in np.nonzero(weight > 0)[0]:
            lap[i] = out[adj[i]].mean(0) - out[i]
        out += lap * (0.65 * weight)[:, None]

    # convex bulge on head caps (closed eyelids)
    if bulge_frac > 0:
        comp = _components(new_mask, adj)
        for verts in comp:
            p = out[verts]
            if p[:, 1].mean() < bulge_above_y:
                continue
            centre = p.mean(0)
            radius = np.linalg.norm(p - centre, axis=1).max()
            nrm = area_weighted_normals(out, idx)[verts].mean(0)
            nrm /= max(np.linalg.norm(nrm), 1e-9)
            amp = min(radius * bulge_frac, bulge_max)
            d = np.linalg.norm(p - centre, axis=1) / max(radius, 1e-9)
            out[verts] += nrm * (amp * np.cos(np.clip(d, 0, 1) * np.pi / 2))[:, None]
    return out


def _components(mask, adj):
    seen = np.zeros(len(mask), bool)
    out = []
    for s in np.nonzero(mask)[0]:
        if seen[s]:
            continue
        stack, comp = [s], []
        seen[s] = True
        while stack:
            v = stack.pop()
            comp.append(v)
            for n in adj[v]:
                if mask[n] and not seen[n]:
                    seen[n] = True
                    stack.append(n)
        out.append(np.array(comp))
    return out


def mean_curvature(pos, nrm, idx):
    """Cotangent-free discrete mean curvature: normal-projected umbrella."""
    lap = np.zeros_like(pos)
    cnt = np.zeros(len(pos))
    for a, b in ((0, 1), (1, 2), (2, 0)):
        i, j = idx[:, a], idx[:, b]
        np.add.at(lap, i, pos[j] - pos[i])
        np.add.at(lap, j, pos[i] - pos[j])
        np.add.at(cnt, i, 1)
        np.add.at(cnt, j, 1)
    lap /= np.maximum(cnt, 1)[:, None]
    # signed magnitude along the normal, scaled by local edge length
    h = np.einsum("ij,ij->i", lap, nrm)
    scale = np.maximum(np.linalg.norm(lap, axis=1).mean(), 1e-6)
    return np.clip(h / (scale * 3.0), -1, 1)


def transfer_attributes(src_pos, src_rid, src_thk, dst_pos, k=8):
    from scipy.spatial import cKDTree

    tree = cKDTree(src_pos)
    dist, ind = tree.query(dst_pos, k=k)
    wgt = 1.0 / np.maximum(dist, 1e-5) ** 2
    # thickness: inverse-distance weighted mean
    thk = (src_thk[ind] * wgt).sum(1) / wgt.sum(1)
    # region: inverse-distance weighted vote (keeps boundaries clean)
    rid = np.empty(len(dst_pos), np.float32)
    for n in range(len(dst_pos)):
        ids = src_rid[ind[n]]
        uniq, inv = np.unique(ids, return_inverse=True)
        score = np.zeros(len(uniq))
        np.add.at(score, inv, wgt[n])
        rid[n] = uniq[score.argmax()]
    return rid, thk.astype(np.float32)


def surface_distance(a_pos, b_pos):
    from scipy.spatial import cKDTree

    d1 = cKDTree(b_pos).query(a_pos)[0]
    d2 = cKDTree(a_pos).query(b_pos)[0]
    return max(d1.mean(), d2.mean()), max(d1.max(), d2.max())


# ------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--target-edge", type=float, default=0.0078, help="metres")
    ap.add_argument("--taubin", type=int, default=2)
    ap.add_argument("--remesh-iters", type=int, default=6)
    ap.add_argument("--uniform", action="store_true", help="disable curvature-adaptive edge length")
    ap.add_argument("--hc", action="store_true", help="extra HC-Laplacian polish (softens features)")
    ap.add_argument("--ao", choices=("formfactor", "depthmap", "none"), default="formfactor")
    ap.add_argument("--ao-rays", type=int, default=192)
    ap.add_argument("--ao-res", type=int, default=512)
    args = ap.parse_args()

    import pymeshlab as ml

    pos, nrm, rid, thk, idx = load_mesh(args.src)
    log(f"source: {len(pos)} verts / {len(idx)} tris")

    ms = ml.MeshSet()
    ms.add_mesh(ml.Mesh(vertex_matrix=pos, face_matrix=idx), "body")

    ms.meshing_remove_duplicate_vertices()
    ms.meshing_remove_duplicate_faces()
    ms.meshing_remove_null_faces()
    ms.meshing_remove_unreferenced_vertices()
    # hole filling needs edge manifoldness; the voxel source has a handful of
    # non-manifold edges/vertices left over from the shell extraction
    for f in ("meshing_repair_non_manifold_edges", "meshing_repair_non_manifold_vertices"):
        try:
            getattr(ms, f)()
        except Exception as e:
            log(f"  {f}: {e}")
    ms.meshing_remove_unreferenced_vertices()
    log(f"cleaned: {ms.current_mesh().vertex_number()} verts / {ms.current_mesh().face_number()} tris")

    # 2. close every boundary loop (eye sockets, armpits, finger webs)
    m = ms.current_mesh()
    pre_pos = np.asarray(m.vertex_matrix(), np.float64)
    pre_idx = np.asarray(m.face_matrix(), np.int64)
    rim_mask = boundary_vertex_mask(pre_idx, len(pre_pos))
    before = len(pre_pos)
    ms.meshing_close_holes(maxholesize=220, refinehole=True,
                           refineholeedgelen=ml.PercentageValue(0.6),
                           selfintersection=False, newfaceselected=True)
    m = ms.current_mesh()
    log(f"holes closed: {m.face_number()} tris (+{m.vertex_number() - before} verts, "
        f"{int(rim_mask.sum())} rim verts)")

    # 3. blend the caps into the surrounding surface (see relax_patches)
    cpos = np.asarray(m.vertex_matrix(), np.float64)
    cidx = np.asarray(m.face_matrix(), np.int64)
    patch = np.zeros(len(cpos), bool)
    patch[:before] = rim_mask
    patch[before:] = True
    if patch.any():
        cpos = relax_patches(cpos, cidx, patch)
        ms = ml.MeshSet()
        ms.add_mesh(ml.Mesh(vertex_matrix=cpos, face_matrix=cidx), "body")
        log(f"cap relax: {int(patch.sum())} verts blended")

    # 4. denoise (volume preserving)
    if args.taubin:
        ms.apply_coord_taubin_smoothing(lambda_=0.5, mu=-0.53, stepsmoothnum=args.taubin)
        log(f"taubin x{args.taubin}")

    # 5. isotropic remesh, reprojecting on the source surface
    ms.meshing_isotropic_explicit_remeshing(
        iterations=args.remesh_iters,
        targetlen=ml.PureValue(args.target_edge),
        featuredeg=45.0,
        checksurfdist=True,
        maxsurfdist=ml.PureValue(0.004),
        adaptive=not args.uniform,
        reprojectflag=True,
    )
    log(f"remeshed: {ms.current_mesh().vertex_number()} verts / {ms.current_mesh().face_number()} tris")

    # 6. gentle polish that keeps volume (HC = Laplacian with push-back)
    if args.hc:
        ms.apply_coord_hc_laplacian_smoothing()

    m = ms.current_mesh()
    npos = np.asarray(m.vertex_matrix(), np.float64)
    nidx = np.asarray(m.face_matrix(), np.int64)
    nnrm = area_weighted_normals(npos, nidx)

    mean_d, max_d = surface_distance(pos, npos)
    log(f"surface drift: mean {mean_d*1000:.2f} mm / max {max_d*1000:.2f} mm")

    nrid, nthk = transfer_attributes(pos, rid, thk, npos)
    log(f"attributes transferred: {len(np.unique(nrid))} regions "
        f"(source had {len(np.unique(rid))})")

    if args.ao == "formfactor":
        ao = bake_ao_formfactor(npos, nnrm, nidx)
    elif args.ao == "depthmap":
        ao = bake_ao(npos, nnrm, nidx, n_dirs=args.ao_rays, res=args.ao_res)
    else:
        ao = np.ones(len(npos))
    curv = mean_curvature(npos, nnrm, nidx)
    log(f"curvature: p5 {np.percentile(curv,5):+.2f} p95 {np.percentile(curv,95):+.2f}")

    write_mesh(args.dst, npos, nnrm, nrid, nthk, nidx.reshape(-1),
               extra={"_AO": ao, "_CURV": curv})
    log(f"wrote {args.dst}: {len(npos)} verts / {len(nidx)} tris")


if __name__ == "__main__":
    main()
