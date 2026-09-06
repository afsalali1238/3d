#!/usr/bin/env node
// neutralise-universal.mjs — make both body models anatomically universal.
//
// Removes the genital geometry from public/models/body-{male,female}.glb in
// place while keeping every other silhouette trait (shoulders, hips, chest)
// untouched, so the Male/Female toggle still works.
//
// The pass (implemented in ./lib/neutralise-lib.mjs) is adaptive — no
// per-model hardcoded coordinates:
//   1. Pubic envelope z_env(y): robust (P90) anterior z of the surrounding
//      groin surface, sampled from the two lateral bands 45–100 mm off the
//      midline (inner thigh / groin crease).
//   2. Tip: the most protruding medial vertex (|x| < 50 mm, y ∈ [0.60, 0.85],
//      z > z_env + 12 mm) anchors the working band [tipY − 190 mm, tipY + 40 mm]
//      — wide enough to include the scrotum, tight enough to leave the lower
//      abdomen alone.  If nothing protrudes, the model is already universal.
//   3. Cluster = protrusion seeds (|x| < 48 mm, in band, z > z_env + 12 mm)
//      dilated into a patch 3 topology rings wide; the outer ring is pinned.
//   4. Collapse: smoothstep weight on how far past the envelope a vertex sits
//      (tips collapse fully, bases barely move → no stretched triangles),
//      sliding verts back onto the envelope.  Then constrained Laplacian
//      relaxation of the patch, residual-spike snapping, an envelope + 4 mm
//      clamp, and area-weighted normal recomputation.
//
// _REGIONID / _THICKNESS are left untouched — only POSITION (and NORMAL,
// recomputed) change. The result is written uncompressed, then Draco-
// compressed with the exact pipeline of scripts/compress-models.sh.
//
// Usage:  node scripts/neutralise-universal.mjs [--check]
//         --check = analyse + report, write nothing.
import { NodeIO } from '@gltf-transform/core';
import { execSync } from 'node:child_process';
import { neutraliseMesh, rayReport } from './lib/neutralise-lib.mjs';
import { decodeIO } from './lib/decode-io.mjs';

const CHECK = process.argv.includes('--check');
const io = new NodeIO(); // uncompressed writer

for (const file of ['public/models/body-male.glb', 'public/models/body-female.glb']) {
  const doc = await (await decodeIO()).read(file);
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

  const result = neutraliseMesh(P, I, N0, n);
  if (!result) { console.log(`${file}: already universal — nothing protrudes. Skipped.`); continue; }
  const { Q, N, tip, cluster, patch, pinned, report } = result;
  const y = i => P[i * 3 + 1];

  console.log(`${file}: tip y=${y(tip).toFixed(3)} z=${(P[tip * 3 + 2]).toFixed(3)}, `
    + `cluster=${cluster.size} verts, patch=${patch.size} (pinned ${pinned.size}), `
    + `max protrusion ${(report.maxBefore * 1000).toFixed(1)} mm`);
  rayReport(P, I, y(tip), 'before');

  if (CHECK) continue;

  for (let i = 0; i < n; i++) {
    posAtt.setElement(i, [Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]]);
    norAtt.setElement(i, [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]);
  }
  await io.write(file, doc); // uncompressed
  // Draco-compress in place, identical to scripts/compress-models.sh
  execSync(`npx --yes gltf-transform draco "${file}" "${file}"`, { stdio: 'inherit' });

  console.log(`  → max protrusion ${(report.maxAfter * 1000).toFixed(1)} mm `
    + `(clamp touched ${report.clamped} verts); _REGIONID/_THICKNESS untouched`);
  rayReport(Q, I, y(tip), 'after ');
}
