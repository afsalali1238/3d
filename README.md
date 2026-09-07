# BodyViewer — Realistic Interactive 3D Human Body

A self-contained, reusable React component for anatomical region selection
and precise pain-point localisation on a real 3D human body. Real WebGL,
real depth, real orbit — no primitive mannequin, no 2D hotspot fake.

![module](build/seg-front.png)

## Product direction

The viewer is the locator tier of a planned guided anatomy → exercise flow. See `docs/`:

- [`docs/GUIDED-FLOW-CONCEPT.md`](docs/GUIDED-FLOW-CONCEPT.md) — the concept & build brief
- [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md) — corrected baseline, schemas, phase plan
- [`docs/CLINICIAN-HANDOFF.md`](docs/CLINICIAN-HANDOFF.md) — what the clinician / Medical Director must supply

No approved clinical content exists in this repo. Placeholder rows are signed `PLACEHOLDER`. The default entry is the minimal journey: welcome → 5-field intake → 3D/2D body map → exercises. The long red-flag / precaution / onset questionnaires are currently `draft` in the CSV content. BMI is not collected or used. D8 re-ruling is still required before real clinical content ships.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

## What's inside

| Path | Purpose |
|---|---|
| `src/components/body/BodyViewer.tsx` | The component — the only surface the app sees |
| `src/components/body/types.ts` | Public prop/callback types (`BodyRegion`, `PainPin`, …) |
| `src/components/body/regions.ts` / `regions.gen.ts` | Typed region data: 81 regions, EN/AR labels, focus targets, neighbour graph |
| `src/components/body/skinMaterial.ts` | Patched `MeshPhysicalMaterial`: per-channel (R/G/B) diffuse wrap, thickness-driven transmission, baked-AO + curvature cavity shading, triplanar micro-detail, dual specular, in-shader region highlight (guarded `onBeforeCompile`, plain-PBR fallback) |
| `src/components/body/skinDetail.ts` | Seamless pore / mottle detail map generated procedurally at runtime (no download) and sampled triplanarly — the mesh has no UVs |
| `src/components/body/useRegionPicker.ts` | Raycast → `_REGIONID` region resolution + 20 px snap for small targets |
| `src/components/body/CameraRig.tsx` | Damped spherical orbit, ±35° vertical clamp, idle auto-rotate, fly-to-region |
| `src/components/body/PinMarker.tsx` | Surface-welded draggable pain pins, yellow→red intensity grading |
| `src/components/body/Fallback2D.tsx` | No-WebGL SVG diagram — same region IDs, same callbacks |
| `src/components/body/store.ts` | Internal zustand state (never leaks outside the module) |
| `public/models/` + `ASSET-SPEC.md` | Segmented GLBs + the exact contract for swapping in licensed scans |
| `scripts/build_body_asset.py` | Asset pipeline: extraction, segmentation, thickness bake, GLB/typed-data generation |
| `scripts/refine_body_mesh.py` | Render-quality pass: hole filling, denoise, isotropic remesh, AO + curvature bake |
| `scripts/enhance_geometry.py` | Detailed LOD: Loop subdivision, head rescale, facial sculpt, AO/curvature/pigment re-bake |
| `scripts/sculpt_face.py` | Landmark-driven facial anatomy + hair/brow/lash/lip pigment channel |
| `scripts/polish_normals.py` | Bilateral shading-normal polish + `_CURV` denoise (positions and regions untouched) |
| `scripts/qa_render.py` | Headless software renderer (numpy) that mirrors the skin shader — review geometry/shading changes without a GPU |
| `src/App.tsx` | Demo route exercising every mode |

## Component API

```tsx
<BodyViewer
  gender="male"            // 'male' | 'female'  (second model loads lazily)
  view="anterior"          // 'anterior' | 'posterior'
  mode="select"            // 'explore' | 'select' | 'pinpoint'
  locale="en"              // 'en' | 'ar'  (chrome mirrors, scene doesn't)
  selectedRegionId={id}
  pins={pins}              // up to 5 PainPin, intensity 1–5
  onRegionHover={(id) => …}
  onRegionSelect={(id) => …}
  onPointConfirm={({ regionId, point, normal, uv, gender }) => …}
  onReady={() => …}
  onError={(e) => …}
/>
```

The component owns no domain logic — it reports *where*; the app decides
*what that means*.

## Interaction flow

1. **Explore** — orbit / pinch-zoom, front–back flip, male–female toggle,
   idle auto-rotate with breathing animation.
2. **Select** — tap any point; the correct anatomical region highlights
   along its contour (single mesh, region IDs in a vertex channel — no
   second mesh, no outline pass, no z-fighting) and the camera flies in
   with damped spherical interpolation.
3. **Pinpoint** — tap the exact spot; a glowing pin welds to the skin,
   drags along the surface, keeps constant screen size.
4. **Confirm** — "Is this exactly where it hurts?" → emits the payload.

Escape hatch: an "I can't find it" region-list picker. Every region is
also a named, tabbable ARIA target.

## Performance

- `frameloop="demand"` — renders only during interaction/animation
- Two LODs per body: detailed (263k / 238k triangles, subdivided + sculpted face) and light (66k / 60k) — the viewer picks by device tier; total 3D payload budget ≤ 6 MB
- shadow maps and post-processing degrade automatically on low-end devices
- DPR capped at 2, auto-drops to 1.5 when frame time > 20 ms
- Post-processing (SMAA + high-threshold bloom + vignette + subtle CA)
  disabled automatically on low-end devices; no WebGL → 2D SVG fallback
- Decoders (Draco/KTX2/Basis) self-hosted in `/public/decoders/`

## Skin rendering

The body carries no textures — everything is computed from four baked vertex
channels (`_REGIONID`, `_THICKNESS`, `_AO`, `_CURV`) plus a procedurally
generated detail map:

- **subsurface** — the R/G/B diffuse terminators wrap by different amounts
  (0.55 / 0.28 / 0.20), so light goes warm before it goes dark, with a
  thickness-driven transmission term for ears, fingers and the nose
- **occlusion** — form-factor-baked AO drives indirect light, 45 % of direct
  light, a crease hue shift and specular occlusion; `_CURV` adds cavity
  darkening and boosts scattering on convex edges
- **micro-detail** — a seamless pore / orange-peel / mottle map generated at
  runtime and sampled triplanarly (no UVs, no download) perturbs the normal,
  roughness and albedo
- **specular** — F0 pinned to skin's real 2.8 % reflectance plus a tight
  secondary lobe, so highlights read wet rather than plastic
- **lighting** — warm key (with a real PCF-soft shadow map), cool fill, rim,
  studio HDRI, contact shadows, and a subtle photographic grade (grain,
  vignette, slight saturation lift)

## Data attribution

Body geometry derived from **BodyParts3D** © The Database Center for Life
Science, CC BY 4.0 — see `public/ATTRIBUTION.md` and
`public/models/ASSET-SPEC.md`.
