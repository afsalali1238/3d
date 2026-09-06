# Authoring guide — the six sheets

**You own everything in this folder.** The app renders exactly what you write here, in your words.
It never rewrites, summarises, adapts, or invents content. If a sheet says nothing, the app shows
nothing.

You need Excel, Numbers, or Google Sheets. Nothing else.

---

## How it works

```
   You edit a sheet  →  npm run content:check  →  npm run content:build  →  the app changes
                             ↑
                    tells you, in plain English,
                    exactly what is wrong and where
```

You never touch code. If `content:check` says the content is valid, it is safe to publish.

---

## The golden rules

1. **Nothing appears to a patient until you sign it.** Set `status` to `published` **and** put your
   name in `reviewed_by`. Either one alone does nothing. This is deliberate — it means you cannot
   publish by accident.
2. **Never name a condition.** No diagnoses, no syndromes, no "sciatica", "frozen shoulder",
   "arthritis". Describe **where** it is and **how it moves**. The check will reject condition names
   automatically, in English and Arabic. This is not a limitation — it is what keeps the app an
   exercise guide rather than a symptom-checker.
3. **Empty means "everyone".** `suits_sex` and `suits_age_bands` left blank = shown to all patients.
   Only fill them in when you deliberately want to *narrow* an exercise. Filters can only ever hide;
   they never substitute or invent an alternative.
4. **Red-flag answers must never lead to exercises.** Mark them `red_flag = yes` and point them at
   an escalation message. The check enforces this and will refuse to build if it is violated.
5. **Ids are permanent.** Once `lb_ex_pelvic_tilt` exists, don't rename it — other sheets point at
   it. Lowercase letters, numbers and underscores only.
6. **Separate lists with `|`** (the pipe character), never commas.

---

## The six sheets

### 1. `body_areas.csv` — where the 3D model sends patients

The figure has 81 fine-grained regions; your library is organised more coarsely. This sheet groups
them.

| Column | What to put |
|---|---|
| `body_area` | id, e.g. `lower_back` |
| `label_en` / `label_ar` | what patients see |
| `region_ids` | the 3D regions that land here, separated by `\|` |

A region can only belong to one area. Unknown region names are rejected with a spelling hint.

### 2. `questions.csv` — what you ask

| Column | What to put |
|---|---|
| `question_id` | id, e.g. `lb_q1` |
| `body_area` | which area this question belongs to |
| `key` | short token used by routing, e.g. `movement`, `timing` |
| `prompt_en` / `prompt_ar` | the question, in your words |
| `hint_en` / `hint_ar` | optional clarifier under the question |
| `order` | 1, 2, 3 … |
| `skippable` | `yes` or `no` |
| `status`, `reviewed_by`, `reviewed_on` | the gate |

Ask about **movement and timing**. Not severity, not sharp-vs-dull, not conditions.
Two or three questions per area is the recommendation — more starts to feel like an interrogation.

### 3. `answer_options.csv` — the possible answers

One row per answer. Every question needs at least two.

| Column | What to put |
|---|---|
| `option_id` | id |
| `question_id` | which question this belongs to |
| `key` | short token used by routing, e.g. `overhead`, `mornings` |
| `label_en` / `label_ar` | what patients see |
| `red_flag` | `yes` if this answer must **stop** the flow |
| `escalation_message_id` | required when `red_flag = yes` |

### 4. `escalation_messages.csv` — your stop-and-see-someone wording

| Column | What to put |
|---|---|
| `message_id` | id |
| `title_en` / `title_ar`, `body_en` / `body_ar` | your wording, shown instead of any exercise |
| `cta` | `contact`, `urgent`, or `none` |
| `status`, `reviewed_by`, `reviewed_on` | the gate |

### 5. `exercises.csv` — the library

| Column | What to put |
|---|---|
| `exercise_id` | id |
| `body_area` | which area |
| `name_en` / `name_ar` | exercise name |
| `purpose_en` / `purpose_ar` | what it's for, in your words |
| `steps_en` / `steps_ar` | each step separated by `\|` — **the two languages must have the same number of steps** |
| `dosage_en` / `dosage_ar` | sets / reps / hold / frequency, verbatim |
| `safety_en` / `safety_ar` | your stop line |
| `suits_sex` | `male`, `female`, or **empty for everyone** |
| `suits_age_bands` | any of `teen`, `adult`, `older_adult`, `senior` separated by `\|`, or **empty for everyone** |
| `status`, `reviewed_by`, `reviewed_on` | the gate |

### 6. `routes.csv` — which answers lead to which exercises

This is the decision tree. One row = one combination of answers.

| Column | What to put |
|---|---|
| `route_id` | id |
| `body_area` | which area |
| `answer_path` | e.g. `movement=bending_forward&timing=mornings` — uses the `key` values |
| `outcome` | `exercises` or `escalate` |
| `exercise_ids` | the exercises to show, separated by `\|`, **in the order you want them seen** |
| `escalation_message_id` | when `outcome = escalate` |
| `status`, `reviewed_by`, `reviewed_on` | the gate |

**You do not have to cover every combination.** Anything you don't write a route for falls back to
"here is everything published for this area", plus an offer to contact the clinic. That is a safe,
intended state. Write routes only where you want to be specific.

The app matches **exactly**. It will never guess a "close enough" route.

---

## Commands

```bash
npm run content:check    # validate — tells you what's wrong, changes nothing
npm run content:build    # validate, then apply to the app
npm run content:export   # regenerate the sheets from what's currently in the app
```

Run `content:check` as often as you like; it is read-only and safe.

---

## Reading an error

```
exercises.csv
  ✖ line 4, column "suits_age_bands": unknown age band "elderly"
      → Use one or more of: teen, adult, older_adult, senior (separated by |). Leave empty for everyone.
```

File, line, column, what's wrong, what to do. Warnings (⚠) are advisory and don't block. Errors (✖)
stop the build — content with errors never reaches a patient.

---

## The current content is a placeholder

Everything shipped today is signed `PLACEHOLDER`. The `questions.csv`, `red_flags.csv` and
`precautions.csv` rows are currently `draft`, so the patient journey intentionally goes
straight from intake to the body map to published exercises. Replace the placeholder rows with
your own and put your name in `reviewed_by` to bring the more detailed questions back.
