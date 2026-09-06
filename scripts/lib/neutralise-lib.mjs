// Geometry helpers for neutralise-universal.mjs (pure functions, no I/O).

/** Smooth Hermite interpolation, clamped to [0, 1]. */
export function smoothstep(e0, e1, v) {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Nearest-rank percentile of a numeric array. */
export function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = Float64Array.from(arr).sort();
  return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
}

/** vertex -> vertex adjacency from a TRIANGLES index buffer */
export function meshGraph(I, n) {
  const adj = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }
  return adj.map(s => [...s]);
}

/**
 * Pubic envelope z_env(y): robust anterior surface height of the groin,
 * sampled from the two lateral bands 45–100 mm off the midline (inner
 * thigh / groin crease), P90 per 10 mm y-slice over [y0, y1], linearly
 * interpolated.  This is where the neutral surface should sit.
 */
export function envelopeOf(x, y, z, n, y0, y1) {
  const slices = new Map();
  for (let i = 0; i < n; i++) {
    const ax = Math.abs(x(i));
    const yy = y(i), zz = z(i);
    if (ax < 0.045 || ax > 0.10 || yy < y0 || yy > y1 || zz <= 0.01) continue;
    const k = Math.round(yy / 0.01);
    if (!slices.has(k)) slices.set(k, []);
    slices.get(k).push(zz);
  }
  const pts = [...slices.entries()]
    .filter(([, v]) => v.length >= 4)
    .map(([k, v]) => [k * 0.01, percentile(v, 0.9)])
    .sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) throw new Error('envelope: not enough lateral band samples');
  return yy => {
    if (yy <= pts[0][0]) return pts[0][1];
    if (yy >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 1; i < pts.length; i++) {
      if (yy <= pts[i][0]) {
        const t = (yy - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
        return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]);
      }
    }
    return pts[pts.length - 1][1];
  };
}

/**
 * The full neutralisation pass over one decoded mesh (TRIANGLES, Y-up,
 * +Z anterior).  Returns new positions Q and updated normals N plus a
 * diagnostic report — P and I are never mutated.
 *
 * Only POSITION changes, and only inside the pubic patch; normals are
 * recomputed solely for vertices whose incident faces changed (the rest
 * keep their original values).  _REGIONID / _THICKNESS belong to
 * untouched accessors and ride along unchanged.
 */
export function neutraliseMesh(P, I, N0, n) {
  const x = i => P[i * 3], y = i => P[i * 3 + 1], z = i => P[i * 3 + 2];

  // 1. envelope + tip of the protrusion
  const env = envelopeOf(x, y, z, n, 0.60, 0.92);
  let tip = -1;
  for (let i = 0; i < n; i++) {
    if (Math.abs(x(i)) >= 0.05 || y(i) < 0.60 || y(i) > 0.85) continue;
    if (z(i) > env(y(i)) + 0.012 && (tip < 0 || z(i) > z(tip))) tip = i;
  }
  if (tip < 0) return null; // already universal
  const yLo = Math.max(0.60, y(tip) - 0.19), yHi = Math.min(0.90, y(tip) + 0.04);

  // 2. protrusion seeds → medial cluster → patch (3 rings, outer ring pinned)
  const seed = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(x(i)) < 0.048 && y(i) >= yLo && y(i) < yHi && z(i) > env(y(i)) + 0.012)
      seed.push(i);
  }
  const adj = meshGraph(I, n);
  // keep only components that touch the midline |x| < 12 mm — the genitals
  // are medial; a stray bump on a thigh must not be dragged in
  const cluster = connectedContaining(seed, adj, i => Math.abs(x(i)) < 0.012);
  const patch = dilate(cluster, adj, 3);
  const pinned = dilate(cluster, adj, 3, true); // outermost ring only

  // 3. envelope-weighted collapse: full at the tip, feathered at the base
  const prot = (P, i) => P[i * 3 + 2] - env(P[i * 3 + 1]);
  const Q = Float32Array.from(P);
  for (const i of patch) {
    if (pinned.has(i)) continue;
    const w = smoothstep(0.006, 0.026, prot(P, i)); // 0 at +6 mm, 1 at +26 mm
    const tx = x(i) * (1 - 0.15 * w);               // ease slightly toward midline
    const tz = env(y(i)) + 0.003;                   // target: flush with envelope
    Q[i * 3] = x(i) * (1 - w) + tx * w;
    Q[i * 3 + 2] = z(i) * (1 - w) + tz * w;
  }

  // 4. constrained Laplacian relaxation (6 gentle passes)
  for (let pass = 0; pass < 6; pass++) {
    const R = Float32Array.from(Q);
    for (const i of patch) {
      if (pinned.has(i)) continue;
      const nbs = adj[i];
      let cx = 0, cy = 0, cz = 0;
      for (const j of nbs) { cx += Q[j * 3]; cy += Q[j * 3 + 1]; cz += Q[j * 3 + 2]; }
      cx /= nbs.length; cy /= nbs.length; cz /= nbs.length;
      R[i * 3] = Q[i * 3] * 0.45 + cx * 0.55;
      R[i * 3 + 1] = Q[i * 3 + 1] * 0.45 + cy * 0.55;
      R[i * 3 + 2] = Q[i * 3 + 2] * 0.45 + cz * 0.55;
    }
    Q.set(R);
  }

  // 5. snap residual spikes, then clamp: nothing may protrude past env + 4 mm
  const medEdge = medianEdge(patch, adj, Q);
  for (let pass = 0; pass < 2; pass++) {
    for (const i of patch) {
      if (pinned.has(i)) continue;
      const nbs = adj[i];
      let cx = 0, cy = 0, cz = 0;
      for (const j of nbs) { cx += Q[j * 3]; cy += Q[j * 3 + 1]; cz += Q[j * 3 + 2]; }
      cx /= nbs.length; cy /= nbs.length; cz /= nbs.length;
      const d = Math.hypot(Q[i * 3] - cx, Q[i * 3 + 1] - cy, Q[i * 3 + 2] - cz);
      if (d > 2.2 * medEdge) { Q[i * 3] = cx; Q[i * 3 + 1] = cy; Q[i * 3 + 2] = cz; }
    }
  }
  let clamped = 0;
  for (const i of patch) {
    const cap = env(Q[i * 3 + 1]) + 0.004;
    if (Q[i * 3 + 2] > cap) { Q[i * 3 + 2] = cap; clamped++; }
  }

  // 6. diagnostics
  const maxBefore = Math.max(...[...cluster].map(i => prot(P, i)));
  const maxAfter = Math.max(...[...cluster].map(i => prot(Q, i)));

  // 7. selective normal update: only verts whose incident faces changed
  const moved = new Set();
  for (const i of patch)
    if (Math.hypot(Q[i * 3] - x(i), Q[i * 3 + 1] - y(i), Q[i * 3 + 2] - z(i)) > 1e-6) moved.add(i);
  const affected = new Set(moved);
  for (const i of moved) for (const j of adj[i]) affected.add(j);
  const N = Float32Array.from(N0);
  recomputeNormalsFor(Q, I, N, affected);
  // Degenerate-star guard: the build's female anchor-collapse left dense
  // coincident verts where accumulated normals cancel to near zero, and a
  // normalised zero vector is pure direction noise (Draco quantization can
  // then flip it). Borrow the neighbour-average direction instead.
  const nlen = i => Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
  for (const i of affected) {
    const l = nlen(i);
    if (l >= 0.05) { N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }
    else {
      let sx = 0, sy = 0, sz = 0;
      for (const j of adj[i]) { const lj = nlen(j); if (lj >= 0.05) { sx += N[j * 3] / lj; sy += N[j * 3 + 1] / lj; sz += N[j * 3 + 2] / lj; } }
      const sl = Math.hypot(sx, sy, sz);
      if (sl > 1e-6) { N[i * 3] = sx / sl; N[i * 3 + 1] = sy / sl; N[i * 3 + 2] = sz / sl; }
      else { N[i * 3] = N0[i * 3]; N[i * 3 + 1] = N0[i * 3 + 1]; N[i * 3 + 2] = N0[i * 3 + 2]; }
    }
  }

  return {
    Q, N, env, tip, yLo, yHi,
    cluster, patch, pinned, moved,
    report: { maxBefore, maxAfter, clamped },
  };
}

/** accumulate raw (unnormalized) area-weighted face normals for the given
 *  vertices — callers decide how to stabilise/normalise the result */
export function recomputeNormalsFor(P, I, N, verts) {
  for (const i of verts) { N[i * 3] = 0; N[i * 3 + 1] = 0; N[i * 3 + 2] = 0; }
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (!verts.has(a) && !verts.has(b) && !verts.has(c)) continue;
    const A = a * 3, B = b * 3, C = c * 3;
    const ux = P[B] - P[A], uy = P[B + 1] - P[A + 1], uz = P[B + 2] - P[A + 2];
    const vx = P[C] - P[A], vy = P[C + 1] - P[A + 1], vz = P[C + 2] - P[A + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const o of [A, B, C]) { if (verts.has(o / 3)) { N[o] += fx; N[o + 1] += fy; N[o + 2] += fz; } }
  }
}

/**
 * Sanity report: frontal rays (−Z) at the former cluster heights.  Each must
 * hit the mesh at a plausible pubic depth (≈ envelope) — proves the surface
 * is closed and flush where the genitals used to be.  Pure math, headless.
 */
export function rayReport(P, I, tipY, tag) {
  const hits = [tipY - 0.03, tipY, tipY + 0.02].map(yy => {
    let bestT = Infinity;
    for (let t = 0; t < I.length; t += 3) {
      const tt = rayTri(P, I[t], I[t + 1], I[t + 2], 0, yy, 1, 0, 0, -1);
      if (tt !== null && tt < bestT) bestT = tt;
    }
    return bestT === Infinity ? 'MISS' : `z=${(1 - bestT).toFixed(3)}`;
  });
  console.log(`  [${tag}] frontal rays at tipY−30/0/+20 mm: ${hits.join('  ')}`);
}

// ---------------------------------------------------------------- private
function connectedContaining(seed, adj, pred) {
  const inSeed = new Set(seed);
  const seen = new Set();
  const out = new Set();
  for (const s of seed) {
    if (seen.has(s)) continue;
    const comp = [s], q = [s];
    seen.add(s);
    let touches = pred(s);
    while (q.length) {
      const v = q.pop();
      for (const w of adj[v]) if (inSeed.has(w) && !seen.has(w)) {
        seen.add(w); q.push(w); comp.push(w);
        if (pred(w)) touches = true;
      }
    }
    if (touches) for (const v of comp) out.add(v);
  }
  return out;
}

function dilate(set, adj, rings, outerOnly = false) {
  let cur = new Set(set);
  const all = new Set(set);
  for (let r = 0; r < rings; r++) {
    const next = new Set();
    for (const v of cur) for (const w of adj[v]) if (!all.has(w)) next.add(w);
    if (r === rings - 1 && outerOnly) return next; // ring added last
    for (const v of next) all.add(v);
    cur = next;
  }
  return all;
}

function medianEdge(patchSet, adj, Q) {
  const edges = [];
  for (const i of patchSet) for (const j of adj[i]) if (j > i)
    edges.push(Math.hypot(Q[i * 3] - Q[j * 3], Q[i * 3 + 1] - Q[j * 3 + 1], Q[i * 3 + 2] - Q[j * 3 + 2]));
  return percentile(edges, 0.5) || 0.004;
}

function rayTri(P, a, b, c, ox, oy, oz, dx, dy, dz) {
  const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
  const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
  const h = [dy * e2[2] - dz * e2[1], dz * e2[0] - dx * e2[2], dx * e2[1] - dy * e2[0]];
  const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  const s = [ox - P[a * 3], oy - P[a * 3 + 1], oz - P[a * 3 + 2]];
  const u = inv * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
  if (u < 0 || u > 1) return null;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = inv * (dx * q[0] + dy * q[1] + dz * q[2]);
  if (v < 0 || u + v > 1) return null;
  const t = inv * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
  return t > 0 ? t : null;
}
