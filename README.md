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

No clinical content exists in this repo, and the guided flow is blocked on decision D8.

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
| `src/components/body/skinMaterial.ts` | Patched `MeshPhysicalMaterial`: wrap-lighting SSS, fresnel backscatter, rim light, in-shader region highlight (guarded `onBeforeCompile`, plain-PBR fallback) |
| `src/components/body/useRegionPicker.ts` | Raycast → `_REGIONID` region resolution + 20 px snap for small targets |
| `src/components/body/CameraRig.tsx` | Damped spherical orbit, ±35° vertical clamp, idle auto-rotate, fly-to-region |
| `src/components/body/PinMarker.tsx` | Surface-welded draggable pain pins, yellow→red intensity grading |
| `src/components/body/Fallback2D.tsx` | No-WebGL SVG diagram — same region IDs, same callbacks |
| `src/components/body/store.ts` | Internal zustand state (never leaks outside the module) |
| `public/models/` + `ASSET-SPEC.md` | Segmented GLBs + the exact contract for swapping in licensed scans |
| `scripts/build_body_asset.py` | Asset pipeline: extraction, segmentation, thickness bake, GLB/typed-data generation |
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
- 0.63 MB per body GLB (budget: ≤ 6 MB), 22.4k triangles
- DPR capped at 2, auto-drops to 1.5 when frame time > 20 ms
- Post-processing (SMAA + high-threshold bloom + vignette + subtle CA)
  disabled automatically on low-end devices; no WebGL → 2D SVG fallback
- Decoders (Draco/KTX2/Basis) self-hosted in `/public/decoders/`

## Data attribution

Body geometry derived from **BodyParts3D** © The Database Center for Life
Science, CC BY 4.0 — see `public/ATTRIBUTION.md` and
`public/models/ASSET-SPEC.md`.
