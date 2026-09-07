# BodyViewer asset specification

This directory holds the anatomical body models loaded by `<BodyViewer />`.
The viewer treats these files as swappable: drop in higher-quality licensed
scans that meet this contract and nothing in the code changes.

## Files

| File | Contents |
|---|---|
| `body-male.glb` | Male full body, single mesh — detailed LOD |
| `body-female.glb` | Female full body, single mesh — detailed LOD |
| `body-male-lo.glb` | Male, light LOD (loaded when the device also loses post-processing and shadows) |
| `body-female-lo.glb` | Female, light LOD |

## Current assets (shipped)

Derived from **BodyParts3D "Skin" (FMA7163)**, © The Database Center for Life
Science, licensed **CC BY 4.0** — see `/public/ATTRIBUTION.md`. The outer
skin shell was extracted, segmented into 81 anatomical regions and baked with
a per-vertex thickness channel by `scripts/build_body_asset.py`, then put
through the render-quality refinement pass below. The female variant is a
smooth regional reshape of the same scan (a stand-in until a licensed female
scan is sourced).

| | male (detailed) | female (detailed) | light LOD |
|---|---|---|---|
| vertices / triangles | 131,738 / 263,432 | 119,133 / 238,168 | 32,944 / 65,858 and 29,785 / 59,542 |
| GLB (Draco) | see `npm test` budget (< 1.6 MB) | | < 300 KB |
| edge length | ~3.9 mm, uniform | ~3.9 mm, uniform | 6–10 mm |
| boundary edges (holes) | 0 | 0 | 0 |

Both LODs are baked from the same source through the same pipeline, so the
silhouette, the region borders and the pigment channel are identical — the
viewer can swap LOD without moving a single picking boundary.

### Proportions and face

The raw scan is 6.4 heads tall (a real adult is 7.4–7.6) and has no facial
features at all: no lids, no lip line, no nostrils, no brow. Two passes fix
that, both driven by landmarks measured off the mesh rather than hard-coded
coordinates, so they survive a rescale or a new source scan:

- `scripts/sculpt_face.py::rescale_head` shrinks the head about the base of
  the skull, easing to zero through the neck (6.4 → 7.0 heads).
- `scripts/sculpt_face.py::sculpt` adds the missing anatomy as smooth analytic
  displacement fields — eyeball under closed lids, lash line, lid crease, brow
  ridge, nostrils and alae, upper and lower lip with a vermilion border,
  philtrum, mentolabial sulcus, chin ball, cheekbones. No vertex is added,
  removed or re-labelled.

### Render-quality refinement pass

`scripts/refine_body_mesh.py` (run through `scripts/dump-mesh.mjs` →
`scripts/build-body-glb.mjs`) turns the raw voxel-derived shell into a clean
render asset. The raw scan was watertight enough to pick against but read as a
"scan blob" up close: lumpy surface noise, triangle edges from 3 mm to 128 mm,
and open holes where the eyeballs, armpits and finger webs had been.

1. weld duplicates, drop degenerate faces, repair non-manifold edges
2. close every boundary loop, then blend the caps into the surrounding
   surface with dilated constrained Laplacian relaxation (a flat cap over the
   eyelid rim would otherwise leave a pinched seam); head caps get a ≤ 2.5 mm
   convex bulge so closed eyelids read as eyelids
3. Taubin denoise (λ 0.5 / μ −0.53, volume preserving)
4. curvature-adaptive isotropic remesh to a ~7.8 mm target edge, reprojecting
   onto the source surface each iteration (max surface deviation 4 mm)
5. transfer `_REGIONID` (inverse-distance-weighted vote over the 8 nearest
   source vertices — keeps region borders crisp) and `_THICKNESS` (IDW mean)
6. bake `_AO` and `_CURV` (see below), recompute area-weighted normals
7. `scripts/polish_normals.py`: bilateral filter over the shading normals
   (4 iterations, σ ≈ 30°, 25 % of the original normal retained) plus a
   6-iteration blur of `_CURV`. Positions, triangles and `_REGIONID` are left
   untouched, so this changes shading only — centimetre-scale scan ripple
   disappears (mean normal shift 2.8°) while pecs, abs, clavicles and knuckles
   keep their edge, and the smoother normal field also compresses ~5 % better

Result: mean dihedral angle between adjacent faces drops from 10.3° to 4.3°,
all 81 regions survive, and the segmentation boundaries stay where the
original build put them.

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
- 40k–80k triangles preferred; hard ceiling 120k.
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

### Thickness channel (recommended)
- Float vertex attribute **`_THICKNESS`** = approximate local slab thickness
  in metres (ears/fingers/nose ≈ 0.01, torso ≥ 0.15). Drives the
  approximated subsurface scattering. If absent, skin renders with plain
  PBR + wrap lighting only.

### Occlusion and curvature channels (recommended)
- Float vertex attribute **`_AO`** = baked hemispherical ambient occlusion in
  `[0,1]` (1 = fully open). Baked by `scripts/refine_body_mesh.py` with a disc
  form-factor solver (Bunnell), which resolves crevices a depth-map bake
  misses: armpits, groin, finger webs, the fold under the chin, eye sockets.
  It modulates indirect diffuse/specular exactly like an `aoMap` would, plus
  45 % of the direct light and a red hue shift (blood pools in creases).
- Float vertex attribute **`_CURV`** = signed, normalised mean curvature in
  `[-1,1]` (negative = concave). Drives cavity darkening and curvature-boosted
  subsurface scattering on convex edges.
- Both are optional: `BodyModel.tsx` fills neutral values (`_AO` = 1,
  `_CURV` = 0) and logs a warning if an asset does not carry them, so a
  third-party GLB never renders black.

### Pigment channel (recommended)
- Float vertex attribute **`_TINT`** in `[-1,1]`: positive = hair (scalp,
  brows, lash line, beard shadow), negative = lip vermilion. Individual hairs
  are two orders of magnitude below any tessellation this asset will carry, so
  hair is rendered as a dark, matte, grainy skin layer — which is what a short
  cut, a brow and a lash line look like at arm's length. The hairline is a
  smooth surface in head coordinates (a third of the way from brow to crown at
  the front, nape at the back), not the scalp region border, which scallops.
- Optional: `BodyModel.tsx` fills 0 (bare skin) when absent.

### Anatomical zoning (in code, no asset change needed)
`src/components/body/skinZones.ts` maps every region id to melanin, dryness
and vascularity offsets and ships them as a 128×1 lookup the vertex shader
samples by `_REGIONID`: sun-exposed face/neck/hands/forearms carry more
melanin, knees, elbows and heels are dry and thickened, palms and soles are
pink, covered skin is paler and smoother. Mirrored for the offline renderer in
`scripts/lib/skin_zones.py`.

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
./scripts/compress-models.sh          # Draco: ~634 KB -> ~80 KB per body
node scripts/neutralise-universal.mjs # universal anatomy (Draco in/out)

# render-quality refinement (adds ~120 KB per body, all of it worth it)
pip install numpy scipy pymeshlab pillow
for g in male female; do
  node scripts/dump-mesh.mjs public/models/body-$g.glb build/$g.bvmesh
  python3 scripts/refine_body_mesh.py build/$g.bvmesh build/$g-refined.bvmesh
  python3 scripts/polish_normals.py build/$g-refined.bvmesh build/$g-polished.bvmesh
  # detailed LOD: subdivide, rescale the head, sculpt the face, re-bake channels
  python3 scripts/enhance_geometry.py build/$g-polished.bvmesh build/$g-hi.bvmesh \
          --levels 1 --face-scale 2.0 --head-scale 0.91 --stubble 0.3
  python3 scripts/enhance_geometry.py build/$g-polished.bvmesh build/$g-lo.bvmesh \
          --levels 0 --face-scale 2.0 --head-scale 0.91 --stubble 0.3
  BV_QP=14 BV_QG=12 node scripts/build-body-glb.mjs build/$g-hi.bvmesh public/models/body-$g.glb
  node scripts/build-body-glb.mjs build/$g-lo.bvmesh public/models/body-$g-lo.glb
done
cp public/models/body-male.glb public/models/body.glb

# QA (software renderer — no GPU, no browser needed)
python3 scripts/qa_render.py build/male-refined.bvmesh build/qa.png \
        --view three4,torso,face --mode shaded   # also: ao, regions, normals, curvature
python3 scripts/mesh_report.py build/male-refined.bvmesh
```

`scripts/dump-mesh.mjs` round-trips every scalar channel (`_AO`, `_CURV`, …),
so a dump → edit → build cycle can be run on the shipped GLB without going
through the full refinement pass again.

`pymeshlab` wheels link against `libGL`; on a headless box without it, build a
stub once (`gcc -shared -fPIC -o libGL.so.1 stub.c` exporting the undefined
`gl*` symbols) and point `LD_LIBRARY_PATH` at it — none of the filters used
here touch the GPU.

The `_REGIONID` channel survives Draco quantization (12-bit position, 10-bit
normal, 10-bit generic) integer-exact after rounding — all 81 region ids
verified after a compress/decompress round trip, and the picker rounds anyway.

Outputs: both GLBs, `regions.gen.ts` (typed region table with focus targets
and neighbour graph), `fallbackShapes.gen.ts` (2D projected outlines for the
no-WebGL fallback), and QA segmentation renders in `build/`.
