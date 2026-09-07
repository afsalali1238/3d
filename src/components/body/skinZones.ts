/**
 * Anatomical skin zoning.
 *
 * Skin is not one material. Sun-exposed skin (face, neck, hands, forearms)
 * carries more melanin and reads warmer; the knees, elbows and heels are dry,
 * thickened and slightly desaturated; palms and soles are pink, hairless and
 * glossier than the back of the same hand; skin that lives under clothes is
 * paler and smoother than any of them. Rendering all 81 regions with one
 * albedo is the single most "3D asset" thing a body can do.
 *
 * The zones are shipped as a 128x1 RGBA lookup indexed by `_REGIONID`, so the
 * shader gets them with one vertex texture fetch and no per-region uniforms.
 *
 *   R = melanin      (darker, more saturated, sun-exposed)
 *   G = dryness      (rougher, chalkier — knees, elbows, heels)
 *   B = vascularity  (redder — palms, lips, ears, knees)
 *
 * Keep in sync with scripts/lib/skin_zones.py (the offline QA renderer).
 */
import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType, ClampToEdgeWrapping } from 'three';
import { REGIONS } from './regions.gen';

export type SkinZone = { melanin: number; dryness: number; vascularity: number };

const NEUTRAL: SkinZone = { melanin: 0, dryness: 0, vascularity: 0 };

/** id suffix/prefix matchers, first match wins */
const RULES: Array<[RegExp, SkinZone]> = [
  // sun-exposed
  [/^(scalp|forehead|.*temple|face|.*jaw)$/, { melanin: 0.11, dryness: 0.02, vascularity: 0.06 }],
  [/^(cervical|throat|.*neck).*$/, { melanin: 0.08, dryness: 0.0, vascularity: 0.04 }],
  [/^(left|right)_(hand|thumb|fingers|wrist)$/, { melanin: 0.1, dryness: 0.06, vascularity: 0.09 }],
  [/^(left|right)_forearm_(flexor|extensor)$/, { melanin: 0.08, dryness: 0.02, vascularity: 0.03 }],
  // dry, thickened, bony
  [/^(left|right)_elbow$/, { melanin: 0.07, dryness: 0.22, vascularity: 0.05 }],
  [/^(left|right)_knee_.*$/, { melanin: 0.05, dryness: 0.18, vascularity: 0.08 }],
  [/^(left|right)_(heel|foot_arch|toes)$/, { melanin: 0.02, dryness: 0.2, vascularity: 0.07 }],
  [/^(left|right)_(ankle|achilles|shin)$/, { melanin: 0.03, dryness: 0.12, vascularity: 0.03 }],
  // covered, paler, smoother
  [/^(left|right)_(chest|upper_back|oblique|glute|hip_groin)$/, { melanin: -0.03, dryness: -0.02, vascularity: -0.01 }],
  [/^(mid_back|lumbar_spine|sacrum_si|abdomen_upper|abdomen_lower)$/, { melanin: -0.035, dryness: -0.02, vascularity: -0.01 }],
  [/^(left|right)_(quadriceps|hamstring|it_band|calf)$/, { melanin: -0.02, dryness: 0.01, vascularity: 0 }],
];

export function zoneFor(regionId: string): SkinZone {
  for (const [re, zone] of RULES) if (re.test(regionId)) return zone;
  return NEUTRAL;
}

/** encode a signed [-0.5, 0.5] value into a byte */
const enc = (v: number) => Math.round((Math.min(Math.max(v, -0.5), 0.5) + 0.5) * 255);

export const ZONE_LUT_SIZE = 128;

export function createSkinZoneTexture(): DataTexture {
  const data = new Uint8Array(ZONE_LUT_SIZE * 4);
  for (let i = 0; i < ZONE_LUT_SIZE; i++) {
    data[i * 4 + 0] = enc(0);
    data[i * 4 + 1] = enc(0);
    data[i * 4 + 2] = enc(0);
    data[i * 4 + 3] = 255;
  }
  for (const r of REGIONS) {
    if (r.numericId < 0 || r.numericId >= ZONE_LUT_SIZE) continue;
    const z = zoneFor(r.id);
    const o = r.numericId * 4;
    data[o + 0] = enc(z.melanin);
    data[o + 1] = enc(z.dryness);
    data[o + 2] = enc(z.vascularity);
  }
  const tex = new DataTexture(data, ZONE_LUT_SIZE, 1, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

let shared: DataTexture | null = null;

export function getSkinZoneTexture(): DataTexture {
  if (!shared) shared = createSkinZoneTexture();
  return shared;
}
