// mesh-io.mjs — dump / load the body mesh as flat binary for the Python QA
// renderer and the geometry refinement pass.
//
// Binary layout (little endian):
//   magic "BVMESH01" (8 bytes)
//   uint32 vertexCount, uint32 indexCount
//   float32 position[vertexCount*3]
//   float32 normal[vertexCount*3]
//   float32 regionid[vertexCount]
//   float32 thickness[vertexCount]
//   uint32  index[indexCount]
//   then, repeated: char name[16] (nul padded), float32 channel[vertexCount]
import { readFileSync, writeFileSync } from 'node:fs';

export function findPrimitive(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) return prim;
  }
  throw new Error('no primitive found');
}

export function dumpMesh(prim, file) {
  const pos = prim.getAttribute('POSITION').getArray();
  const nrm = prim.getAttribute('NORMAL').getArray();
  const rid = prim.getAttribute('_REGIONID')?.getArray();
  const thk = prim.getAttribute('_THICKNESS')?.getArray();
  // any further scalar channels (_AO, _CURV, ...) ride along as named extras
  // so a dump -> edit -> build round trip never drops a baked channel
  const extras = prim
    .listSemantics()
    .filter((s) => !['POSITION', 'NORMAL', '_REGIONID', '_THICKNESS'].includes(s))
    .map((s) => [s, prim.getAttribute(s).getArray()]);
  const idx = prim.getIndices().getArray();
  const vc = pos.length / 3;
  const ic = idx.length;
  const head = Buffer.alloc(16);
  head.write('BVMESH01', 0, 'ascii');
  head.writeUInt32LE(vc, 8);
  head.writeUInt32LE(ic, 12);
  const buf = Buffer.concat([
    head,
    Buffer.from(Float32Array.from(pos).buffer),
    Buffer.from(Float32Array.from(nrm).buffer),
    Buffer.from(Float32Array.from(rid ?? new Float32Array(vc)).buffer),
    Buffer.from(Float32Array.from(thk ?? new Float32Array(vc)).buffer),
    Buffer.from(Uint32Array.from(idx).buffer),
    ...extras.flatMap(([name, arr]) => {
      const head = Buffer.alloc(16);
      head.write(name, 0, 'ascii');
      return [head, Buffer.from(Float32Array.from(arr).buffer)];
    }),
  ]);
  writeFileSync(file, buf);
  return { vertexCount: vc, triangleCount: ic / 3, extras: extras.map(([n]) => n) };
}

export function loadMesh(file) {
  const raw = readFileSync(file);
  if (raw.toString('ascii', 0, 8) !== 'BVMESH01') throw new Error('bad mesh dump magic');
  const vc = raw.readUInt32LE(8);
  const ic = raw.readUInt32LE(12);
  let o = 16;
  const take = (Type, n) => {
    const a = new Type(raw.buffer.slice(raw.byteOffset + o, raw.byteOffset + o + n * Type.BYTES_PER_ELEMENT));
    o += n * Type.BYTES_PER_ELEMENT;
    return a;
  };
  const mesh = {
    vertexCount: vc,
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
  return mesh;
}
