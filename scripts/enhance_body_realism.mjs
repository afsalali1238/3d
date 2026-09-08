#!/usr/bin/env node
/**
 * Geometry realism pass for the BodyViewer scan assets.
 *
 * This is deliberately asset-local and deterministic: it starts from the
 * small neutralised GLBs kept in scripts/base-models/, decodes Draco, applies
 * an adult-proportion / face / landmark sculpt, Loop-subdivides once for a
 * smoother silhouette, and bakes lightweight vertex channels consumed by the
 * skin shader:
 *   _AO    0..1 crease occlusion amount
 *   _CURV  signed mean-curvature cue (-1 convex, +1 concave)
 *   _TINT  +hair/beard pigment, -vermilion/rosy pigment
 *
 * The anatomical _REGIONID channel is copied and rounded at every step so all
 * 81 clickable regions remain present.  Genital-neutral geometry from the
 * base assets is preserved; the pass does not add explicit genital detail.
 */
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_DIR = join(ROOT, 'scripts', 'base-models');
const OUT_DIR = join(ROOT, 'public', 'models');
const SUBDIVISIONS = 1;

const DECODER = await draco3d.createDecoderModule();
const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({ 'draco3d.decoder': DECODER });

function clamp(v, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / Math.max(1e-9, e1 - e0));
  return t * t * (3 - 2 * t);
}
function gauss(x, sigma) { return Math.exp(-0.5 * (x / Math.max(1e-9, sigma)) ** 2); }
function hypot3(x, y, z) { return Math.hypot(x, y, z); }
function get3(a, i) { return [a[3 * i], a[3 * i + 1], a[3 * i + 2]]; }
function set3(a, i, x, y, z) { a[3 * i] = x; a[3 * i + 1] = y; a[3 * i + 2] = z; }
function addTo3(a, i, x, y, z) { a[3 * i] += x; a[3 * i + 1] += y; a[3 * i + 2] += z; }
function lerp(a, b, t) { return a + (b - a) * t; }

function percentile(values, p) {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  const x = (v.length - 1) * p;
  const i = Math.floor(x);
  const f = x - i;
  return v[i] * (1 - f) + v[Math.min(v.length - 1, i + 1)] * f;
}

async function readMesh(path) {
  const doc = await io.read(path);
  const prim = doc.getRoot().listMeshes()[0]?.listPrimitives()[0];
  if (!prim) throw new Error(`No mesh primitive in ${path}`);
  const pos = new Float32Array(prim.getAttribute('POSITION').getArray());
  const nrm = new Float32Array(prim.getAttribute('NORMAL').getArray());
  const regA = prim.getAttribute('_REGIONID') ?? prim.getAttribute('_regionid');
  const thkA = prim.getAttribute('_THICKNESS') ?? prim.getAttribute('_thickness');
  if (!regA || !thkA) throw new Error(`${path} must contain _REGIONID and _THICKNESS`);
  const rawReg = regA.getArray();
  const region = new Float32Array(rawReg.length);
  for (let i = 0; i < rawReg.length; i++) region[i] = Math.round(rawReg[i]);
  const thickness = new Float32Array(thkA.getArray());
  const idx = prim.getIndices().getArray();
  const indices = idx instanceof Uint32Array ? new Uint32Array(idx) : Uint32Array.from(idx);
  return { positions: pos, normals: nrm, indices, region, thickness };
}

function buildTopology(indices, vertexCount) {
  const neighbors = Array.from({ length: vertexCount }, () => new Set());
  const edgeMap = new Map();
  const edges = [];
  const edgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const addEdge = (a, b, opp) => {
    neighbors[a].add(b);
    neighbors[b].add(a);
    const key = edgeKey(a, b);
    let e = edgeMap.get(key);
    if (!e) {
      e = { a: Math.min(a, b), b: Math.max(a, b), opp: [] };
      edgeMap.set(key, e);
      edges.push(e);
    }
    e.opp.push(opp);
  };
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    addEdge(a, b, c);
    addEdge(b, c, a);
    addEdge(c, a, b);
  }
  return { neighbors, edgeMap, edges, edgeKey };
}

function recomputeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    const ax = positions[3 * a], ay = positions[3 * a + 1], az = positions[3 * a + 2];
    const bx = positions[3 * b], by = positions[3 * b + 1], bz = positions[3 * b + 2];
    const cx = positions[3 * c], cy = positions[3 * c + 1], cz = positions[3 * c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    addTo3(normals, a, nx, ny, nz);
    addTo3(normals, b, nx, ny, nz);
    addTo3(normals, c, nx, ny, nz);
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return normals;
}

function fillBoundaryHoles(mesh) {
  const { positions, indices, region, thickness } = mesh;
  const vertexCount = region.length;
  const { edges } = buildTopology(indices, vertexCount);
  const boundaryEdges = edges.filter((e) => e.opp.length === 1);
  if (!boundaryEdges.length) return mesh;

  const adj = new Map();
  for (const e of boundaryEdges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(e.b);
    adj.get(e.b).push(e.a);
  }

  const seen = new Set();
  const loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const comp = [];
    seen.add(start);
    while (stack.length) {
      const v = stack.pop();
      comp.push(v);
      for (const nb of adj.get(v) ?? []) {
        if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
      }
    }
    // Fill compact boundary loops/components (eyes, armpits, neutralised
    // groin patch, finger webs, and small source slivers).  Truly huge open
    // components would indicate a broken source mesh, so skip those.
    if (comp.length >= 3 && comp.length <= 420) {
      const set = new Set(comp);
      const compEdges = boundaryEdges.filter((e) => set.has(e.a) && set.has(e.b));
      loops.push({ vertices: comp, edges: compEdges });
    }
  }
  if (!loops.length) return mesh;

  const sourceNormals = recomputeNormals(positions, indices);
  const extraPos = [];
  const extraReg = [];
  const extraThk = [];
  const extraTris = [];

  for (const loop of loops) {
    const comp = loop.vertices;
    let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0, th = 0;
    const votes = new Map();
    for (const i of comp) {
      cx += positions[3 * i]; cy += positions[3 * i + 1]; cz += positions[3 * i + 2];
      nx += sourceNormals[3 * i]; ny += sourceNormals[3 * i + 1]; nz += sourceNormals[3 * i + 2];
      th += thickness[i];
      const r = Math.round(region[i]);
      votes.set(r, (votes.get(r) ?? 0) + 1);
    }
    cx /= comp.length; cy /= comp.length; cz /= comp.length; th /= comp.length;
    let nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    // Eye apertures in the source are real front-facing holes. Surrounding
    // boundary normals can cancel or point into the socket, so force the cap
    // normal forward; otherwise recomputed vertex normals make closed lids
    // render as black pits.
    if (cy > 1.52 && cy < 1.64 && cz > 0.035) {
      nx = 0;
      ny = 0.12;
      nz = 0.993;
    }

    let bestR = Math.round(region[comp[0]]), bestC = -1;
    for (const [r, c] of votes) if (c > bestC) { bestR = r; bestC = c; }
    // Eye-hole boundary vertices include forehead/temple spill; force the cap
    // to face/jaw when it is in the canonical eye band so it shades like skin,
    // not hair.
    if (cy > 1.52 && cy < 1.64 && cz > 0.035) bestR = 5;

    const ci = vertexCount + extraReg.length;
    extraPos.push(cx, cy, cz);
    extraReg.push(bestR);
    extraThk.push(Math.max(0.028, th));

    // Add one cap triangle per *actual boundary edge*.  This is more robust
    // than a polygon fan sorted by angle: the BodyParts3D skin contains
    // duplicated and branching eyelid boundary loops, and an angle fan leaves
    // the original boundary edges open.
    for (const e of loop.edges) {
      const a0 = e.a;
      const b0 = e.b;
      const ax0 = positions[3 * a0] - cx;
      const ay0 = positions[3 * a0 + 1] - cy;
      const az0 = positions[3 * a0 + 2] - cz;
      const bx0 = positions[3 * b0] - cx;
      const by0 = positions[3 * b0 + 1] - cy;
      const bz0 = positions[3 * b0 + 2] - cz;
      const fnx = ay0 * bz0 - az0 * by0;
      const fny = az0 * bx0 - ax0 * bz0;
      const fnz = ax0 * by0 - ay0 * bx0;
      if (fnx * nx + fny * ny + fnz * nz < 0) extraTris.push(ci, b0, a0);
      else extraTris.push(ci, a0, b0);
    }
  }

  const outPos = new Float32Array(positions.length + extraPos.length);
  outPos.set(positions); outPos.set(extraPos, positions.length);
  const outReg = new Float32Array(region.length + extraReg.length);
  outReg.set(region); outReg.set(extraReg, region.length);
  const outThk = new Float32Array(thickness.length + extraThk.length);
  outThk.set(thickness); outThk.set(extraThk, thickness.length);
  const outIdx = new Uint32Array(indices.length + extraTris.length);
  outIdx.set(indices); outIdx.set(extraTris, indices.length);
  console.log(`  filled ${loops.length} boundary holes (${extraTris.length / 3} cap tris)`);
  return { positions: outPos, normals: recomputeNormals(outPos, outIdx), indices: outIdx, region: outReg, thickness: outThk };
}

function loopSubdivision(mesh) {
  const { positions, indices, region, thickness } = mesh;
  const vertexCount = positions.length / 3;
  const { neighbors, edges, edgeMap, edgeKey } = buildTopology(indices, vertexCount);
  const newCount = vertexCount + edges.length;
  const outPos = new Float32Array(newCount * 3);
  const outReg = new Float32Array(newCount);
  const outThk = new Float32Array(newCount);

  const boundaryNeighbors = Array.from({ length: vertexCount }, () => []);
  for (const e of edges) {
    if (e.opp.length === 1) {
      boundaryNeighbors[e.a].push(e.b);
      boundaryNeighbors[e.b].push(e.a);
    }
  }

  // Reposition original vertices with Loop weights.  Region and thickness stay
  // exact on originals; only geometry gets smoothed.
  for (let i = 0; i < vertexCount; i++) {
    const p = get3(positions, i);
    const bnd = boundaryNeighbors[i];
    let x = p[0], y = p[1], z = p[2];
    if (bnd.length >= 2) {
      const a = get3(positions, bnd[0]);
      const b = get3(positions, bnd[1]);
      x = 0.75 * p[0] + 0.125 * (a[0] + b[0]);
      y = 0.75 * p[1] + 0.125 * (a[1] + b[1]);
      z = 0.75 * p[2] + 0.125 * (a[2] + b[2]);
    } else {
      const nb = [...neighbors[i]];
      const n = nb.length;
      if (n > 2) {
        const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
        let sx = 0, sy = 0, sz = 0;
        for (const j of nb) { sx += positions[3 * j]; sy += positions[3 * j + 1]; sz += positions[3 * j + 2]; }
        x = (1 - n * beta) * p[0] + beta * sx;
        y = (1 - n * beta) * p[1] + beta * sy;
        z = (1 - n * beta) * p[2] + beta * sz;
      }
    }
    set3(outPos, i, x, y, z);
    outReg[i] = region[i];
    outThk[i] = thickness[i];
  }

  // Edge vertices.
  const edgeIndex = new Map();
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    const outI = vertexCount + ei;
    edgeIndex.set(edgeKey(e.a, e.b), outI);
    const pa = get3(positions, e.a), pb = get3(positions, e.b);
    let x, y, z;
    if (e.opp.length >= 2) {
      const pc = get3(positions, e.opp[0]);
      const pd = get3(positions, e.opp[1]);
      x = 0.375 * (pa[0] + pb[0]) + 0.125 * (pc[0] + pd[0]);
      y = 0.375 * (pa[1] + pb[1]) + 0.125 * (pc[1] + pd[1]);
      z = 0.375 * (pa[2] + pb[2]) + 0.125 * (pc[2] + pd[2]);
    } else {
      x = 0.5 * (pa[0] + pb[0]);
      y = 0.5 * (pa[1] + pb[1]);
      z = 0.5 * (pa[2] + pb[2]);
    }
    set3(outPos, outI, x, y, z);
    outThk[outI] = 0.5 * (thickness[e.a] + thickness[e.b]);

    // Region boundaries are categorical, not interpolated: choose the local
    // modal id from the edge endpoints and opposite vertices.
    const votes = [region[e.a], region[e.b], ...e.opp.map((o) => region[o])].map(Math.round);
    const counts = new Map();
    let best = votes[0], bestC = -1;
    for (const v of votes) {
      const c = (counts.get(v) ?? 0) + 1;
      counts.set(v, c);
      if (c > bestC) { best = v; bestC = c; }
    }
    outReg[outI] = best;
  }

  const outIdx = new Uint32Array((indices.length / 3) * 12);
  let k = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    const ab = edgeIndex.get(edgeKey(a, b));
    const bc = edgeIndex.get(edgeKey(b, c));
    const ca = edgeIndex.get(edgeKey(c, a));
    outIdx.set([a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca], k);
    k += 12;
  }

  return {
    positions: outPos,
    normals: recomputeNormals(outPos, outIdx),
    indices: outIdx,
    region: outReg,
    thickness: outThk,
  };
}

function landmarkInfo(positions, region) {
  const n = region.length;
  let minY = Infinity, maxY = -Infinity;
  const headXs = [], faceXs = [], faceZs = [], faceYs = [];
  for (let i = 0; i < n; i++) {
    const y = positions[3 * i + 1];
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    const r = Math.round(region[i]);
    if (r >= 1 && r <= 7) {
      headXs.push(positions[3 * i]);
    }
    if (r === 5 || r === 6 || r === 7) {
      faceXs.push(positions[3 * i]);
      faceYs.push(y);
      faceZs.push(positions[3 * i + 2]);
    }
  }
  const chin = percentile(faceYs, 0.02) || maxY - 0.15 * (maxY - minY);
  const crown = maxY;
  const headLen = Math.max(0.18, crown - chin);
  return {
    minY,
    maxY,
    height: maxY - minY,
    chin,
    crown,
    headLen,
    headCenterX: percentile(headXs, 0.5),
    headHalfWidth: Math.max(0.055, percentile(headXs.map(Math.abs), 0.95)),
    faceFrontZ: percentile(faceZs, 0.92),
    faceMidZ: percentile(faceZs, 0.55),
  };
}

function applyProportions(mesh) {
  const { positions, region } = mesh;
  const lm = landmarkInfo(positions, region);
  const currentHeads = lm.height / lm.headLen;
  const targetHeads = 7.35;
  const headScale = clamp(currentHeads / targetHeads, 0.875, 0.965);
  const pivotY = lm.chin - 0.012 * lm.height;
  const pivotZ = lm.faceMidZ - 0.015;
  for (let i = 0; i < region.length; i++) {
    const r = Math.round(region[i]);
    const y = positions[3 * i + 1];
    const headish = r >= 1 && r <= 8;
    const w = headish ? smoothstep(lm.chin - 0.055 * lm.height, lm.chin + 0.025 * lm.height, y) : 0;
    if (w <= 0) continue;
    const s = lerp(1, headScale, w);
    positions[3 * i] = lm.headCenterX + (positions[3 * i] - lm.headCenterX) * s;
    positions[3 * i + 1] = pivotY + (positions[3 * i + 1] - pivotY) * s;
    positions[3 * i + 2] = pivotZ + (positions[3 * i + 2] - pivotZ) * lerp(1, headScale * 0.96, w);
  }

  // Replant feet after the head adjustment.
  let minY = Infinity;
  for (let i = 1; i < positions.length; i += 3) minY = Math.min(minY, positions[i]);
  if (Math.abs(minY) > 1e-6) for (let i = 1; i < positions.length; i += 3) positions[i] -= minY;
}

function sculptFaceAndLandmarks(mesh, gender) {
  const { positions, region } = mesh;
  let normals = recomputeNormals(positions, mesh.indices);
  let lm = landmarkInfo(positions, region);
  const hw = lm.headHalfWidth;
  const hl = lm.headLen;
  const hY = (y) => (y - lm.chin) / hl;
  const male = gender === 'male';

  const displaceNormal = (i, amount) => {
    positions[3 * i] += normals[3 * i] * amount;
    positions[3 * i + 1] += normals[3 * i + 1] * amount;
    positions[3 * i + 2] += normals[3 * i + 2] * amount;
  };
  const displaceZ = (i, amount) => { positions[3 * i + 2] += amount; };
  const displaceY = (i, amount) => { positions[3 * i + 1] += amount; };

  for (let pass = 0; pass < 2; pass++) {
    normals = recomputeNormals(positions, mesh.indices);
    lm = landmarkInfo(positions, region);
    for (let i = 0; i < region.length; i++) {
      const r = Math.round(region[i]);
      const x = positions[3 * i] - lm.headCenterX;
      const y = positions[3 * i + 1];
      const z = positions[3 * i + 2];
      const nz = normals[3 * i + 2];
      const hy = hY(y);
      const anterior = nz > 0.08 || z > lm.faceMidZ;
      if (r >= 1 && r <= 7 && anterior) {
        // Nose bridge and tip.
        displaceZ(i, 0.018 * gauss(x, hw * 0.13) * gauss(hy - 0.57, 0.10));
        displaceZ(i, 0.030 * gauss(x, hw * 0.17) * gauss(hy - 0.47, 0.055));
        // Nostrils and alae: raised wings with two dimples underneath.
        const nostril = (gauss(x - hw * 0.13, hw * 0.045) + gauss(x + hw * 0.13, hw * 0.045)) * gauss(hy - 0.405, 0.030);
        const alae = (gauss(x - hw * 0.18, hw * 0.070) + gauss(x + hw * 0.18, hw * 0.070)) * gauss(hy - 0.440, 0.050);
        displaceZ(i, 0.007 * alae - 0.007 * nostril);

        // Eye sockets, closed lids, brow ridge.
        const eyes = (gauss(x - hw * 0.34, hw * 0.125) + gauss(x + hw * 0.34, hw * 0.125));
        const socket = eyes * gauss(hy - 0.635, 0.060);
        const lidLine = eyes * gauss(hy - 0.625, 0.020);
        const lidCrease = eyes * gauss(hy - 0.685, 0.026);
        const brow = eyes * gauss(hy - 0.725, 0.042);
        displaceZ(i, -0.007 * socket + 0.007 * lidLine + 0.005 * lidCrease + 0.009 * brow);
        if (socket > 0.15) displaceY(i, -0.0025 * socket);

        // Lips, philtrum, mouth line, chin and cheeks.
        const mouthWidth = hw * 0.56;
        const mouthSlit = (1 - smoothstep(mouthWidth * 0.15, mouthWidth * 0.92, Math.abs(x))) * gauss(hy - 0.305, 0.016);
        const upperLip = (1 - smoothstep(mouthWidth * 0.10, mouthWidth * 0.75, Math.abs(x))) * gauss(hy - 0.332, 0.030);
        const lowerLip = (1 - smoothstep(mouthWidth * 0.10, mouthWidth * 0.82, Math.abs(x))) * gauss(hy - 0.264, 0.034);
        const philtrum = gauss(x, hw * 0.075) * gauss(hy - 0.365, 0.050);
        displaceZ(i, 0.009 * upperLip + 0.011 * lowerLip - 0.006 * mouthSlit - 0.006 * philtrum);
        const chin = gauss(x, hw * 0.28) * gauss(hy - 0.125, 0.065);
        const mentolabial = gauss(x, hw * 0.32) * gauss(hy - 0.205, 0.030);
        displaceZ(i, 0.014 * chin - 0.009 * mentolabial);
        const cheek = (gauss(x - hw * 0.43, hw * 0.18) + gauss(x + hw * 0.43, hw * 0.18)) * gauss(hy - 0.49, 0.105);
        displaceZ(i, 0.010 * cheek);
        // Very subtle jaw taper so the lower face stops reading as a sphere.
        const jaw = smoothstep(0.05, 0.22, hy) * (1 - smoothstep(0.25, 0.45, hy)) * smoothstep(hw * 0.20, hw * 0.70, Math.abs(x));
        positions[3 * i] += Math.sign(x) * (male ? 0.004 : -0.002) * jaw;
      }

      // Body landmarks visible at full-body distance.
      const front = normals[3 * i + 2] > 0.18;
      if (front) {
        // Sternal groove / linea alba.
        const midline = gauss(positions[3 * i], 0.010);
        const sternum = smoothstep(1.12, 1.27, y) * (1 - smoothstep(1.34, 1.42, y));
        const linea = smoothstep(0.82, 0.94, y) * (1 - smoothstep(1.08, 1.22, y));
        displaceNormal(i, -0.006 * midline * sternum - 0.0045 * midline * linea);
        // Navel.
        displaceNormal(i, -0.014 * gauss(positions[3 * i], 0.022) * gauss(y - 1.015, 0.030));
        // Clavicles as shallow diagonal ridges.
        const ax = Math.abs(positions[3 * i]);
        const clavY = 1.355 + 0.30 * ax;
        const clav = smoothstep(0.030, 0.155, ax) * (1 - smoothstep(0.155, 0.245, ax)) * gauss(y - clavY, 0.018);
        displaceNormal(i, 0.006 * clav);
        // Patellae.
        for (const sx of [-1, 1]) {
          const knee = gauss(positions[3 * i] - sx * 0.075, 0.037) * gauss(y - 0.465, 0.040);
          displaceNormal(i, 0.007 * knee);
        }
      }
    }
  }
  mesh.normals = recomputeNormals(positions, mesh.indices);
}

function softenNeutralGroin(mesh) {
  const { positions, region } = mesh;
  const n = region.length;
  const lateral = [];
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i];
    const y = positions[3 * i + 1];
    const z = positions[3 * i + 2];
    if (y > 0.62 && y < 0.86 && Math.abs(x) > 0.075 && Math.abs(x) < 0.18 && z > -0.02) {
      lateral.push([y, z]);
    }
  }
  const envAt = (y0) => {
    const zs = lateral.filter(([y]) => Math.abs(y - y0) < 0.035).map(([, z]) => z);
    if (zs.length < 8) return 0.040;
    return percentile(zs, 0.62);
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const r = Math.round(region[i]);
      const x = positions[3 * i];
      const y = positions[3 * i + 1];
      const z = positions[3 * i + 2];
      if (!(r === 48 || r === 52 || r === 53 || r === 54 || r === 55)) continue;
      const central = 1 - smoothstep(0.020, 0.095, Math.abs(x));
      const vertical = smoothstep(0.63, 0.70, y) * (1 - smoothstep(0.81, 0.88, y));
      const w = central * vertical;
      if (w <= 0) continue;
      const target = envAt(y) + 0.004 * gauss(y - 0.755, 0.070) * (1 - smoothstep(0.0, 0.10, Math.abs(x)));
      positions[3 * i + 2] = lerp(z, Math.min(z, target + 0.002), 0.82 * w);
    }
  }
}

function bakeChannels(mesh, gender) {
  const { positions, indices, region, thickness } = mesh;
  const n = region.length;
  const { neighbors } = buildTopology(indices, n);
  const normals = recomputeNormals(positions, indices);
  mesh.normals = normals;
  const lm = landmarkInfo(positions, region);
  const hw = lm.headHalfWidth;
  const hl = lm.headLen;
  const tint = new Float32Array(n);
  const curv = new Float32Array(n);
  const ao = new Float32Array(n);
  const male = gender === 'male';

  // Mean edge length for curvature normalisation.
  let totalLen = 0, edgeN = 0;
  for (let i = 0; i < n; i++) {
    for (const j of neighbors[i]) {
      if (j <= i) continue;
      totalLen += hypot3(
        positions[3 * i] - positions[3 * j],
        positions[3 * i + 1] - positions[3 * j + 1],
        positions[3 * i + 2] - positions[3 * j + 2],
      );
      edgeN++;
    }
  }
  const edgeLen = totalLen / Math.max(1, edgeN);

  for (let i = 0; i < n; i++) {
    const r = Math.round(region[i]);
    const x = positions[3 * i] - lm.headCenterX;
    const ax = Math.abs(positions[3 * i]);
    const y = positions[3 * i + 1];
    const z = positions[3 * i + 2];
    const nz = normals[3 * i + 2];
    const hy = (y - lm.chin) / hl;
    const nb = [...neighbors[i]];
    let sx = 0, sy = 0, sz = 0;
    for (const j of nb) { sx += positions[3 * j]; sy += positions[3 * j + 1]; sz += positions[3 * j + 2]; }
    if (nb.length) {
      sx = sx / nb.length - positions[3 * i];
      sy = sy / nb.length - positions[3 * i + 1];
      sz = sz / nb.length - positions[3 * i + 2];
    }
    const signed = (sx * normals[3 * i] + sy * normals[3 * i + 1] + sz * normals[3 * i + 2]) / Math.max(1e-5, edgeLen);
    curv[i] = clamp(signed * 0.85, -1, 1);
    const cavity = smoothstep(0.035, 0.32, signed);
    const crease = Math.max(0, cavity);

    // Anatomical occlusion boosts. These are intentionally broad; the shader
    // keeps them subtle and colour-correct rather than black dirt.
    const eyeOcc = (r >= 1 && r <= 7)
      ? (gauss(x - hw * 0.34, hw * 0.11) + gauss(x + hw * 0.34, hw * 0.11)) * gauss(hy - 0.63, 0.050)
      : 0;
    const mouthOcc = (r >= 1 && r <= 7)
      ? (1 - smoothstep(hw * 0.10, hw * 0.48, Math.abs(x))) * gauss(hy - 0.305, 0.018)
      : 0;
    const nostrilOcc = (r >= 1 && r <= 7)
      ? (gauss(x - hw * 0.13, hw * 0.045) + gauss(x + hw * 0.13, hw * 0.045)) * gauss(hy - 0.405, 0.028)
      : 0;
    const neckOcc = gauss(y - (lm.chin - 0.02), 0.035) * smoothstep(0.00, 0.11, ax) * (1 - smoothstep(0.11, 0.22, ax));
    const armpitOcc = (gauss(ax - 0.185, 0.038) * smoothstep(1.12, 1.22, y) * (1 - smoothstep(1.28, 1.38, y)));
    const groinOcc = gauss(ax, 0.055) * smoothstep(0.62, 0.71, y) * (1 - smoothstep(0.78, 0.88, y)) * smoothstep(0.015, 0.070, z);
    const kneeBack = (r === 66 || r === 67) ? gauss(y - 0.47, 0.035) : 0;
    ao[i] = clamp(0.06 * crease + 0.08 * eyeOcc + 0.12 * mouthOcc + 0.10 * nostrilOcc + 0.08 * neckOcc + 0.16 * armpitOcc + 0.05 * groinOcc + 0.08 * kneeBack, 0, 0.56);

    let t = 0;
    if (r >= 1 && r <= 7) {
      const headBack = (1 - smoothstep(-0.055, -0.01, nz)) * smoothstep(0.43, 0.76, hy);
      const hairCap = smoothstep(0.78, 0.90, hy) * (1 - smoothstep(0.94, 1.03, hy));
      const sideHair = smoothstep(hw * 0.78, hw * 0.99, Math.abs(x)) * smoothstep(0.52, 0.66, hy) * (1 - smoothstep(0.76, 0.88, hy));
      const hair = Math.max(headBack * 0.85, hairCap * 0.74, sideHair * 0.52) * (gender === 'female' ? 0.62 : 0.70);
      const brows = (gauss(x - hw * 0.34, hw * 0.105) + gauss(x + hw * 0.34, hw * 0.105)) * gauss(hy - 0.716, 0.020);
      const lashes = (gauss(x - hw * 0.34, hw * 0.110) + gauss(x + hw * 0.34, hw * 0.110)) * gauss(hy - 0.626, 0.010);
      const beard = male
        ? smoothstep(0.04, 0.18, hy) * (1 - smoothstep(0.42, 0.56, hy)) * smoothstep(0.02, 0.16, z - lm.faceMidZ) * 0.25
        : 0.03 * smoothstep(0.10, 0.25, hy) * (1 - smoothstep(0.35, 0.48, hy));
      t = Math.max(t, hair, 0.20 * brows, 0.05 * lashes, beard);

      const lip = (1 - smoothstep(hw * 0.11, hw * 0.50, Math.abs(x))) * gauss(hy - 0.300, 0.048);
      if (lip > 0.04) t = -Math.max(-t, lip * 0.86);
    }
    // Subtle rosy anatomical marks: nipples, knuckles, knees/elbows.
    if (r === 39 || r === 40) {
      const side = positions[3 * i] > 0 ? 1 : -1;
      const nipple = gauss(positions[3 * i] - side * 0.070, 0.021) * gauss(y - 1.245, 0.025) * smoothstep(0.02, 0.09, z);
      if (nipple > 0.03) t = Math.min(t, -0.30 * nipple);
    }
    if (r === 25 || r === 26 || r === 60 || r === 61) {
      t = Math.min(t, -0.08 * gauss(y - (r === 25 || r === 26 ? 1.13 : 0.47), 0.045));
    }
    tint[i] = clamp(t, -1, 1);

    // Thickness improves in high-res edge vertices: very thin tips keep a low
    // value, but face landmarks should not accidentally glow like ears.
    if (r >= 1 && r <= 7 && z > lm.faceMidZ && hy > 0.2 && hy < 0.75) {
      thickness[i] = Math.max(thickness[i], 0.035);
    }
  }

  mesh.ao = ao;
  mesh.curv = curv;
  mesh.tint = tint;
}

function polishDisplayNormals(mesh) {
  const { positions, indices, region } = mesh;
  const normals = recomputeNormals(positions, indices);
  const lm = landmarkInfo(positions, region);
  const hw = lm.headHalfWidth;
  const hl = lm.headLen;
  const normalize = (x, y, z) => {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  for (let i = 0; i < region.length; i++) {
    const r = Math.round(region[i]);
    const x = positions[3 * i] - lm.headCenterX;
    const y = positions[3 * i + 1];
    const z = positions[3 * i + 2];
    const hy = (y - lm.chin) / hl;
    let w = 0;
    let target = null;
    if (r >= 1 && r <= 7) {
      const faceFront = smoothstep(lm.faceMidZ - 0.020, lm.faceFrontZ + 0.010, z)
        * smoothstep(0.08, 0.30, hy)
        * (1 - smoothstep(0.82, 0.96, hy));
      const eyes = (gauss(x - hw * 0.34, hw * 0.14) + gauss(x + hw * 0.34, hw * 0.14)) * gauss(hy - 0.63, 0.070);
      const noseMouth = gauss(x, hw * 0.28) * gauss(hy - 0.38, 0.17);
      w = clamp(faceFront * 0.48 + eyes * 0.38 + noseMouth * 0.22, 0, 0.78);
      target = normalize(x / (hw * 3.2), (hy - 0.46) * 0.16, 1.0);
    }
    // Smooth normals across the neutral pubic patch so it reads as skin, not a
    // black gash, while keeping geometry and region ids intact.
    const groinW = (r === 48 || r === 52 || r === 53 || r === 54 || r === 55)
      ? (1 - smoothstep(0.018, 0.090, Math.abs(positions[3 * i]))) * smoothstep(0.63, 0.70, y) * (1 - smoothstep(0.81, 0.88, y))
      : 0;
    if (groinW > w) {
      w = clamp(groinW * 0.82, 0, 0.82);
      target = normalize(positions[3 * i] * 0.35, -0.18, 1.0);
    }
    if (target && w > 0) {
      const nx = normals[3 * i], ny = normals[3 * i + 1], nz = normals[3 * i + 2];
      const out = normalize(lerp(nx, target[0], w), lerp(ny, target[1], w), lerp(nz, target[2], w));
      normals[3 * i] = out[0]; normals[3 * i + 1] = out[1]; normals[3 * i + 2] = out[2];
    }
  }
  mesh.normals = normals;
}

function writeGlb(path, mesh, gender) {
  const { positions, normals, indices, region, thickness, ao, curv, tint } = mesh;
  const vertexCount = region.length;
  const indexArray = vertexCount > 65535 ? indices : Uint16Array.from(indices);
  const parts = [];
  const bufferViews = [];
  const accessors = [];
  let byteOffset = 0;
  const pad4 = (bytes, fill = 0) => {
    const pad = (4 - (bytes.byteLength % 4)) % 4;
    if (!pad) return bytes;
    const out = new Uint8Array(bytes.byteLength + pad);
    out.set(bytes);
    if (fill) out.fill(fill, bytes.byteLength);
    return out;
  };
  const asBytes = (arr) => new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const minMax = (arr, elementSize) => {
    const min = Array(elementSize).fill(Infinity);
    const max = Array(elementSize).fill(-Infinity);
    for (let i = 0; i < arr.length; i += elementSize) {
      for (let j = 0; j < elementSize; j++) {
        min[j] = Math.min(min[j], arr[i + j]);
        max[j] = Math.max(max[j], arr[i + j]);
      }
    }
    return { min, max };
  };
  const add = (arr, target, componentType, type, count, mm = false) => {
    const raw = pad4(asBytes(arr));
    bufferViews.push({ buffer: 0, byteOffset, byteLength: raw.byteLength, target });
    const acc = { bufferView: bufferViews.length - 1, componentType, count, type };
    if (mm) Object.assign(acc, minMax(arr, type === 'VEC3' ? 3 : 1));
    accessors.push(acc);
    parts.push(raw);
    byteOffset += raw.byteLength;
    return accessors.length - 1;
  };

  const aPos = add(positions, 34962, 5126, 'VEC3', vertexCount, true);
  const aNrm = add(normals, 34962, 5126, 'VEC3', vertexCount);
  const aReg = add(region, 34962, 5126, 'SCALAR', vertexCount);
  const aThk = add(thickness, 34962, 5126, 'SCALAR', vertexCount);
  const aAO = add(ao, 34962, 5126, 'SCALAR', vertexCount);
  const aCurv = add(curv, 34962, 5126, 'SCALAR', vertexCount);
  const aTint = add(tint, 34962, 5126, 'SCALAR', vertexCount);
  const aIdx = add(indexArray, 34963, vertexCount > 65535 ? 5125 : 5123, 'SCALAR', indexArray.length);

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'scripts/enhance_body_realism.mjs',
      copyright: 'BodyParts3D, (c) The Database Center for Life Science, CC BY 4.0',
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: `Body_${gender}_realism` }],
    meshes: [{ name: 'RealisticSkin', primitives: [{
      attributes: {
        POSITION: aPos,
        NORMAL: aNrm,
        _REGIONID: aReg,
        _THICKNESS: aThk,
        _AO: aAO,
        _CURV: aCurv,
        _TINT: aTint,
      },
      indices: aIdx,
      material: 0,
      mode: 4,
    }] }],
    materials: [{ name: 'Skin', pbrMetallicRoughness: {
      baseColorFactor: [0.74, 0.53, 0.43, 1],
      metallicFactor: 0,
      roughnessFactor: 0.57,
    } }],
    buffers: [{ byteLength: byteOffset }],
    bufferViews,
    accessors,
  };

  const jsonRaw = new TextEncoder().encode(JSON.stringify(gltf));
  const json = pad4(jsonRaw, 0x20);
  const bin = new Uint8Array(byteOffset);
  let off = 0;
  for (const p of parts) { bin.set(p, off); off += p.byteLength; }
  const total = 12 + 8 + json.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let o = 0;
  dv.setUint32(o, 0x46546c67, true); o += 4; // glTF
  dv.setUint32(o, 2, true); o += 4;
  dv.setUint32(o, total, true); o += 4;
  dv.setUint32(o, json.byteLength, true); o += 4;
  dv.setUint32(o, 0x4e4f534a, true); o += 4; // JSON
  out.set(json, o); o += json.byteLength;
  dv.setUint32(o, bin.byteLength, true); o += 4;
  dv.setUint32(o, 0x004e4942, true); o += 4; // BIN
  out.set(bin, o);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out);
}

function verify(mesh, label) {
  const ids = new Set(Array.from(mesh.region, (v) => Math.round(v)));
  const missing = [];
  for (let i = 1; i <= 81; i++) if (!ids.has(i)) missing.push(i);
  if (missing.length) throw new Error(`${label}: missing region ids ${missing.join(', ')}`);
  let minAO = Infinity, maxAO = -Infinity, minC = Infinity, maxC = -Infinity, minT = Infinity, maxT = -Infinity;
  for (let i = 0; i < mesh.region.length; i++) {
    minAO = Math.min(minAO, mesh.ao[i]); maxAO = Math.max(maxAO, mesh.ao[i]);
    minC = Math.min(minC, mesh.curv[i]); maxC = Math.max(maxC, mesh.curv[i]);
    minT = Math.min(minT, mesh.tint[i]); maxT = Math.max(maxT, mesh.tint[i]);
  }
  console.log(`${label}: ${mesh.region.length.toLocaleString()} verts, ${(mesh.indices.length / 3).toLocaleString()} tris, regions ${ids.size}/81, AO ${minAO.toFixed(2)}..${maxAO.toFixed(2)}, CURV ${minC.toFixed(2)}..${maxC.toFixed(2)}, TINT ${minT.toFixed(2)}..${maxT.toFixed(2)}`);
}

for (const gender of ['male', 'female']) {
  const src = join(SRC_DIR, `body-${gender}.glb`);
  console.log(`Reading base ${src}`);
  let mesh = await readMesh(src);
  mesh = fillBoundaryHoles(mesh);
  applyProportions(mesh);
  for (let i = 0; i < SUBDIVISIONS; i++) mesh = loopSubdivision(mesh);
  mesh = fillBoundaryHoles(mesh);
  sculptFaceAndLandmarks(mesh, gender);
  softenNeutralGroin(mesh);
  bakeChannels(mesh, gender);
  polishDisplayNormals(mesh);
  verify(mesh, gender);
  const out = join(OUT_DIR, `body-${gender}.glb`);
  writeGlb(out, mesh, gender);
  console.log(`wrote ${out} (${(statSync(out).size / 1024).toFixed(1)} KB uncompressed)`);
}

// Legacy neutral alias used by old embeds.
writeFileSync(join(OUT_DIR, 'body.glb'), readFileSync(join(OUT_DIR, 'body-male.glb')));
console.log('Updated public/models/body.glb alias. Run `npx gltf-transform draco public/models/body-male.glb public/models/body-male.glb` (and female) to ship compressed assets.');
