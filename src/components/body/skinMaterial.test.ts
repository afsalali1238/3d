/**
 * Guard rails for the skin shader patch and for the vertex channels it needs.
 *
 * The patch injects GLSL into three's `meshphysical` shader by string
 * replacement. If three renames a chunk the patch silently degrades to plain
 * PBR (by design) — these tests make that regression loud, and also catch the
 * failure modes that would ship a black or unlit body: a uniform referenced in
 * GLSL but never declared, a varying declared on one side only, or a GLB that
 * lost one of the baked channels.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { ShaderChunk, ShaderLib, UniformsUtils } from 'three';
import { createSkinMaterial, type SkinQuality } from './skinMaterial';

/** three's own include resolution, so the mock shader matches the real one */
function resolveIncludes(source: string): string {
  const pattern = /^[ \t]*#include +<([\w\d./]+)>/gm;
  return source.replace(pattern, (_match, include: string) => {
    const chunk = (ShaderChunk as Record<string, string>)[include];
    if (chunk === undefined) throw new Error(`missing shader chunk ${include}`);
    return resolveIncludes(chunk);
  });
}

function compilePatched(quality: SkinQuality = 'high') {
  const handle = createSkinMaterial(undefined, quality);
  const shader = {
    name: 'MeshPhysicalMaterial',
    uniforms: UniformsUtils.clone(ShaderLib.physical.uniforms),
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
    defines: {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle.material.onBeforeCompile(shader as any, null as any);
  return { handle, shader };
}

describe('skin material shader patch', () => {
  it.each(['high', 'low'] as SkinQuality[])(
    'resolves every GLSL placeholder at quality=%s',
    (quality) => {
      const { handle, shader } = compilePatched(quality);
      expect(handle.patched).toBe(true);
      expect(shader.fragmentShader).not.toContain('MACRO_SAMPLE');
      // counts include the function definition, so one call site == 2 hits.
      // micro detail always uses the triplanar fetch; the macro mottle uses
      // the single-axis fetch on 'high' and is dropped entirely on 'low'.
      const triplanar = shader.fragmentShader.match(/bvTriplanar\(/g) ?? [];
      expect(triplanar.length).toBe(2);
      const planar = shader.fragmentShader.match(/bvPlanar\(/g) ?? [];
      expect(planar.length).toBe(quality === 'low' ? 1 : 2);
    },
  );

  it('applies (never silently falls back on the shipped three version)', () => {
    const { handle } = compilePatched();
    expect(handle.patched, 'shader anchors changed — patch fell back to plain PBR').toBe(true);
  });

  it('declares every uniform it references', () => {
    const { shader } = compilePatched();
    const glsl = shader.vertexShader + '\n' + shader.fragmentShader;
    const declared = new Set<string>();
    for (const m of glsl.matchAll(/uniform\s+\w+\s+(u[A-Z]\w*)\s*;/g)) declared.add(m[1]);
    const used = new Set<string>();
    for (const m of glsl.matchAll(/\b(u[A-Z]\w*)\b/g)) used.add(m[1]);
    for (const name of used) {
      expect(declared.has(name), `${name} used in GLSL but never declared`).toBe(true);
      expect(shader.uniforms[name], `${name} declared in GLSL but not bound`).toBeDefined();
    }
    // and the channels the asset must provide
    for (const attr of ['_regionid', '_thickness', '_ao', '_curv', '_tint']) {
      expect(shader.vertexShader).toContain(`attribute float ${attr};`);
    }
  });

  it('keeps vertex and fragment varyings in sync', () => {
    const { shader } = compilePatched();
    const grab = (src: string) =>
      new Set([...src.matchAll(/varying\s+\w+\s+(vBv\w*)\s*;/g)].map((m) => m[1]));
    const vs = grab(resolveIncludes(shader.vertexShader));
    const fs = grab(resolveIncludes(shader.fragmentShader));
    expect([...fs].filter((v) => !vs.has(v)), 'fragment varying with no vertex source').toEqual([]);
    expect([...vs].filter((v) => !fs.has(v)), 'unused vertex varying').toEqual([]);
  });

  it('produces balanced, fully substituted GLSL', () => {
    const { shader } = compilePatched();
    // three's own chunks are not brace-balanced once #ifdef branches are
    // flattened, so compare the delta the patch introduces instead.
    const delta = (patchedSrc: string, stockSrc: string, ch: string) => {
      const count = (s: string) => (s.match(new RegExp(`\\${ch}`, 'g')) ?? []).length;
      return count(patchedSrc) - count(stockSrc);
    };
    const pairs: [string, string][] = [
      [resolveIncludes(shader.vertexShader), resolveIncludes(ShaderLib.physical.vertexShader)],
      [resolveIncludes(shader.fragmentShader), resolveIncludes(ShaderLib.physical.fragmentShader)],
    ];
    for (const [patchedSrc, stockSrc] of pairs) {
      expect(patchedSrc).not.toContain('${');
      expect(patchedSrc).not.toContain('#include <');
      expect(delta(patchedSrc, stockSrc, '{'), 'unbalanced braces added by the patch').toBe(
        delta(patchedSrc, stockSrc, '}'),
      );
      expect(delta(patchedSrc, stockSrc, '('), 'unbalanced parens added by the patch').toBe(
        delta(patchedSrc, stockSrc, ')'),
      );
    }
  });

  it('binds the procedural detail map and the region zone lookup', () => {
    const { handle } = compilePatched();
    expect(handle.uniforms.uDetailMap.value, 'detail texture missing').not.toBeNull();
    expect(handle.uniforms.uZoneMap.value, 'zone lookup missing').not.toBeNull();
  });
});

/* ------------------------------------------------------------------ assets */

type GltfJson = {
  meshes?: { primitives: { attributes: Record<string, number> }[] }[];
};

function readGlbJson(path: string): GltfJson {
  const buf = readFileSync(path);
  expect(buf.toString('ascii', 0, 4), `${path} is not a GLB`).toBe('glTF');
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + jsonLength)) as GltfJson;
}

describe('body assets carry the channels the shader reads', () => {
  const models = [
    'public/models/body-male.glb',
    'public/models/body-female.glb',
    'public/models/body-male-lo.glb',
    'public/models/body-female-lo.glb',
  ];
  for (const path of models) {
    it(`${path} declares POSITION/NORMAL/_REGIONID/_THICKNESS/_AO/_CURV/_TINT`, () => {
      if (!existsSync(path)) {
        expect.fail(`${path} missing`);
      }
      const json = readGlbJson(path);
      const prims = json.meshes?.flatMap((m) => m.primitives) ?? [];
      expect(prims.length, 'expected exactly one primitive (single draw call)').toBe(1);
      const attrs = Object.keys(prims[0].attributes);
      for (const need of [
        'POSITION', 'NORMAL', '_REGIONID', '_THICKNESS', '_AO', '_CURV', '_TINT',
      ]) {
        expect(attrs, `${path} lacks ${need}`).toContain(need);
      }
    });
  }
});
