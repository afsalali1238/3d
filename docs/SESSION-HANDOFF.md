# Session Handoff — minimal intake + Vercel fixes

Repository: `afsalali1238/3d`
Session branch: `arena/01a07686-3d`
Date: 2026-09-06

## What this session ships

The production flow is now deliberately short and mobile-first:

```
welcome → 5-field intake → tap the 3D / 2D body → exercises (MoveClip + SVG)
```

The long questionnaires — red-flag wall, precautions, onset / duration /
irritability / pattern, movement / timing — are **not** on the patient path in
this release. They were skipped at the content level and removed from the app
flow. They can be brought back later without changing the body viewer.

## Re-applied work (local commits were not present in this checkout)

The original local commit hashes (`31d6ef6`, `7e09cde`, `f5832aa`) were not
available in this working copy, so the work was re-created from the handoff.
The three logical commits made here correspond to those changes:

1. `31d6ef6` — skip long questionnaires + `/exercises/` rewrite fix
2. `7e09cde` — shorter welcome
3. `f5832aa` — minimal intake + direct body → exercises flow

## Changes in detail

### Skip long questionnaires

- `content/questions.csv`, `content/red_flags.csv` and `content/precautions.csv`
  rows are now `status = draft`. The patient sees zero published questions,
  red-flag screens or precaution screens.
- `src/content/bundle.gen.ts` was regenerated with `npm run content:build`.
- The app flow no longer renders those steps even when content is eventually
  re-published; re-publishing the rows alone is not enough to bring the screens
  back.

### Vercel / static exercise media

- `vercel.json` rewrite now excludes `/exercises/` so the existing
  `public/exercises/*.jpg` frames are served as real static assets instead of
  being rewritten to `index.html`.
- The exercise cards still use `MoveClip` (cross-faded frame loop) + `MotionGuide`
  (inline SVG line figure).

### Shorter welcome

- Welcome is now one screen: app name, one-line promise, privacy note,
  optional “not my device” switch, continue.
- No long consent / red-flag preview copy.

### Minimal intake

New `src/privacy/intake.ts` and `src/components/journey/Intake.tsx`.

Fields collected, in this order:

1. Male / Female
2. Height (cm)
3. Weight (kg)
4. Long-term condition (Yes / No)
5. Pain now (0–10)

Deliberate rules:

- **No BMI.** Height and weight are stored raw only. No derived index is
  computed, displayed or used for routing. (The repo test enforces this.)
- **Patient data stays on the device.** Intake is persisted through
  `src/privacy/storage.ts`, so “not my device” keeps it in `sessionStorage`
  rather than `localStorage`. There is no network call, account or analytics.
- No age-band gate, no demography question beyond sex.

### Flow changes in `src/components/journey/Journey.tsx`

- Steps reduced to `welcome`, `intake`, `body`, `results`.
- After intake, the component loads the existing `BodyViewerLazy` / `Fallback2D`
  map. `BodyViewer` and all 3D internals are unchanged.
- Tapping a region or using the region picker sets the body area; the bottom
  sheet shows the area and a Continue action.
- Continue goes straight to exercises.
- Exercises are resolved with `resolveOutcome(CONTENT, area, {}, { sex })`, so
  only published exercises for that area are shown. Because questions are
  draft, the result is the full published area set (safe `unrouted` fallback).
- `ExerciseCard` renders each item with `MoveClip` + `MotionGuide` SVG.

## Files changed

```
content/precautions.csv
content/questions.csv
content/red_flags.csv
content/README.md
docs/SESSION-HANDOFF.md
README.md
src/components/journey/Intake.tsx
src/components/journey/Journey.tsx
src/components/journey/journey.css
src/content/bundle.gen.ts
src/privacy/intake.ts
vercel.json
```

## Verification

- `npm run build` passes.
- `npm test` passes (116 tests).
- `npm run content:build` regenerates the bundle with 10 published exercises and
  0 published questions / red flags / precautions.
- Content validation produces only the intended informational warnings that
  body areas have no published questions.

## Do not rewrite

- `src/components/body/*` and all 3D internals are out of scope for this change.
- No DEMO badges were added.
- No BMI anywhere.

## Bring back later (only if requested)

- Re-publish `questions.csv`, `red_flags.csv`, `precautions.csv`.
- Re-add the corresponding screens in `Journey.tsx` (these are not currently
  wired into the visible flow).
- Re-enable route-guided exercise selection when questions are published again.

## For Vercel

After the PR is merged into `main`, Vercel production should deploy the merged
`main`. The `/exercises/` static frames and the minimal intake flow should both
ship.
