# Guided 3D Anatomy → Exercise App — Concept & Build Spec

**Status:** concept / build brief. **Written:** 2026-09-06. **Owner of this document:** build side.
**Not clinical content.** Every question, routing rule, filter and exercise referenced here is a
*placeholder for clinician-authored input*. Nothing in this document approves clinical content.

> **Companion documents**
> - [`IMPLEMENTATION-PLAN.md`](./IMPLEMENTATION-PLAN.md) — how this maps onto *this* repository,
>   with a corrected baseline, file layout, schemas and phase-by-phase engineering tasks.
> - [`CLINICIAN-HANDOFF.md`](./CLINICIAN-HANDOFF.md) — the authoring pack: exactly what the
>   physiotherapist and Medical Director must supply, in the shape the build expects.

---

## 0. Read this first — the one structural constraint

The product this spec describes is a **guided path**: a patient picks who they are, finds their
body part on a 3D figure, answers a few questions, and receives exercises to follow along with.

That guided path is the whole value, and it is also the whole risk. Three of the project's
standing rules bear directly on it:

- **Navigation is by body area, never by condition** (D-001). The app may ask *where* it is and
  *how it moves*. It must never name, imply, or infer a diagnosis.
- **Never invent clinical content.** Question wording, answer options, which answers lead to which
  exercises, and which exercises suit which age band are **all clinical decisions**. The build side
  ships the machinery; the physiotherapist authors the content and the logic. Anything clinical
  enters as `status: draft` with empty `reviewed_by`.
- **Decision D8 is open** — whether this site is patient *education* or a regulated *medical
  advertisement/advice* under DHA/MOHAP. A questionnaire that outputs personalised exercise
  recommendations is materially more advice-shaped than a browsable library. **This spec must go to
  the Medical Director before the guided flow is built**, not after.

The design principle that keeps this safe: **the app is a renderer of the clinician's decision
tree, never an inference engine.** It does not diagnose, score, or reason clinically. It walks a
tree she authored, and shows what she attached to that leaf. If the tree has no answer for a path,
the app says so and offers to book a human — it never guesses.

Framed that way, the questions are not triage. They are a **filter over her library**, expressed
in her words, with her routing. That is buildable, defensible, and still delivers the experience
you described.

---

## 1. What exists today (as described in the original brief)

> ⚠️ **This table did not match the repository when the brief was reviewed on 2026-09-06.**
> It describes an Astro locator project with a low-poly blockout. The actual checkout is a
> Vite + React + react-three-fiber `BodyViewer` module with a segmented BodyParts3D-derived
> body and 81 named regions. The corrected baseline — which is what the plan is built on — is in
> [`IMPLEMENTATION-PLAN.md` §1](./IMPLEMENTATION-PLAN.md#1-corrected-baseline--what-is-actually-on-disk).
> The table is retained verbatim below because the *conclusions* it drives (no gender/age data,
> no motion, no gated exercise content) remain true.

| Piece | Reality claimed in the brief |
|---|---|
| 3D figure | `public/anatomy/models/human-body-locator.glb` (83 KB) + `-optimized.glb` (66 KB). One **low-poly locator blockout** — capsules/spheres, ~3k triangles. Good enough to pick a region; **not** an anatomical or presentable human. |
| Model registry | `src/lib/anatomy/model-registry.ts` + validation — real, reusable. |
| Locator UI | `src/components/anatomy/FullBodyLocator.astro` (+ a three.js slice component). Works, JS-off safe, some search present. |
| Fallback | `public/anatomy/fallback-body-map.svg` — the tier-1 no-3D path. Keep it. |
| Gender / age | **Nothing.** No variants, no selector, no data fields. |
| Animation / motion | **Nothing.** No `public/motion`, no rigged character, no clips. |
| Exercise content | 26 items, **all draft, none clinician-signed** → the live site renders zero exercises. |

So: the locator tier is real, the **presentable figure, the gender/age variants, and every
animation are new work.** If a better 3D model exists outside this repo, it needs importing through
the asset pipeline (license metadata is a hard build requirement) before it can be used.

---

## 2. The experience, screen by screen

### Screen 1 — Who is this for?

Purpose: make the figure feel like the patient, and let the clinician's rules narrow what's shown.

- **Sex/body form:** male / female (drives which base mesh loads).
- **Age band:** clinician-defined bands, not a free number. Suggested starting bands for her to
  confirm or replace: `teen (13–17)`, `adult (18–49)`, `older adult (50–69)`, `senior (70+)`.
- **Skip is always available.** Skipping loads a neutral figure and applies no filter. No patient
  is ever forced to disclose anything.

**Privacy, non-negotiable:** these selections are **device-local only** (one `localStorage` key,
consistent with D-007's allowance). No accounts, no analytics, no transmission. There is no backend
to send them to, and that stays true.

**What they *do* — and who decides.** You asked that gender and age also filter exercises. That is
a clinical rule, so the mechanism is ours and the rule is hers. Implementation: each exercise row
gains optional `suits_sex` and `suits_age_bands` columns. Empty = shown to everyone (the default,
so nothing disappears until she deliberately narrows it). The app filters; it never adapts dosage,
never substitutes an exercise, and never invents an age-appropriate variant.

> **Safety property to preserve:** filtering may only ever *hide* items she marked as unsuitable.
> It must never *generate* an alternative. If a filter empties an area, the app shows the
> unfiltered set with a neutral note — patients see fewer options, never zero, and never a fabricated one.

### Screen 2 — Find the body part

The centrepiece. Three ways in, all reaching the same place:

1. **Tap the 3D figure.** Rotate, zoom, tap a region. Regions highlight on hover/focus with a
   clear selected state (no flashing — per the pipeline's visual-review checklist).
2. **Pick from a list.** A plain, always-visible list of named regions (neck, shoulder, elbow,
   wrist/hand, upper back, lower back, hip, knee, ankle/foot …). This is the accessible path and
   the JS-off path — not a lesser fallback.
3. **Search.** Type "neck", "hand", "shoulder blade", "calf". Results show the region name; on
   selection **the 3D camera flies to that region and highlights it**, exactly as you described.

**Search needs a synonym layer, and it is the sneaky-hard part.** Patients don't type anatomical
names. "Lower back" / "lumbar" / "small of my back", "hand" / "wrist", "shin" / "front of leg",
plus **Arabic terms and transliterations**. So each region carries a synonym list — and here is the
trap: *a synonym list is where condition names sneak in.* Someone will inevitably want "sciatica"
to find the lower back. **The compliance engine's 36 condition-name rules must run over the synonym
table**, so that door stays shut. Synonyms are clinician-reviewed vocabulary, not free-form SEO.

Every region resolves to a `body_area` that already exists in her sheet. No orphan regions: if a
region has no published content, it is visibly marked as such rather than leading to a dead page.

### Screen 3 — A few questions

Two or three short screens, one question each, always skippable, with visible progress and a
back button.

**The shape of a question** (mechanism ours, content hers):

- *Which movement is limited or uncomfortable?* → e.g. turning left/right, looking up/down, reaching overhead
- *When does it bother you most?* → e.g. mornings, after sitting a long time, during/after activity
- *How long has this been going on?* → e.g. a few days, a few weeks, longer

Notice what these are **not**: they don't ask sharp-vs-dull, they don't score severity, they don't
name conditions. They ask about **movement and timing** — observable, non-diagnostic, and they map
cleanly onto how exercises are actually organised.

**Red flags are the exception that must be built in.** Some answers must not lead to exercises at
all. Numbness or weakness, symptoms after trauma, night pain that wakes you, loss of bladder/bowel
control, unexplained weight loss — these are **stop-and-see-someone** paths. The clinician
authors the list and the wording; the app's job is to make the stop path **unskippable and
unmistakable**, and to show her escalation message instead of any exercise. This is a feature of
the flow, not an edge case, and it is much of what makes the guided path defensible.

**The data structure** — a small, boring, auditable table she owns:

```
question_id | body_area | prompt | answer_options | order | status | reviewed_by
route_id    | body_area | answer_path (e.g. "movement=overhead & duration=weeks")
            | outcome: exercise_ids[] | OR outcome: escalate(message_id)
            | status | reviewed_by
```

The app resolves an answer path to a route row and renders its outcome. **No route row → no
guess.** It falls back to "here is everything published for this area," plus an offer to contact
the clinic. Unrouted is a safe state by construction.

### Screen 4 — The exercises

The payoff. For each recommended exercise, in her locked field order: name, what it's for (her
words), the demonstration media, dosage (sets/reps/hold/frequency — hers, verbatim), and her
safety/stop line.

**Nothing appears here that isn't `published` + `reviewed_by` + approved media.** The existing
render gate is not bypassed for the guided flow — the guided flow is just a different route *into*
the same gated content. That's the single most important architectural decision in this document.

Device-local completion ticks are permitted (already an allowed `localStorage` key). Printable/
shareable handout per area, since clinicians actually want that (it's what HEP2go proves).

---

## 3. Media: the images and animations

You asked for realistic animated 3D movement, and for the build to research and produce what's
needed. Here's the honest sequencing — this is the most expensive part of the concept by a wide
margin.

### The figure itself

- **Base meshes:** generate male and female figures in **MakeHuman/MPFB2** — its output is **CC0**,
  which means zero licensing friction on the most-loaded asset in the app.
- **Style:** clean, non-photoreal, neutral clothing, no distracting detail. Patients need to
  recognise a body part, not admire skin pores. Non-photoreal also avoids implying a specific
  patient and dodges the uncanny-valley problem entirely.
- **Regions:** named region addressing per region so raycast selection stays simple and enlarged
  hit volumes can be tuned for thumbs. (In this repo that is the `_REGIONID` vertex channel, not
  separate meshes — see the plan.)
- **Budget:** per the pipeline — Draco/Meshopt, aggressive decimation, tested on a mid-range phone.
  Target the whole locator experience well under a couple of MB. Progressive: SVG map paints first,
  3D upgrades in behind it, and a failed upgrade never removes the map.
- **Age/sex variants** are body-shape morphs on a shared rig, not four separate models — otherwise
  asset count and review burden quadruple.

### Animations — phased, because this is where projects die

| Phase | Media | Why in this order |
|---|---|---|
| **P1** | Approved **still images** per exercise (existing gated pipeline) | Ships now. Content already flows through it. Proves the guided flow end to end with zero new 3D risk. |
| **P2** | **Loop animations for the highest-traffic exercises** on the rigged MakeHuman figure — 3–6 s, side + front angle, silhouette-clear | Real motion where it matters most, without committing to 100+ clips. Establishes the review workflow while the batch is small. |
| **P3** | Full animated library + optional narration/counting | Only after P2's pipeline and clinician review loop are proven at small scale. |

**Production route for a clip:** research the movement against reference sources (a coverage
checklist, never a copy source) → key the movement on the rigged base → render both angles →
export a looping clip **and** a still frame (so P1 media and the animation stay consistent) →
attach license/provenance metadata → **clinician reviews the actual movement** → publish.

**The review step is the hard requirement, not the rendering.** An animation that demonstrates a
movement slightly wrong is worse than a still image that's merely static — a patient will copy what
they see. So: no animation reaches a patient without the clinician confirming *that specific clip*
shows *that specific movement* correctly. Same gate as text, applied to motion, because motion
carries the same clinical weight.

Accessibility and honesty: respect `prefers-reduced-motion` (show the still), never autoplay with
sound, always pair a clip with her written instructions — the animation supplements her words, it
never replaces them.

---

## 4. What the build side does vs. what the clinician must supply

**Build side (no clinical judgement, can start now):**

1. Gender/age selector + device-local persistence + neutral-default behaviour.
2. Presentable male/female base meshes, region-addressable, optimized, through the asset
   pipeline with license metadata. Age/sex morph variants.
3. Search with synonym matching, camera fly-to-region, keyboard accessible, Arabic-ready.
4. The question-flow *engine*: renders clinician-authored questions, resolves answer paths to route
   rows, handles unrouted safely, makes escalation paths unskippable.
5. Content columns + Zod schemas + validation for `questions`, `routes`, `suits_sex`,
   `suits_age_bands`, and region synonyms. Compliance scan extended over questions, answers,
   synonyms and escalation messages.
6. Media pipeline for clips (render, optimize, still-frame extraction, reduced-motion fallback).
7. Wire asset checks and the gate/route tests into CI so none of the above can regress silently.

**Clinician (nothing ships without these):**

1. The **question set per body area** — wording and answer options, in her words.
2. The **routing table** — which answer paths lead to which exercises.
3. The **red-flag list** and her escalation wording.
4. **`suits_sex` / `suits_age_bands`** on exercises she wants narrowed (default empty = everyone).
5. **Region synonyms** she's comfortable with (this is patient vocabulary, condition-free).
6. **Sign-off on every animation clip**, not just the text.
7. Publishing existing content: 26 items are drafted and none are signed — the guided flow has
   nothing to show until that's resolved.

**Medical Director:** **D8** — does the guided questionnaire keep this on the education side of
DHA/MOHAP, and what disclaimer wording must accompany it? **This gates the whole guided flow.**

---

## 5. Roadmap

| Phase | Scope | Gate to enter |
|---|---|---|
| **P0 — Foundations** | Presentable 3D figures (M/F), region split, optimization, search + synonyms, camera fly-to, gender/age selector (cosmetic first) | None. Safe, non-clinical, start now. |
| **P1 — Guided flow, still media** | Question engine, routing table, red-flag escalation, filtered results, printable handout | **D8 decided** + clinician's questions/routes/red flags authored + content published |
| **P2 — Motion pilot** | Rigged figure, 10–20 animated clips on top-traffic exercises, review workflow proven, reduced-motion fallbacks | P1 live and stable; clinician review loop agreed |
| **P3 — Scale + localisation** | Full animated library, **Arabic/RTL throughout**, optional offline (versioned SW) | P2 pipeline proven |

**On Arabic:** it appears in P3 as *full* localisation, but build **RTL-correctness in from P0** —
layout, mirroring, search input. Retrofitting RTL is far more expensive than respecting it from the
start, and per the resources research it's the genuine market gap versus the English-first
incumbents. Treat it as a first-class requirement wearing a late label.

---

## 6. What "good" looks like

- A patient reaches the right exercises in **under 30 seconds**, on a mid-range phone, on clinic wifi.
- The whole thing works **with JavaScript off and with 3D unavailable** — the region list and search
  carry the flow.
- **Zero** un-reviewed clinical content ever renders. The guided flow uses the same gate as the library.
- **Zero** condition names anywhere in questions, answers, synonyms or UI — compliance-enforced, not vibes.
- Red-flag answers reliably reach the escalation message and **never** an exercise.
- The clinician can add a question, a route, or narrow an exercise by age **entirely from the
  sheet**, with no code change.

---

## 7. Open questions to settle before P1

1. **D8** — Medical Director's classification and required disclaimer wording. Blocking.
2. Should the guided flow be the **default entry point**, or an option alongside plain browsing?
   (Browsing is the safer default; guided is the better experience. Could be a labelled choice on
   the home screen.)
3. Age bands — confirm or replace the suggested four.
4. How many questions maximum before it feels like an interrogation? (Two or three is my
   recommendation; hers to decide.)
5. Does she want the printable handout to include the questionnaire answers, or exercises only?
6. Animation house style — figure appearance, camera angles, clip length — agreed once, up front,
   so P2 doesn't get re-rendered.
