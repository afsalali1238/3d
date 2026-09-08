# BodyViewer asset specification

This directory holds the anatomical body models loaded by `<BodyViewer />`.
The viewer treats these files as swappable: drop in higher-quality licensed
scans that meet this contract and nothing in the code changes.

## Files

| File | Contents |
|---|---|
| `body-male.glb` | Male full body, single mesh |
| `body-female.glb` | Female full body, single mesh |

## Current assets (shipped)

Derived from **BodyParts3D "Skin" (FMA7163)**, © The Database Center for Life
Science, licensed **CC BY 4.0** — see `/public/ATTRIBUTION.md`. The outer
skin shell was extracted (11.4k verts / 22.4k tris), segmented into 81
anatomical regions, and baked with a per-vertex thickness channel by
`scripts/build_body_asset.py`. The female variant is a smooth regional
reshape of the same scan (a stand-in until a licensed female scan is
sourced).

The shipped runtime meshes then go through `scripts/enhance_body_realism.mjs`:
the neutralised base GLBs in `/scripts/base-models/` are Loop-subdivided once
(~45k verts / ~89k tris), adult head proportions are corrected, facial and
body landmarks are sculpted, and `_AO`, `_CURV`, and `_TINT` vertex channels
are baked for the skin shader. The Draco-compressed runtime GLBs are ~330 KB
each.

### Universal anatomy pass (applied to both bodies)

Both shipped GLBs are **anatomically universal**: the genital geometry of
the source scan has been removed, while the male/female silhouettes
(shoulders, waist, hips, chest) are preserved so the toggle still works.

Applied post-build by `node scripts/neutralise-universal.mjs` (see
`scripts/lib/neutralise-lib.mjs`). The pass is adaptive — no per-model
hardcoded coordinates. It builds a *pubic envelope* `z_env(y)` from the
surrounding groin surface (P90 of the two lateral bands 45–100 mm off the
midline), finds the most protruding medial vertex in `y ∈ [0.60, 0.85]`,
dilates the protruding cluster into a 3-ring patch with a pinned boundary,
collapses it back onto the envelope with a smoothstep weight (tips fully,
bases barely — no stretched triangles), relaxes the patch with constrained
Laplacian smoothing, snaps residual spikes, and clamps everything to
`z_env(y) + 4 mm`. Normals are recomputed (area-weighted) only for
affected vertices; everything else is byte-identical, and `_REGIONID` /
`_THICKNESS` ride along untouched (all 81 region ids verified after the
Draco round trip; picker rounding tolerates the < 0.01 quantization drift).

Verified headlessly: relocated verts confined to the pubic zone, frontal
picking in the flattened area still resolves live regions (hip/groin,
lower abdomen), and stored-normal smoothness in the patch (p95 ≈ 22–24°
across edges) is better than the body-wide average.

A future rebuild from source reproduces neutral assets by re-running the
build followed by this pass (the build script's female morph already
includes a partial anchor-collapse; this pass neutralises both bodies
uniformly afterwards).

## Contract for replacement assets

### Geometry
- Single mesh (one draw call). **Do not** split by body part — separate
  meshes cause seams, popping and z-fighting on highlight.
- 80k–250k triangles preferred for production realism; hard ceiling is the
  6 MB one-body payload budget below rather than a fixed triangle count.
- T-pose or relaxed A-pose, feet flat on y=0, arms slightly away from the
  torso so armpits / inner arms are clickable.
- Metres, Y-up, +Z anterior, +X anatomical left. Height ≈ 1.6–1.9 m,
  centred on x=0.
- Draco or Meshopt compression welcome — the loader has DRACOLoader,
  MeshoptDecoder and KTX2Loader wired (decoder files self-hosted in
  `/public/decoders/`).

### Region segmentation (required)
- A float vertex attribute **`_REGIONID`** whose value is the `numericId`
  of the containing region in `src/components/body/regions.gen.ts`.
  All shading, picking and highlighting is driven by this channel.
- Alternative for UV-mapped assets: a `body-regions.png` ID-mask texture in
  the same UV layout (flat unique RGB per region, nearest-neighbour,
  `NoColorSpace`, no mipmaps) plus a small adapter that converts the mask to
  `_REGIONID` at load or lookup time. If the albedo UVs are mirrored
  left/right, the mask **must** live on a dedicated non-mirrored `uv2` —
  otherwise clicking the left shoulder highlights both shoulders.
- Region boundaries must follow anatomical contours (muscle/joint lines),
  not bounding boxes.

### Skin realism channels (recommended)
- Float vertex attribute **`_THICKNESS`** = approximate local slab thickness
  in metres (ears/fingers/nose ≈ 0.01, torso ≥ 0.15). Drives the
  approximated subsurface scattering.
- Float vertex attribute **`_AO`** = 0..1 crease occlusion amount for armpits,
  groin, eye sockets, mouth line, nostrils and other contact folds.
- Float vertex attribute **`_CURV`** = signed mean-curvature cue, where
  positive values are concave/cavity and negative values are convex/bony.
- Float vertex attribute **`_TINT`** = compact pigment mask. Positive values
  shade short hair, brows, lashes and beard shadow; negative values shade lip
  vermilion and subtle rosy tissue.

If these optional channels are absent, skin still renders with PBR, wrap
lighting, procedural pore detail and region highlighting, but with less local
anatomical variation.

### Textures (optional but recommended for production)
All textures **KTX2/Basis compressed** (never raw PNG at runtime), placed in
`/public/textures/`:

| Map | Size | Notes |
|---|---|---|
| albedo (`map`, sRGB) | 2048² (4K only if total payload stays in budget) | subtle colour variation — redder at knees, elbows, hands, face |
| `normalMap` | 2048² | pores, wrinkles, knuckles, navel; normalScale 0.7–1.0 |
| `roughnessMap` | 1024–2048² | 0.45–0.65 range; forehead/nose/shoulders glossier |
| `aoMap` (on `uv2`) | 1024² | armpits, groin, neck, behind knees; intensity 0.8 |

UV requirements: clean, non-overlapping `uv` for the PBR set; dedicated
`uv2` for `aoMap` (and the region mask if used) whenever `uv` is tiled or
mirrored.

### Budget (enforced)
- **Total download for one body ≤ 6 MB** (geometry + textures).
- Cold load to first interactive frame < 3 s on 4G.

### Environment
- `/public/textures/studio.hdr` — neutral studio HDRI, 512×256 (up to 1k),
  equirectangular RGBE. Currently procedurally generated by
  `scripts/build_studio_hdr.py`; a licensed studio HDR can replace it
  directly.

## Failure behaviour

If a model file is missing or fails to parse, the viewer renders a clearly
labelled placeholder capsule figure and logs a console error. It must never
crash, show a blank canvas, or silently substitute a low-quality mesh.

## Regenerating the shipped assets

```bash
# source data: clone of github.com/ashemag/human-atlas (BodyParts3D chunks)
ATLAS_DIR=/path/to/human-atlas/public/models python3 scripts/build_body_asset.py
python3 scripts/build_studio_hdr.py
./scripts/compress-models.sh
node scripts/neutralise-universal.mjs  # universal anatomy (Draco in/out)
cp public/models/body-male.glb scripts/base-models/body-male.glb
cp public/models/body-female.glb scripts/base-models/body-female.glb
node scripts/enhance_body_realism.mjs
for g in male female; do
  npx gltf-transform draco public/models/body-$g.glb public/models/body-$g.glb \
    --method edgebreaker --encode-speed 5 --decode-speed 5
done
cp public/models/body-male.glb public/models/body.glb
```

The `_REGIONID` channel survives Draco quantization integer-exact (all 81
region ids verified after a compress/decompress round trip).

Outputs: both GLBs, `regions.gen.ts` (typed region table with focus targets
and neighbour graph), `fallbackShapes.gen.ts` (2D projected outlines for the
no-WebGL fallback), and QA segmentation renders in `build/`.
