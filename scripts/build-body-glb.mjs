#!/usr/bin/env node
/**
 * build-body-glb.mjs — write a refined .bvmesh dump back out as a single-mesh
 * Draco-compressed GLB that satisfies public/models/ASSET-SPEC.md.
 *
 * Vertex channels written:
 *   POSITION, NORMAL          standard
 *   _REGIONID                 anatomical region id (drives picking + highlight)
 *   _THICKNESS                local slab thickness in metres (subsurface)
 *   _AO                       baked hemispherical ambient occlusion (0..1)
 *   _CURV                     signed normalised mean curvature (cavity/convexity)
 *
 * Usage: node scripts/build-body-glb.mjs build/male-refined.bvmesh public/models/body-male.glb
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import draco3d from 'draco3dgltf';

const MAGIC = 'BVMESH01';

function loadBvMesh(file) {
  const raw = readFileSync(file);
  if (raw.toString('ascii', 0, 8) !== MAGIC) throw new Error(`${file}: bad magic`);
  const vc = raw.readUInt32LE(8);
  const ic = raw.readUInt32LE(12);
  let o = 16;
  const take = (Type, n) => {
    const bytes = n * Type.BYTES_PER_ELEMENT;
    const a = new Type(raw.buffer.slice(raw.byteOffset + o, raw.byteOffset + o + bytes));
    o += bytes;
    return a;
  };
  const mesh = {
    position: take(Float32Array, vc * 3),
    normal: take(Float32Array, vc * 3),
    regionid: take(Float32Array, vc),
    thickness: take(Float32Array, vc),
    index: take(Uint32Array, ic),
    extra: {},
  };
  while (o + 16 + vc * 4 <= raw.length) {
    const name = raw.toString('ascii', o, o + 16).replace(/\0+$/, '');
    o += 16;
    mesh.extra[name] = take(Float32Array, vc);
  }
  return { vc, ic, ...mesh };
}

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('usage: node scripts/build-body-glb.mjs <in.bvmesh> <out.glb>');
  process.exit(1);
}

const m = loadBvMesh(src);
const doc = new Document();
doc.createBuffer();
const prim = doc
  .createPrimitive()
  .setAttribute('POSITION', doc.createAccessor('POSITION').setType('VEC3').setArray(m.position))
  .setAttribute('NORMAL', doc.createAccessor('NORMAL').setType('VEC3').setArray(m.normal))
  .setAttribute('_REGIONID', doc.createAccessor('_REGIONID').setType('SCALAR').setArray(m.regionid))
  .setAttribute('_THICKNESS', doc.createAccessor('_THICKNESS').setType('SCALAR').setArray(m.thickness))
  .setIndices(doc.createAccessor('indices').setType('SCALAR').setArray(m.index))
  .setMaterial(doc.createMaterial('Skin').setRoughnessFactor(0.55).setMetallicFactor(0));

for (const [name, arr] of Object.entries(m.extra)) {
  prim.setAttribute(name, doc.createAccessor(name).setType('SCALAR').setArray(arr));
}

const mesh = doc.createMesh('Skin').addPrimitive(prim);
const node = doc.createNode('Body').setMesh(mesh);
doc.createScene('Scene').addChild(node);

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

// uncompressed first, then the exact CLI Draco pass the repo already uses, so
// the shipped asset matches scripts/compress-models.sh byte-for-byte in method
await io.write(dst, doc);
execFileSync(
  'npx',
  ['--yes', 'gltf-transform', 'draco', dst, dst,
   '--quantize-position', process.env.BV_QP ?? '12',
   '--quantize-normal', process.env.BV_QN ?? '10',
   '--quantize-generic', process.env.BV_QG ?? '10'],
  { stdio: 'inherit' },
);

console.log(
  `${dst}: ${m.vc} verts / ${m.ic / 3} tris, channels [${['POSITION', 'NORMAL', '_REGIONID', '_THICKNESS', ...Object.keys(m.extra)].join(', ')}], ${(statSync(dst).size / 1024).toFixed(1)} KB`,
);
