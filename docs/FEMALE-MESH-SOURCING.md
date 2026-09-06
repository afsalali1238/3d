# Sourcing a real female base mesh

**Written:** 2026-09-06 · **Decision requested:** approve a source, then schedule the pipeline run.
**Status:** research complete, execution blocked on tooling (no Blender in the build sandbox).

---

## The problem

`public/models/ASSET-SPEC.md` states it plainly:

> The female variant is a smooth regional reshape of the same scan (a stand-in
> until a licensed female scan is sourced).

So `body-female.glb` is a morphed **male** BodyParts3D skin shell. That is fine for a region
locator — silhouette is enough to pick a shoulder. It becomes a problem the moment Screen 1 asks a
patient *"which body form are you?"* and then presents this as the female answer. That is a small
honesty issue and, in a clinic context, an avoidable one.

---

## Candidates evaluated

| Source | License | Rigged | Fit for this pipeline | Verdict |
|---|---|---|---|---|
| **MPFB2 / MakeHuman** (Blender plugin) | **CC0** for generated assets (code is GPLv3, bundled assets CC0) | Yes — auto-rig, Rigify support | Parametric: age, build, gender, ethnicity are sliders. Generates M *and* F from one system. | ✅ **Recommended** |
| **Anny** (NAVER, MakeHuman-derived) | Apache 2.0 code, **CC0** MPFB2 assets | Yes — 104-bone compact rig | Python/PyTorch, programmatic body generation, all ages. Excellent for scripted variant generation. | ✅ Strong alternative |
| **Blender Studio Human Base Meshes** | **CC0** | No | 17 meshes incl. complete male + female. Clean topology, sculpt-oriented. | ⚠️ Good mesh, no rig |
| Sketchfab "Human Male/Female Basemesh Rigged" | CC **BY** | Yes | 37.3k tris, T-pose. Attribution required. | ⚠️ Workable, attribution burden |
| Current `body-female.glb` | CC BY 4.0 (BodyParts3D) | No | Male scan, reshaped. | ❌ Replace |

**Recommendation: MPFB2.** Reasons, in order of weight:

1. **CC0 removes all licensing friction** on the single most-loaded asset in the app. No
   attribution chain to maintain in `ATTRIBUTION.md`, no ambiguity if the clinic later wants to
   use renders in printed handouts or marketing.
2. **One system generates every variant we need.** Male, female, and the four age bands become
   slider values on a shared topology — which is exactly the "morphs on a shared rig, not four
   separate models" requirement from the concept brief. Asset count and review burden stay flat.
3. **It is already rigged**, which is the P2 motion prerequisite. Doing the female-mesh work and
   the rig work as one job avoids re-basing the mesh twice.
4. Actively maintained (MPFB 2.08+, Blender 4.2+), unlike the abandoned standalone MakeHuman.

---

## Why this is not done yet

The build sandbox has **no Blender** (`which blender` → nothing, `import bpy` → ImportError).
MPFB2 is a Blender plugin; Anny needs PyTorch plus a model download. Neither can run here, and
faking it with a procedural mesh would be worse than the honest stand-in already shipped.

This is a **local-workstation task**, not a CI task. It produces binary assets that get committed
once, not on every build.

---

## Execution plan (one working session on a machine with Blender 4.2+)

```
1. Install MPFB2 into Blender 4.2+.
2. Generate two bodies from the same topology:
     - female: adult, average build, neutral proportions
     - male:   adult, average build, neutral proportions
   Keep the SAME topology and vertex order for both — this is what makes
   morph-based age variants possible later.
3. Pose to the asset-spec rest pose: relaxed A-pose, feet flat at y=0, arms
   clear of the torso so armpits and inner arms remain pickable.
4. Export GLB, metres, Y-up, +Z anterior, +X anatomical left, height 1.6–1.9 m.
5. Run the existing pipeline:
     ATLAS_DIR=... python3 scripts/build_body_asset.py     # re-segment
     ./scripts/compress-models.sh                          # Draco
     node scripts/neutralise-universal.mjs                 # universal anatomy pass
6. Verify (this is the part that must not be skipped):
     - all 81 `_REGIONID` values present and integer-exact after Draco
     - `regions.gen.ts` focus targets and neighbour graph regenerated
     - `fallbackShapes.gen.ts` regenerated (the 2D map is first paint now —
       a stale fallback is a visible bug, not a cosmetic one)
     - picking QA: every region resolves by raycast, front and back
     - `npx vitest run` — the perf budget test enforces ≤ 250 KB per GLB
7. Update `public/ATTRIBUTION.md`: MPFB2/MakeHuman, CC0, generation date and
   the slider parameters used, so the asset is reproducible.
```

### Hard requirements the new mesh must meet

Non-negotiable, from `ASSET-SPEC.md` and the current code:

- **Single mesh, one draw call.** Do not split per region — the shader highlight and the picker
  both key off `_REGIONID`, and split meshes reintroduce seams and z-fighting.
- **`_REGIONID` float vertex attribute**, values matching `numericId` in `regions.gen.ts`,
  all 81 ids present.
- **`_THICKNESS`** recommended (drives the SSS approximation; without it skin falls back to
  plain PBR + wrap lighting).
- 40k–80k triangles preferred, 120k ceiling. ≤ 250 KB per GLB after Draco (enforced by test).
- Region boundaries follow anatomical contours, not bounding boxes.

### Risk

Re-basing throws away a segmentation, neighbour graph and thickness bake that took a pipeline run
to produce. **Keep the current GLBs shippable until the new ones pass step 6.** Budget a full
picking QA pass, not just a visual check — a mesh that looks right but picks wrong is the worst
outcome, and it is not visible in a screenshot.

---

## Interim position (in effect now)

Until the above runs, Screen 1's sex selector is **cosmetic** — it swaps the mesh and nothing else,
because no exercise currently sets `suits_sex`. The honest framing already used in the UI copy is
*"body form"*, not *"sex"*, and the sub-label says it only changes the figure shown. That is
defensible for a locator. It stops being defensible if the clinician starts narrowing exercises by
sex while the female figure is still a morphed male scan — so **this work should land before any
`suits_sex` value is authored.**
