import { draco } from '@gltf-transform/functions';
import { decodeIO } from './lib/decode-io.mjs';
import { smoothstep, meshGraph, recomputeNormalsFor } from './lib/neutralise-lib.mjs';

const file = 'public/models/body-male.glb';
const io = await decodeIO();
const doc = await io.read(file);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const posAtt = prim.getAttribute('POSITION');
const norAtt = prim.getAttribute('NORMAL');
const n = posAtt.getCount();

const P = new Float32Array(n * 3);
const N0 = new Float32Array(n * 3);
for (let i = 0; i < n; i++) {
  posAtt.getElement(i, P.subarray(i * 3, i * 3 + 3));
  norAtt.getElement(i, N0.subarray(i * 3, i * 3 + 3));
}

const idx = prim.getIndices();
const I = new Uint32Array(idx.getCount());
for (let i = 0; i < I.length; i++) I[i] = idx.getScalar(i);

const adj = meshGraph(I, n);

// Pubic anchor at the base of the pelvis / pubic bone
const anchor = [0.0, 0.775, 0.046];
const Q = Float32Array.from(P);
const moved = new Set();

for (let i = 0; i < n; i++) {
  const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
  if (Math.abs(px) < 0.10 && py > 0.50 && py < 0.82 && pz > 0.015) {
    const w_prot = smoothstep(0.015, 0.040, pz);
    const w_mid = 1 - smoothstep(0.040, 0.090, Math.abs(px));
    const w_top = 1 - smoothstep(0.765, 0.82, py);
    const w_low = smoothstep(0.50, 0.58, py);
    const k = 0.99 * w_prot * w_mid * w_top * w_low;
    if (k > 0.01) {
      Q[i * 3] = px * (1 - k) + anchor[0] * k;
      Q[i * 3 + 1] = py * (1 - k) + anchor[1] * k;
      Q[i * 3 + 2] = pz * (1 - k) + anchor[2] * k;
      if (k > 0.1) moved.add(i);
    }
  }
}

// 5 passes of constrained Laplacian relaxation on the moved cluster
for (let pass = 0; pass < 5; pass++) {
  const R = Float32Array.from(Q);
  for (const i of moved) {
    const nbs = adj[i];
    if (!nbs || !nbs.length) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const j of nbs) { cx += Q[j * 3]; cy += Q[j * 3 + 1]; cz += Q[j * 3 + 2]; }
    cx /= nbs.length; cy /= nbs.length; cz /= nbs.length;
    R[i * 3] = Q[i * 3] * 0.4 + cx * 0.6;
    R[i * 3 + 1] = Q[i * 3 + 1] * 0.4 + cy * 0.6;
    R[i * 3 + 2] = Q[i * 3 + 2] * 0.4 + cz * 0.6;
  }
  Q.set(R);
}

// Recompute normals for affected vertices
const affected = new Set(moved);
for (const i of moved) for (const j of adj[i]) affected.add(j);
const N = Float32Array.from(N0);
recomputeNormalsFor(Q, I, N, affected);

const nlen = i => Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
for (const i of affected) {
  const l = nlen(i);
  if (l >= 0.05) { N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }
}

for (let i = 0; i < n; i++) {
  posAtt.setElement(i, [Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]]);
  norAtt.setElement(i, [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]);
}

// Compress with Draco
await doc.transform(draco());
await io.write(file, doc);
console.log('Successfully written compressed neutralised male body to', file);
