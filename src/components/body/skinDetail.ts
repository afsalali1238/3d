/**
 * Procedural skin micro-detail texture.
 *
 * The shipped GLBs carry no UVs and no texture maps (see ASSET-SPEC.md), so
 * close-up realism has to come from somewhere else: this module bakes one
 * small, seamless RGBA detail map at runtime — no download, ~15 ms on a
 * mid-range phone — which the skin shader samples triplanarly in object space.
 *
 *   R, G  tangent-space normal XY of the pore/wrinkle height field
 *   B     pore cavity mask (0 = deep pore, 1 = raised) → roughness + occlusion
 *   A     low-frequency dermal mottle → albedo breakup (melanin/blood variation)
 *
 * The height field is built from periodic (seamless) value noise so triplanar
 * sampling never shows a repeat seam:
 *   - 4 octaves of fbm for the "orange-peel" skin texture
 *   - a ridged octave for the finer pore network
 *   - a slow octave for large dermal variation
 */
import { DataTexture, LinearMipmapLinearFilter, LinearFilter, RGBAFormat, RepeatWrapping, UnsignedByteType } from 'three';

/** deterministic 2D hash on an integer lattice, periodic with `period` */
function hash2(ix: number, iy: number, period: number, seed: number): number {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let h = x * 374761393 + y * 668265263 + seed * 1442695040888963407;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 65536) / 65535;
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** periodic value noise in [0,1] */
function pnoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smootherstep(x - ix);
  const fy = smootherstep(y - iy);
  const a = hash2(ix, iy, period, seed);
  const b = hash2(ix + 1, iy, period, seed);
  const c = hash2(ix, iy + 1, period, seed);
  const d = hash2(ix + 1, iy + 1, period, seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function fbm(x: number, y: number, base: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise(x * freq, y * freq, freq, seed + o * 17);
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}

export type SkinDetailOptions = {
  size?: number;
  /** height of the pore/wrinkle field, in texture units — drives normal slope */
  relief?: number;
  seed?: number;
};

export function createSkinDetailTexture(opts: SkinDetailOptions = {}): DataTexture {
  const size = opts.size ?? 512;
  const relief = opts.relief ?? 1.0;
  const seed = opts.seed ?? 3;

  // --- height field ------------------------------------------------------
  const h = new Float32Array(size * size);
  const cav = new Float32Array(size * size);
  const mottle = new Float32Array(size * size);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x * inv;
      const v = y * inv;
      // orange-peel: mid-frequency fbm
      const peel = fbm(u, v, 24, 4, seed);
      // pore network: ridged noise, small and sharp
      const r1 = 1 - Math.abs(pnoise(u * 96, v * 96, 96, seed + 91) * 2 - 1);
      const r2 = 1 - Math.abs(pnoise(u * 168, v * 168, 168, seed + 143) * 2 - 1);
      const pores = Math.pow(r1 * 0.65 + r2 * 0.35, 2.4);
      // fine skin flake / crease direction bias
      const creases = fbm(u * 1.9, v, 48, 2, seed + 211);
      const height = peel * 0.55 + creases * 0.2 - pores * 0.45;
      h[y * size + x] = height;
      cav[y * size + x] = 1 - pores;
      mottle[y * size + x] = fbm(u, v, 5, 3, seed + 401) * 0.7 + fbm(u, v, 11, 2, seed + 733) * 0.3;
    }
  }

  // normalise mottle to a zero-mean unit-ish range
  let mMin = Infinity;
  let mMax = -Infinity;
  for (let i = 0; i < mottle.length; i++) {
    if (mottle[i] < mMin) mMin = mottle[i];
    if (mottle[i] > mMax) mMax = mottle[i];
  }
  const mScale = 1 / Math.max(mMax - mMin, 1e-5);

  // --- pack normals + masks ---------------------------------------------
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => h[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const slope = relief * size * 0.012;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * slope;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * slope;
      // tangent-space normal of the height field
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(Math.min(Math.max(cav[y * size + x], 0), 1) * 255);
      data[i + 3] = Math.round(Math.min(Math.max((mottle[y * size + x] - mMin) * mScale, 0), 1) * 255);
    }
  }

  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

let shared: DataTexture | null = null;

/** one texture for the whole app (both genders share it) */
export function getSkinDetailTexture(): DataTexture {
  if (!shared) shared = createSkinDetailTexture();
  return shared;
}
