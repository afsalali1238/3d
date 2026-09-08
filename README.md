# BodyViewer — Realistic Interactive 3D Human Body

A self-contained, reusable React component for anatomical region selection
and precise pain-point localisation on a real 3D human body. Real WebGL,
real depth, real orbit — no primitive mannequin, no 2D hotspot fake.

## Product direction

The viewer is the locator tier of a planned guided anatomy → exercise flow. See `docs/`:

- [`docs/GUIDED-FLOW-CONCEPT.md`](docs/GUIDED-FLOW-CONCEPT.md) — the concept & build brief
- [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md) — corrected baseline, schemas, phase plan
- [`docs/CLINICIAN-HANDOFF.md`](docs/CLINICIAN-HANDOFF.md) — what the clinician / Medical Director must supply

No approved clinical content exists in this repo. Placeholder rows are signed `PLACEHOLDER`. The default entry is the minimal journey: welcome → 5-field intake → 3D/2D body map → exercises. The long red-flag / precaution / onset questionnaires are currently `draft` in the CSV content. BMI is not collected or used. D8 re-ruling is still required before real clinical content ships.

## Quick start

```bash
npm ci
npm run dev        # http://localhost:5173
```

## Verification

```bash
npm run content:build   # after editing content/*.csv; commit the generated bundle
npm run verify          # the same content, type, build and test checks used by CI
```

Content generation is deterministic. Verification fails if the committed bundle
is missing or differs from the CSV source; it does not silently repair stale content.
`npm run build` also compiles and validates content for deployments.

## What's inside

| Path | Purpose |
|---|---|
| `src/components/body/BodyViewer.tsx` | The component — the only surface the app sees |
| `src/components/body/types.ts` | Public prop/callback types (`BodyRegion`, `PainPin`, …) |
| `src/components/body/regions.ts` / `regions.gen.ts` | Typed region data: 81 regions, EN/AR labels, focus targets, neighbour graph |
| `src/components/body/skinMaterial.ts` | Patched `MeshPhysicalMaterial`: RGB wrap-lighting SSS, pore-scale bump/roughness, baked AO/curvature/pigment channels, in-shader region highlight (guarded `onBeforeCompile`, plain-PBR fallback) |
| `src/components/body/useRegionPicker.ts` | Raycast → `_REGIONID` region resolution + 20 px snap for small targets |
| `src/components/body/CameraRig.tsx` | Damped spherical orbit, ±35° vertical clamp, idle auto-rotate, fly-to-region |
| `src/components/body/PinMarker.tsx` | Surface-welded draggable pain pins, yellow→red intensity grading |
| `src/components/body/Fallback2D.tsx` | No-WebGL SVG diagram — same region IDs, same callbacks |
| `src/components/body/store.ts` | Internal zustand state (never leaks outside the module) |
| `public/models/` + `ASSET-SPEC.md` | Segmented GLBs + the exact contract for swapping in licensed scans |
| `scripts/build_body_asset.py` | Source asset pipeline: extraction, segmentation, thickness bake, GLB/typed-data generation |
| `scripts/enhance_body_realism.mjs` | Runtime realism pass: Loop subdivision, adult proportions, facial/body landmark sculpt, baked AO/curvature/pigment channels |
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
- ~330 KB per body Draco GLB (budget: ≤ 6 MB), ~91k triangles / ~46k vertices
- DPR capped at 2, auto-drops to 1.5 when frame time > 20 ms
- Soft self-shadowed studio key light, HDRI fill/rim, and post-processing
  (SMAA + high-threshold bloom + vignette + subtle CA)
  disabled automatically on low-end devices; no WebGL → 2D SVG fallback
- Decoders (Draco/KTX2/Basis) self-hosted in `/public/decoders/`

## Data attribution

Body geometry derived from **BodyParts3D** © The Database Center for Life
Science, CC BY 4.0 — see `public/ATTRIBUTION.md` and
`public/models/ASSET-SPEC.md`.
