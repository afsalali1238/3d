#!/usr/bin/env node
// dump-mesh.mjs — decode a (Draco) body GLB into the flat .bvmesh binary
// consumed by scripts/qa_render.py and scripts/refine_body_mesh.py.
//
// Usage: node scripts/dump-mesh.mjs public/models/body-male.glb build/male.bvmesh
import { decodeIO } from './lib/decode-io.mjs';
import { dumpMesh, findPrimitive } from './lib/mesh-io.mjs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: node scripts/dump-mesh.mjs <in.glb> <out.bvmesh>');
  process.exit(1);
}
const doc = await (await decodeIO()).read(src);
mkdirSync(dirname(out), { recursive: true });
const info = dumpMesh(findPrimitive(doc), out);
console.log(`${src} -> ${out}: ${info.vertexCount} verts, ${info.triangleCount} tris`);
