# Clinician & Medical Director handoff pack

**Written:** 2026-09-06 · Companion to [`GUIDED-FLOW-CONCEPT.md`](./GUIDED-FLOW-CONCEPT.md) and
[`IMPLEMENTATION-PLAN.md`](./IMPLEMENTATION-PLAN.md).

This is the list of things the build side **cannot** produce, in the exact shape the build expects
them. Nothing here is drafted for you: any example text below is *format illustration only* and is
marked as such. The app renders your words verbatim and never generates alternatives.

---

## A. Blocking decision — Medical Director (D8)

The guided flow is **not built** until this is answered in writing.

1. Under DHA/MOHAP, does a questionnaire that outputs personalised exercise recommendations keep
   this site on the **patient-education** side, or does it become a regulated **medical
   advertisement / advice** service?
2. If education: what **disclaimer wording** must accompany (a) the questionnaire, (b) the results
   screen, (c) the printable handout, and where must it appear?
3. Is there a required practitioner attribution / licence-number display?
4. Does the red-flag escalation wording need specific regulated phrasing?

Until (1) is answered, build work is confined to P0 (region search, profile selector, RTL,
validation machinery) — none of which renders clinical content.

---

## B. What the physiotherapist supplies

Each item below is one CSV in `content/`. Files exist with headers and **zero rows** today; the app
renders nothing until rows arrive with `status: published` and a non-empty `reviewed_by`.

### B1. Body-area grouping — *confirm, don't author*
The 3D figure has 81 anatomical regions, finer than an exercise library needs. The build side will
seed `body_areas.csv` grouping them (e.g. the cervical and trapezius regions → one `neck` area).
**Please confirm or redraw that grouping** — it decides where a patient lands when they tap.

### B2. Questions — `questions.csv` + `answer_options.csv`
- Per body area, **2–3 questions maximum** (recommended; yours to set).
- About **movement and timing only**. Not severity, not sharp-vs-dull, not condition names.
- Every question is skippable, and skipping must remain a safe path.
- Each answer option needs a short `key` (a token like `overhead`, `mornings`) — the routing table
  refers to options by these keys.
- Arabic wording for every prompt and option, or the row stays English-only and is flagged.

*Format illustration only — not proposed content:*
`question_id=neck_q1 | body_area=neck | prompt_en="…" | order=1 | skippable=true`
`option_id=neck_q1_a | question_id=neck_q1 | key=overhead | label_en="…" | red_flag=false`

### B3. Red flags — `answer_options.csv` (`red_flag=true`) + `escalation_messages.csv`
- Which answer options must **stop the flow** and show a message instead of exercises.
- Your escalation wording, English and Arabic, plus which call-to-action it carries
  (contact the clinic / book / none).
- The build guarantees: a red-flag answer can never reach an exercise, the screen cannot be
  skipped past, and the build fails if a red-flag option lacks a published message.

### B4. Routing — `routes.csv`
For each body area, which combinations of answers lead to which exercises.
- The app does **exact matching only** — it will never guess a "closest" route.
- Any combination you don't author falls back to "everything published for this area" plus an offer
  to contact the clinic. That is a safe, intentional state; you don't have to cover every path.
- A route may alternatively resolve to an escalation message.

### B5. Exercise narrowing — `suits_sex`, `suits_age_bands` on `exercises.csv`
- **Leave empty unless you deliberately want to narrow an exercise.** Empty = shown to everyone.
- Filtering can only **hide**. The app will never substitute, adapt dosage, or invent an
  age-appropriate variant. If your filters empty an area, the patient sees the unfiltered set with
  a neutral note rather than an empty screen.

### B6. Age bands — confirm or replace
Suggested starting bands, for you to confirm or change: `teen (13–17)`, `adult (18–49)`,
`older adult (50–69)`, `senior (70+)`. Whatever you choose becomes the fixed vocabulary for
`suits_age_bands`.

### B7. Region synonyms — `region_synonyms.csv`
Patient vocabulary that should find a region in search: "lower back", "small of my back", "shin",
"shoulder blade", plus Arabic terms and common transliterations.
- **Condition names are automatically rejected** by the build's compliance scan (e.g. a term like
  "sciatica" will fail the build, by design). Synonyms are anatomy in patient words, nothing else.
- One term per row, so a single rejected term never invalidates the rest of your set.

### B8. Compliance term list — `content/compliance/condition-terms.csv`
The 36 condition-name rules referenced in the brief are **not in this repository**. The scanner is
build-side; the term list is yours/compliance's. Until it arrives, the scan is a stub that passes
everything — so this is a real gap, not a formality.

### B9. Publishing existing content
The exercise library is currently drafted and unsigned. Until rows are `published` with
`reviewed_by` and `reviewed_on` filled, **the guided flow has nothing to show**. This is the single
largest content dependency.

### B10. Animation sign-off (P2 only)
Every clip is reviewed individually: you confirm *that specific clip* demonstrates *that specific
movement* correctly. Text approval does not carry over to motion. Sign-off is recorded per media row.

---

## C. What the build side guarantees in return

- The app **never** diagnoses, scores, ranks or infers. It looks up your table and renders the row.
- One render gate for both browsing and the guided flow — there is no code path that can show
  unreviewed content, and CI fails if one is introduced.
- No condition name can reach a patient through questions, answers, synonyms, escalation copy or
  exercise text, once the term list exists.
- Patient selections (sex, age band, progress ticks) stay on the device in `localStorage`. No
  accounts, no analytics, no transmission — there is no backend, and the plan keeps it that way.
- You can add a question, change a route, or narrow an exercise **entirely from the sheet**, with no
  code change and no developer involvement.
- Anything you submit enters as `status: draft`, `reviewed_by: ""`, and stays invisible until you
  sign it.

---

## D. Open questions needing your answer

| # | Question | Owner |
|---|---|---|
| 1 | D8 classification + disclaimer wording (**blocking**) | Medical Director |
| 2 | Guided flow as default entry point, or a labelled choice alongside browsing? | Clinician + MD |
| 3 | Confirm or replace the four age bands | Clinician |
| 4 | Maximum questions before it feels like an interrogation (build recommends 2–3) | Clinician |
| 5 | Should the printable handout include the patient's answers, or exercises only? | Clinician |
| 6 | Animation house style — figure appearance, camera angles, clip length — agreed once, up front | Clinician + build |
| 7 | Confirm the region → body-area grouping (B1) | Clinician |
| 8 | Is the "female" figure — currently a reshape of a male reference scan, not a female scan — acceptable to present as a female body form? | Clinician |
