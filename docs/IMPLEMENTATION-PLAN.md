# Implementation plan — guided anatomy → exercise flow

**Written:** 2026-09-06 · **Scope:** engineering only · **Companion to:** [`GUIDED-FLOW-CONCEPT.md`](./GUIDED-FLOW-CONCEPT.md)

This document translates the concept brief into work against *this* repository. It contains **no
clinical content and makes no clinical decisions**. Every file it proposes ships either empty or
with `status: draft` and `reviewed_by: ""`.

---

## 1. Corrected baseline — what is actually on disk

The brief's §1 table describes a different project (an Astro locator with a low-poly blockout).
Verified against the checkout on 2026-09-06:

| Piece | Brief claimed | Actually here |
|---|---|---|
| Stack | Astro + a three.js slice | **Vite 5 + React 18 + react-three-fiber 8 + drei + zustand**, single SPA (`src/App.tsx` demo route) |
| 3D figure | `public/anatomy/models/human-body-locator.glb`, ~3k-tri capsule blockout | **`public/models/body-male.glb` + `body-female.glb`**, ~80 KB each, Draco, 11.4k verts / 22.4k tris, derived from **BodyParts3D skin shell (FMA7163), CC BY 4.0** |
| Region model | "separate named meshes per region" | **Single mesh + `_REGIONID` float vertex attribute**, 81 regions. Splitting into meshes is explicitly forbidden by `public/models/ASSET-SPEC.md` (seams, popping, z-fighting) |
| Region data | none | **`src/components/body/regions.gen.ts`** — 81 regions with `numericId`, `maskColor`, EN **and AR** labels, `side`, `view`, `group` (12 head_neck / 26 shoulder_arm / 13 trunk / 30 lower_limb), `focusTarget`, `focusDistance`, `neighbours` |
| Picking | — | `useRegionPicker.ts` — raycast → `_REGIONID`, with a 20 px snap for small targets |
| Camera fly-to | "new work" | **Already built.** `store.ts` exposes `CameraCommand` `{kind:'focus', target, distance, nonce}`; `CameraRig.tsx` consumes it (damped orbit, ±35° clamp, idle auto-rotate) |
| Gender | "nothing" | **`gender: 'male' \| 'female'` prop already exists** and lazily loads the second model. What's missing is the *patient-facing selector, persistence, and any filtering meaning* |
| No-WebGL fallback | `fallback-body-map.svg` | **`Fallback2D.tsx` + `fallbackShapes.gen.ts`** — projected outlines, same region IDs, same callbacks |
| Locale | — | `locale: 'en' \| 'ar'` prop; chrome mirrors, scene does not. String table is inline in `App.tsx` |
| Asset pipeline | `ASSET-PIPELINE.md` | `scripts/build_body_asset.py`, `build_studio_hdr.py`, `compress-models.sh`, `neutralise-universal.mjs`; contract in `public/models/ASSET-SPEC.md`; licensing in `public/ATTRIBUTION.md` |
| Age bands | nothing | nothing ✔ |
| Motion / rig | nothing | nothing ✔ (bodies are static, unrigged) |
| Exercise content | 26 draft items | **nothing at all** — no content layer, no schemas, no gate, no compliance scan, no tests, no CI |
| Search | "some search present" | **not present** — there is a region list + "did you mean…?" neighbour disambiguation, no text search, no synonyms |

**Net effect on the plan.** P0 is materially cheaper than the brief assumes: the presentable figure,
region segmentation, AR labels and camera fly-to already exist and meet the contract. The genuinely
missing pieces are **search + synonyms**, **the who-is-this-for screen**, **the entire content
layer and its gate**, **compliance scanning**, **tests/CI**, and **all motion work**.

Two corrections the plan adopts:

1. **Do not split the mesh per region.** The brief asks for separate meshes; the shipped asset
   contract forbids it and `_REGIONID` already delivers the same capability. Thumb-sized hit
   volumes are handled by the existing 20 px raycast snap, tuned rather than re-modelled.
2. **MakeHuman/MPFB2 (CC0) is a P2 decision, not a P0 one.** The current bodies are already
   presentable, licensed, region-segmented and 80 KB. Re-basing on MakeHuman is only justified when
   a **rig** is needed — i.e. at the motion pilot. Doing it at P0 would throw away the segmentation,
   the neighbour graph, the thickness bake and the QA renders for no patient-visible gain. When it
   happens, the new mesh must satisfy `ASSET-SPEC.md` and re-emit `_REGIONID` with the same 81 ids.

---

## 2. Architecture: the renderer, not the engine

```
                        ┌───────────────────────────────────────────┐
   content/  (JSON,     │  build-time validation (Zod + scripts)     │
   clinician-owned) ───▶│  · schema         · compliance scan        │
                        │  · referential    · gate audit             │
                        └───────────────┬───────────────────────────┘
                                        │ only rows that pass
                                        ▼
   ┌──────────┐   ┌──────────┐   ┌─────────────┐   ┌───────────────┐
   │ Screen 1 │──▶│ Screen 2 │──▶│  Screen 3   │──▶│   Screen 4    │
   │ who      │   │ locate   │   │ questions   │   │ exercises OR  │
   │ (filter) │   │ (region) │   │ (route walk)│   │ escalation    │
   └──────────┘   └────┬─────┘   └─────────────┘   └───────────────┘
                       │ regionId → body_area
                       ▼
              BodyViewer (existing module, unchanged API)
```

Hard rules encoded in code review and tests:

- **R1 — No inference.** No scoring, weighting, ranking, ML, similarity matching or "closest route".
  Route resolution is an *exact lookup* on a normalised answer path. Miss → documented safe fallback.
- **R2 — One gate.** Guided flow and plain browsing call the *same* `selectPublished()` function.
  There is no second code path that can render content, and no prop that bypasses the gate.
- **R3 — Filters subtract only.** `suits_*` can remove items from a list. Nothing in the codebase may
  add, substitute or synthesise an item. Enforced by the filter's type signature
  (`(xs: Exercise[]) => Exercise[]` operating by predicate, plus a test asserting the output is a
  subset of the input).
- **R4 — Escalation wins.** If any answered option carries `red_flag: true`, the flow short-circuits
  to the escalation screen before any route lookup, and no exercise component is mounted.
- **R5 — Device-local only.** No fetch/XHR/beacon of patient selections. One `localStorage` key.
  Enforced by a lint rule and a test.

---

## 3. Content layer

**Format decision:** authored as **CSV** (one file per table, exactly mirroring the clinician's
sheet columns, so she can export straight from it), compiled at build time to validated JSON.
CSV is the human contract; JSON is the machine artefact and is git-ignored.

```
content/
  exercises.csv          # existing library + new suits_* columns
  questions.csv
  answer_options.csv     # split out of questions: one row per option, keeps red_flag auditable
  routes.csv
  escalation_messages.csv
  region_synonyms.csv
  body_areas.csv         # region_id -> body_area mapping (build-side seed, clinician-confirmable)
  README.md              # column-by-column authoring guide (see CLINICIAN-HANDOFF.md)
src/content/
  schema.ts              # Zod schemas, one per table
  compile.ts             # CSV -> validated JSON, fails the build on any error
  gate.ts                # selectPublished(), the single render gate
  filter.ts              # suits_sex / suits_age_bands, subtractive only
  routing.ts             # answer path normalisation + exact route lookup
generated/               # git-ignored compiled JSON
```

### 3.1 Columns

**`exercises.csv`** *(existing fields preserved; new ones additive and optional)*

| column | type | notes |
|---|---|---|
| `exercise_id` | slug | stable, never reused |
| `body_area` | enum(body_areas) | |
| `name`, `purpose`, `dosage`, `safety_note` | text | clinician's words, rendered verbatim, locked field order |
| `media_still_id`, `media_clip_id` | slug \| empty | must resolve to an approved media row |
| `suits_sex` | `male` \| `female` \| empty | **empty = everyone** |
| `suits_age_bands` | pipe list of band ids \| empty | **empty = everyone** |
| `status` | `draft` \| `published` | |
| `reviewed_by`, `reviewed_on` | text / ISO date | both required when `status=published` |

**`questions.csv`** — `question_id, body_area, prompt_en, prompt_ar, order, skippable, status, reviewed_by, reviewed_on`

**`answer_options.csv`** — `option_id, question_id, key, label_en, label_ar, order, red_flag, escalation_message_id, status, reviewed_by`
`key` is the token used in answer paths (`overhead`, `mornings`, `weeks`). `red_flag=true` requires an `escalation_message_id`.

**`routes.csv`** — `route_id, body_area, answer_path, outcome_kind (exercises|escalate), exercise_ids (pipe list), escalation_message_id, status, reviewed_by, reviewed_on`

**`escalation_messages.csv`** — `message_id, title_en, body_en, title_ar, body_ar, cta (contact|book|none), status, reviewed_by`

**`region_synonyms.csv`** — `region_id, locale (en|ar), term, status, reviewed_by`
One term per row so a single bad term can be rejected without invalidating the set.

**`body_areas.csv`** — `body_area, region_ids (pipe list), label_en, label_ar`
Collapses the 81 viewer regions into the coarser areas the library is organised by (e.g. the six
cervical/trapezius regions → `neck`). Build-side seed; clinician confirms the grouping.

### 3.2 Answer-path normalisation

An answer path is the canonical string form of a set of answers:

```
sorted by question_id, joined with "&", each "questionKey=optionKey", lowercase, no spaces
  duration=weeks&movement=overhead
```

Both the route table (at compile time) and the runtime resolver produce paths through the *same*
`normaliseAnswerPath()` function, so a route row can never be unreachable due to formatting.
Skipped questions are simply absent from the path — which means the clinician can author partial
routes (`movement=overhead` alone) and they are matched only when that is genuinely the whole path.
**No prefix, subset or wildcard matching in v1** — it is the smallest defensible semantics. If she
wants "any duration", she authors the rows; the compiler can generate the cross-product for a
`*` token *at build time* (so every row remains explicit and auditable) — flagged as an option,
not built until requested.

### 3.3 Validation (all build-blocking)

1. **Schema** — Zod, per table.
2. **Referential** — every `exercise_id`, `question_id`, `escalation_message_id`, `region_id`,
   `body_area` resolves; every `region_id` exists in `regions.gen.ts`.
3. **Gate integrity** — `status=published` ⇒ non-empty `reviewed_by` + valid `reviewed_on`;
   published exercises reference only approved media.
4. **Red-flag integrity** — every `red_flag=true` option has an escalation message that is itself
   published; no route may map a red-flag path to `outcome_kind=exercises`.
5. **Compliance scan** — the condition-name rule list runs over `prompt_*`, `label_*`, synonym
   `term`, escalation copy and exercise `name`/`purpose`. Any hit fails the build with file, row
   and matched term. (The rule list is clinician/compliance-owned data at
   `content/compliance/condition-terms.csv`; the scanner is build-side.)
6. **Orphan report** — non-blocking warning listing regions and body areas with zero published
   exercises, so the UI can mark them and the clinician can see the gap.

---

## 4. Phase plan

### P0 — Foundations (no clinical dependency, start now)

| # | Task | Notes |
|---|---|---|
| P0-1 | **Region search + synonyms** | Fuzzy-lite matcher over label_en/label_ar/synonyms: normalise (lowercase, strip diacritics, Arabic alef/ya/ta-marbuta folding), prefix + substring, rank exact > prefix > substring. No condition terms — synonym file passes the compliance scan. |
| P0-2 | **Search → fly-to** | Wire result selection to the existing `sendCamera({kind:'focus'})` + `selectedRegionId`. Already-built rig; this is glue. |
| P0-3 | **Keyboard/a11y pass** | Combobox pattern (`role=combobox`, `aria-activedescendant`), visible focus, region list always in the DOM, results announced via a polite live region. |
| P0-4 | **RTL correctness** | `dir=rtl` on the chrome, logical CSS properties throughout, mirrored iconography, RTL search input with LTR-safe latin fallback. Scene never mirrors (anatomical left must stay anatomical left). |
| P0-5 | **Screen 1 selector** | Sex + age band + prominent Skip. One `localStorage` key `bv.profile.v1` = `{sex?, ageBand?, savedAt}`. Skipping stores nothing. Clear-my-choices control. Cosmetic only at P0 (drives which mesh loads); no filtering until P1. |
| P0-6 | **`body_areas.csv` seed + region→area mapping** | Build-side, non-clinical (it's a grouping of anatomy, not advice) but flagged for clinician confirmation. |
| P0-7 | **Content pipeline skeleton** | `schema.ts`, `compile.ts`, all six CSVs present with headers and **zero data rows**. Build passes on empty. |
| P0-8 | **Compliance scanner** | Runs over whatever content exists; passes trivially while empty. Wired now so it can never be "added later". |
| P0-9 | **Tests + CI** | Vitest + GitHub Actions: typecheck, build, compile-content, compliance scan, gate tests, R1/R3/R5 invariant tests, asset budget check (GLB ≤ budget, decoders present). |
| P0-10 | **No-JS / no-WebGL story** | Confirm `Fallback2D` covers the region list path; document the JS-off limits honestly (a Vite SPA is not JS-off capable — see §6 risk). |

**P0 exit:** a patient can find any of 81 regions by tap, list or search in EN or AR, the camera
flies there, and their profile persists locally. Zero clinical content exists, and the machinery to
reject un-reviewed content is already running in CI.

### P1 — Guided flow, still media — **BLOCKED ON D8**

Do not start P1 UI work before the Medical Director's D8 ruling and disclaimer wording are in hand.
The content pipeline (P0-7/8) is *not* blocked — it only rejects content, it never renders it.

| # | Task |
|---|---|
| P1-1 | Question engine: one question per screen, progress, back, skip, answers held in memory only |
| P1-2 | `routing.ts`: normalisation + exact lookup + explicit `unrouted` result |
| P1-3 | Red-flag short-circuit (R4) — evaluated on every answer, before routing, unskippable screen, no exercise component mounted on that branch |
| P1-4 | Results screen rendering the locked field order, gated via `selectPublished()` (R2) |
| P1-5 | `suits_*` filtering (R3) + the "filter emptied it, here is the unfiltered set" neutral note |
| P1-6 | Unrouted fallback: full published set for the area + contact-the-clinic CTA |
| P1-7 | Printable handout (print stylesheet, exercises ± answers per open question 5) |
| P1-8 | Disclaimer placement per D8 wording |
| P1-9 | Device-local completion ticks (`bv.progress.v1`) |

### P2 — Motion pilot

| # | Task |
|---|---|
| P2-1 | Decide and document the MakeHuman/MPFB2 (CC0) re-base; must re-emit `_REGIONID` for the same 81 ids and pass `ASSET-SPEC.md` |
| P2-2 | Rig + age/sex shape morphs on one shared rig |
| P2-3 | Clip pipeline: key → render side+front → export loop **and** matching still → provenance metadata → review queue |
| P2-4 | `media.csv` gains clip fields; reduced-motion returns the still; never autoplay with sound |
| P2-5 | 10–20 clips on the highest-traffic exercises; per-clip clinician sign-off recorded in the media row |

### P3 — Scale + localisation

Full clip library; extract the `App.tsx` string table into proper i18n resources; versioned service
worker for offline; Arabic content parity check in CI (every published EN string has an AR peer).

---

## 5. Concrete first commit (P0-1/2/3/4)

Smallest useful slice, all inside the existing module boundary:

```
src/components/body/search.ts        normalise(), searchRegions(query, locale) -> ranked hits
src/components/body/synonyms.gen.ts  compiled from content/region_synonyms.csv (empty until authored)
src/components/search/RegionSearch.tsx  accessible combobox
src/App.tsx                          mount search; on select -> setSelectedRegionId + focus command
```

`BodyViewer`'s public prop API does not change — search is app-layer, the viewer stays a
presentation module. That preserves the "only surface the app sees" property in the README.

---

## 6. Risks the plan does not paper over

1. **"Works with JavaScript off" is currently false and not cheap to fix.** This is a client-rendered
   Vite SPA; there is no server rendering. Options: (a) accept it and delete the claim, (b) add a
   pre-rendered static region-list + per-area page set at build time (moderate work, keeps the
   promise for the *content* path while the 3D remains a JS upgrade), (c) migrate to a framework
   with SSR (expensive). **Recommendation: (b), scheduled in P1**, because the gated exercise pages
   are exactly the content that must survive without JS.
2. **The 81 viewer regions are finer than any exercise library.** `body_areas.csv` is the shock
   absorber, but the mapping is a judgement call the clinician should confirm — otherwise "left
   deltoid posterior" leads somewhere she never intended.
3. **Exact-match routing scales combinatorially.** Three questions × four options = up to 64 rows
   per body area. Mitigations, in order of preference: fewer questions (open question 4), a build-time
   `*` cross-product expansion (§3.2), and the always-safe unrouted fallback. Do **not** mitigate it
   with runtime partial matching — that is inference (R1).
4. **Re-basing the mesh at P2 is a real regression risk.** The current asset carries a segmentation,
   neighbour graph and thickness bake that took a pipeline to produce. Budget the re-emit of
   `_REGIONID` and a full picking QA pass, and keep the current GLBs shippable until the new ones
   pass it.
5. **Compliance scanning is only as good as the term list.** The 36 condition-name rules are
   referenced in the brief but do not exist in this repo. They must arrive as data before the
   scanner means anything; until then it is a stub that passes.
6. **Female mesh is a reshape, not a scan** (`ASSET-SPEC.md` says so plainly). Fine for region
   picking; worth being honest about before it is presented as a female body form in Screen 1.

---

## 7. Definition of done per invariant

| Invariant | Verified by |
|---|---|
| R1 no inference | Code review + test: routing returns `unrouted` for any path absent from the table |
| R2 one gate | Test: every render path for exercises goes through `selectPublished`; grep-based test forbids direct imports of the raw content JSON in components |
| R3 subtractive filters | Property test: `filter(xs) ⊆ xs` for random inputs |
| R4 escalation wins | Test: any red-flag answer yields an escalation outcome and mounts no exercise |
| R5 device-local | Lint rule banning `fetch`/`sendBeacon` in profile code + test that only `bv.*` keys are written |
| Zero condition names | Compliance scan in CI, build-blocking |
| No unreviewed render | Gate tests + build-time gate integrity check |
