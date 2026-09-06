/**
 * Content validation — CSV rows in, a typed ContentBundle out.
 *
 * DESIGN PRIORITY: the error messages. A physiotherapist with a spreadsheet
 * is the user of this module. Every failure names the file, the line, the
 * column, what was wrong, and what to do about it. No stack traces, no
 * "expected string, received undefined".
 *
 * Validation is build-blocking by design. Bad content does not ship in a
 * degraded state — it does not ship.
 */
import { parseCsv, type CsvRow, type CsvTable } from './csv';
import { scanText } from './compliance';
import { normaliseAnswerPath } from './routing';
import { REGIONS } from '../components/body/regions.gen';
import type {
  AgeBand,
  AnswerOption,
  BodyArea,
  ContentBundle,
  EscalationMessage,
  Exercise,
  I18nText,
  Precaution,
  PrecautionAction,
  Question,
  RedFlag,
  Route,
  Sex,
  Threshold,
  ThresholdKey,
} from './types';

export type Issue = {
  severity: 'error' | 'warning';
  file: string;
  line: number;
  column?: string;
  message: string;
  /** what the author should do */
  fix?: string;
};

const AGE_BANDS: AgeBand[] = ['teen', 'adult', 'older_adult', 'senior'];
const SEXES: Sex[] = ['male', 'female'];

/* ------------------------------------------------------------- utilities */

class Ctx {
  issues: Issue[] = [];
  constructor(readonly file: string) {}

  err(line: number, message: string, column?: string, fix?: string) {
    this.issues.push({ severity: 'error', file: this.file, line, column, message, fix });
  }
  warn(line: number, message: string, column?: string, fix?: string) {
    this.issues.push({ severity: 'warning', file: this.file, line, column, message, fix });
  }

  /** required non-empty cell */
  req(row: CsvRow, col: string): string {
    const v = row.cells[col];
    if (v === undefined) {
      this.err(row.line, `missing column "${col}"`, col, `Add a "${col}" column to the sheet.`);
      return '';
    }
    if (v === '') {
      this.err(row.line, `"${col}" is empty but is required`, col);
      return '';
    }
    return v;
  }

  opt(row: CsvRow, col: string): string {
    return row.cells[col] ?? '';
  }

  /** required bilingual pair: `${col}_en` / `${col}_ar` */
  i18n(row: CsvRow, col: string, arRequired = true): I18nText {
    const en = this.req(row, `${col}_en`);
    const ar = this.opt(row, `${col}_ar`);
    if (arRequired && !ar) {
      this.warn(
        row.line,
        `"${col}_ar" is empty — Arabic patients will see the English text`,
        `${col}_ar`,
        'Add the Arabic translation, or leave it blank knowingly.',
      );
    }
    return { en, ar: ar || en };
  }

  slug(row: CsvRow, col: string): string {
    const v = this.req(row, col);
    if (v && !/^[a-z0-9_]+$/.test(v)) {
      this.err(
        row.line,
        `"${col}" must be lowercase letters, numbers and underscores only (got "${v}")`,
        col,
        'e.g. lower_back, lb_ex_pelvic_tilt',
      );
    }
    return v;
  }

  bool(row: CsvRow, col: string, dflt = false): boolean {
    const v = this.opt(row, col).toLowerCase();
    if (v === '') return dflt;
    if (['true', 'yes', 'y', '1'].includes(v)) return true;
    if (['false', 'no', 'n', '0'].includes(v)) return false;
    this.err(row.line, `"${col}" must be yes or no (got "${v}")`, col);
    return dflt;
  }

  int(row: CsvRow, col: string, dflt = 0): number {
    const v = this.opt(row, col);
    if (v === '') return dflt;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      this.err(row.line, `"${col}" must be a number (got "${v}")`, col);
      return dflt;
    }
    return n;
  }

  list(row: CsvRow, col: string): string[] {
    return this.opt(row, col)
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** the publication gate, validated */
  reviewed(row: CsvRow): { status: 'draft' | 'published'; reviewedBy: string; reviewedOn: string } {
    const raw = (this.opt(row, 'status') || 'draft').toLowerCase();
    if (!['draft', 'published'].includes(raw)) {
      this.err(row.line, `"status" must be draft or published (got "${raw}")`, 'status');
    }
    const status = raw === 'published' ? 'published' : 'draft';
    const reviewedBy = this.opt(row, 'reviewed_by');
    const reviewedOn = this.opt(row, 'reviewed_on');

    if (status === 'published' && !reviewedBy) {
      this.err(
        row.line,
        'this row is marked published but "reviewed_by" is empty',
        'reviewed_by',
        'Put your name in reviewed_by to sign it off, or set status back to draft.',
      );
    }
    if (status === 'published' && reviewedOn && !/^\d{4}-\d{2}-\d{2}$/.test(reviewedOn)) {
      this.err(row.line, `"reviewed_on" must look like 2026-09-06 (got "${reviewedOn}")`, 'reviewed_on');
    }
    return { status, reviewedBy, reviewedOn };
  }

  /** condition-name / advertising-claim scan on patient-visible text */
  clean(row: CsvRow, col: string, text: string) {
    for (const hit of scanText(`${this.file}:${row.line}`, text)) {
      this.err(
        row.line,
        `"${col}" contains "${hit.matchedTerm}" (${hit.note}), which cannot appear in patient-facing text`,
        col,
        'Describe where it is and how it moves, not what it might be.',
      );
    }
  }

  dupes(rows: Array<{ id: string; line: number }>, what: string) {
    const seen = new Map<string, number>();
    for (const r of rows) {
      if (!r.id) continue;
      const prev = seen.get(r.id);
      if (prev !== undefined) {
        this.err(r.line, `duplicate ${what} id "${r.id}" (already used on line ${prev})`, 'id');
      } else seen.set(r.id, r.line);
    }
  }
}

/* --------------------------------------------------------------- parsers */

function parseBodyAreas(t: CsvTable, ctx: Ctx): BodyArea[] {
  const validRegions = new Set(REGIONS.map((r) => r.id));
  const out = t.rows.map((row) => {
    const id = ctx.slug(row, 'body_area');
    const label = ctx.i18n(row, 'label');
    ctx.clean(row, 'label_en', label.en);
    const regionIds = ctx.list(row, 'region_ids');
    if (regionIds.length === 0) {
      ctx.err(row.line, `body area "${id}" has no region_ids`, 'region_ids',
        'List the 3D regions that should land here, separated by | ');
    }
    for (const r of regionIds) {
      if (!validRegions.has(r)) {
        ctx.err(row.line, `region "${r}" does not exist on the 3D model`, 'region_ids',
          'Check the spelling against the region list in the app.');
      }
    }
    return { id, label, regionIds, __line: row.line } as BodyArea & { __line: number };
  });
  ctx.dupes(out.map((a) => ({ id: a.id, line: a.__line })), 'body_area');

  // a region may only belong to one area, or selection is ambiguous
  const owner = new Map<string, string>();
  for (const a of out) {
    for (const r of a.regionIds) {
      const prev = owner.get(r);
      if (prev && prev !== a.id) {
        ctx.err(a.__line, `region "${r}" is claimed by both "${prev}" and "${a.id}"`, 'region_ids',
          'Each region can belong to only one body area.');
      }
      owner.set(r, a.id);
    }
  }
  return out.map(({ __line, ...a }) => a);
}

function parseQuestions(qt: CsvTable, ot: CsvTable, ctx: Ctx, optCtx: Ctx): Question[] {
  // options first, grouped by question
  const byQuestion = new Map<string, AnswerOption[]>();
  const optLines = new Map<string, number>();
  for (const row of ot.rows) {
    const id = optCtx.slug(row, 'option_id');
    const qid = optCtx.req(row, 'question_id');
    const key = optCtx.slug(row, 'key');
    const label = optCtx.i18n(row, 'label');
    optCtx.clean(row, 'label_en', label.en);
    optCtx.clean(row, 'label_ar', label.ar);
    const redFlag = optCtx.bool(row, 'red_flag');
    const escalationId = optCtx.opt(row, 'escalation_message_id');
    if (redFlag && !escalationId) {
      optCtx.err(row.line,
        `"${id}" is marked as a red flag but has no escalation_message_id`,
        'escalation_message_id',
        'A red-flag answer must lead to a stop-and-see-someone message.');
    }
    if (!redFlag && escalationId) {
      optCtx.warn(row.line,
        `"${id}" has an escalation message but is not marked red_flag — the message will never show`,
        'red_flag');
    }
    optLines.set(id, row.line);
    const list = byQuestion.get(qid) ?? [];
    list.push({ id, key, label, ...(redFlag ? { redFlag } : {}), ...(escalationId ? { escalationId } : {}) });
    byQuestion.set(qid, list);
  }
  optCtx.dupes([...optLines].map(([id, line]) => ({ id, line })), 'option_id');

  const out = qt.rows.map((row) => {
    const id = ctx.slug(row, 'question_id');
    const bodyArea = ctx.req(row, 'body_area');
    const key = ctx.slug(row, 'key');
    const prompt = ctx.i18n(row, 'prompt');
    ctx.clean(row, 'prompt_en', prompt.en);
    ctx.clean(row, 'prompt_ar', prompt.ar);
    const hintEn = ctx.opt(row, 'hint_en');
    const options = byQuestion.get(id) ?? [];

    if (options.length === 0) {
      ctx.err(row.line, `question "${id}" has no answer options`, 'question_id',
        `Add rows to answer_options.csv with question_id = ${id}`);
    } else if (options.length === 1) {
      ctx.warn(row.line, `question "${id}" has only one answer option`, 'question_id');
    }

    const keys = options.map((o) => o.key);
    const dupeKeys = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupeKeys.length) {
      ctx.err(row.line, `question "${id}" has duplicate option keys: ${[...new Set(dupeKeys)].join(', ')}`);
    }

    return {
      id,
      bodyArea,
      key,
      prompt,
      ...(hintEn ? { hint: ctx.i18n(row, 'hint', false) } : {}),
      options,
      order: ctx.int(row, 'order', 1),
      skippable: ctx.bool(row, 'skippable', true),
      ...ctx.reviewed(row),
      __line: row.line,
    } as Question & { __line: number };
  });

  ctx.dupes(out.map((q) => ({ id: q.id, line: q.__line })), 'question_id');

  // question keys must be unique within a body area, or answer paths collide
  const perArea = new Map<string, Map<string, string>>();
  for (const q of out) {
    const m = perArea.get(q.bodyArea) ?? new Map();
    const prev = m.get(q.key);
    if (prev) {
      ctx.err(q.__line,
        `two questions in "${q.bodyArea}" both use key "${q.key}" ("${prev}" and "${q.id}")`,
        'key',
        'Each question needs its own key — it is what routing rows refer to.');
    }
    m.set(q.key, q.id);
    perArea.set(q.bodyArea, m);
  }

  return out.map(({ __line, ...q }) => q);
}

function parseEscalations(t: CsvTable, ctx: Ctx): EscalationMessage[] {
  const out = t.rows.map((row) => {
    const id = ctx.slug(row, 'message_id');
    const title = ctx.i18n(row, 'title');
    const body = ctx.i18n(row, 'body');
    ctx.clean(row, 'title_en', title.en);
    ctx.clean(row, 'body_en', body.en);
    ctx.clean(row, 'body_ar', body.ar);
    const ctaRaw = (ctx.opt(row, 'cta') || 'contact').toLowerCase();
    if (!['contact', 'urgent', 'none'].includes(ctaRaw)) {
      ctx.err(row.line, `"cta" must be contact, urgent or none (got "${ctaRaw}")`, 'cta');
    }
    return {
      id,
      title,
      body,
      cta: (['contact', 'urgent', 'none'].includes(ctaRaw) ? ctaRaw : 'contact') as EscalationMessage['cta'],
      ...ctx.reviewed(row),
      __line: row.line,
    } as EscalationMessage & { __line: number };
  });
  ctx.dupes(out.map((e) => ({ id: e.id, line: e.__line })), 'message_id');
  return out.map(({ __line, ...e }) => e);
}

function parseExercises(t: CsvTable, ctx: Ctx): Exercise[] {
  const out = t.rows.map((row) => {
    const id = ctx.slug(row, 'exercise_id');
    const bodyArea = ctx.req(row, 'body_area');
    const name = ctx.i18n(row, 'name');
    const purpose = ctx.i18n(row, 'purpose');
    const dosage = ctx.i18n(row, 'dosage');
    const safety = ctx.i18n(row, 'safety');
    for (const [c, v] of [['name_en', name.en], ['purpose_en', purpose.en], ['safety_en', safety.en]] as const) {
      ctx.clean(row, c, v);
    }

    // steps: steps_en is a numbered list separated by |
    const stepsEn = ctx.list(row, 'steps_en');
    const stepsAr = ctx.list(row, 'steps_ar');
    if (stepsEn.length === 0) {
      ctx.err(row.line, `exercise "${id}" has no steps`, 'steps_en',
        'Write each step separated by a | character.');
    }
    if (stepsAr.length && stepsAr.length !== stepsEn.length) {
      ctx.err(row.line,
        `"${id}" has ${stepsEn.length} English steps but ${stepsAr.length} Arabic steps`,
        'steps_ar',
        'The two lists must line up one-to-one.');
    }
    const steps: I18nText[] = stepsEn.map((en, i) => ({ en, ar: stepsAr[i] ?? en }));
    for (const s of steps) ctx.clean(row, 'steps_en', s.en);

    const irrRaw = ctx.opt(row, 'irritability_max').toLowerCase();
    const IRR = ['quick', 'hours', 'day'] as const;
    if (irrRaw && !IRR.includes(irrRaw as (typeof IRR)[number])) {
      ctx.err(row.line, `"irritability_max" must be quick, hours, day, or empty (got "${irrRaw}")`, 'irritability_max');
    }
    const precautionTags = ctx.list(row, 'precaution_tags');

    const suitsSexRaw = ctx.opt(row, 'suits_sex').toLowerCase();
    if (suitsSexRaw && !SEXES.includes(suitsSexRaw as Sex)) {
      ctx.err(row.line, `"suits_sex" must be male, female, or empty (got "${suitsSexRaw}")`, 'suits_sex',
        'Leave it empty to show this exercise to everyone.');
    }
    const bands = ctx.list(row, 'suits_age_bands');
    for (const b of bands) {
      if (!AGE_BANDS.includes(b as AgeBand)) {
        ctx.err(row.line, `unknown age band "${b}"`, 'suits_age_bands',
          `Use one or more of: ${AGE_BANDS.join(', ')} (separated by |). Leave empty for everyone.`);
      }
    }

    return {
      id,
      bodyArea,
      name,
      purpose,
      dosage,
      safety,
      steps,
      ...(SEXES.includes(suitsSexRaw as Sex) ? { suitsSex: suitsSexRaw as Sex } : {}),
      ...(bands.length ? { suitsAgeBands: bands.filter((b) => AGE_BANDS.includes(b as AgeBand)) as AgeBand[] } : {}),
      ...(precautionTags.length ? { precautionTags } : {}),
      ...(IRR.includes(irrRaw as (typeof IRR)[number]) ? { irritabilityMax: irrRaw as (typeof IRR)[number] } : {}),
      ...ctx.reviewed(row),
      __line: row.line,
    } as Exercise & { __line: number };
  });
  ctx.dupes(out.map((e) => ({ id: e.id, line: e.__line })), 'exercise_id');
  return out.map(({ __line, ...e }) => e);
}

function parseRoutes(t: CsvTable, ctx: Ctx): Route[] {
  const out = t.rows.map((row) => {
    const id = ctx.slug(row, 'route_id');
    const bodyArea = ctx.req(row, 'body_area');
    const rawPath = ctx.req(row, 'answer_path');

    // canonicalise so authoring order/spacing can never make a row unreachable
    let answerPath = '';
    if (rawPath) {
      const pairs: Record<string, string> = {};
      let malformed = false;
      for (const part of rawPath.split('&')) {
        const [k, v] = part.split('=').map((s) => s?.trim());
        if (!k || !v) {
          malformed = true;
          break;
        }
        pairs[k] = v;
      }
      if (malformed) {
        ctx.err(row.line,
          `"answer_path" is malformed: "${rawPath}"`,
          'answer_path',
          'It should look like  movement=overhead&timing=mornings');
      } else {
        answerPath = normaliseAnswerPath(pairs);
      }
    }

    const outcomeRaw = (ctx.opt(row, 'outcome') || 'exercises').toLowerCase();
    const exerciseIds = ctx.list(row, 'exercise_ids');
    const escalationId = ctx.opt(row, 'escalation_message_id');

    if (outcomeRaw === 'escalate') {
      if (!escalationId) {
        ctx.err(row.line, `route "${id}" escalates but has no escalation_message_id`, 'escalation_message_id');
      }
      return { id, bodyArea, answerPath, outcome: 'escalate' as const, escalationId, ...ctx.reviewed(row), __line: row.line };
    }

    if (outcomeRaw !== 'exercises') {
      ctx.err(row.line, `"outcome" must be exercises or escalate (got "${outcomeRaw}")`, 'outcome');
    }
    if (exerciseIds.length === 0) {
      ctx.err(row.line, `route "${id}" lists no exercise_ids`, 'exercise_ids',
        'List the exercise ids separated by | , in the order the patient should see them.');
    }
    return { id, bodyArea, answerPath, outcome: 'exercises' as const, exerciseIds, ...ctx.reviewed(row), __line: row.line };
  });

  ctx.dupes(out.map((r) => ({ id: r.id, line: r.__line })), 'route_id');

  // two routes for the same path in the same area = ambiguous, first wins silently
  const seen = new Map<string, string>();
  for (const r of out) {
    const k = `${r.bodyArea}::${r.answerPath}`;
    const prev = seen.get(k);
    if (prev) {
      ctx.err(r.__line,
        `route "${r.id}" duplicates the answer path of "${prev}" for body area "${r.bodyArea}"`,
        'answer_path',
        'Two rows cannot answer the same combination — delete or change one.');
    }
    seen.set(k, r.id);
  }

  return out.map(({ __line, ...r }) => r as Route);
}

const THRESHOLD_KEYS: ThresholdKey[] = [
  'nrs_referral',
  'amber_window_hours',
  'rising_sessions_n',
  'review_weeks',
  'reminder_days',
];

function parseRedFlags(t: CsvTable, ctx: Ctx): RedFlag[] {
  const out = t.rows.map((row) => {
    const id = ctx.slug(row, 'flag_id');
    const prompt = ctx.i18n(row, 'prompt');
    ctx.clean(row, 'prompt_en', prompt.en);
    ctx.clean(row, 'prompt_ar', prompt.ar);
    const positiveKey = ctx.slug(row, 'positive_key');
    const messageId = ctx.req(row, 'message_id');
    return {
      id,
      prompt,
      positiveKey,
      messageId,
      order: ctx.int(row, 'order', 1),
      ...ctx.reviewed(row),
      __line: row.line,
    } as RedFlag & { __line: number };
  });
  ctx.dupes(out.map((r) => ({ id: r.id, line: r.__line })), 'flag_id');
  return out.map(({ __line, ...r }) => r);
}

function parsePrecautions(t: CsvTable, ctx: Ctx): Precaution[] {
  const ACTIONS: PrecautionAction[] = ['hide', 'warn', 'stop_and_refer'];
  const out = t.rows.map((row) => {
    const conditionKey = ctx.slug(row, 'condition_key');
    const label = ctx.i18n(row, 'label');
    ctx.clean(row, 'label_en', label.en);
    ctx.clean(row, 'label_ar', label.ar);
    const actionRaw = (ctx.opt(row, 'action') || 'warn').toLowerCase();
    if (!ACTIONS.includes(actionRaw as PrecautionAction)) {
      ctx.err(row.line, `"action" must be hide, warn, or stop_and_refer (got "${actionRaw}")`, 'action');
    }
    const messageId = ctx.req(row, 'message_id');
    return {
      conditionKey,
      label,
      restrictsTags: ctx.list(row, 'restricts_tags'),
      restrictsIds: ctx.list(row, 'restricts_ids'),
      action: (ACTIONS.includes(actionRaw as PrecautionAction) ? actionRaw : 'warn') as PrecautionAction,
      messageId,
      ...ctx.reviewed(row),
      __line: row.line,
    } as Precaution & { __line: number };
  });
  ctx.dupes(out.map((r) => ({ id: r.conditionKey, line: r.__line })), 'condition_key');
  return out.map(({ __line, ...r }) => r);
}

function parseThresholds(t: CsvTable, ctx: Ctx): Threshold[] {
  const out = t.rows.map((row) => {
    const key = ctx.slug(row, 'key') as ThresholdKey;
    if (!THRESHOLD_KEYS.includes(key)) {
      ctx.err(row.line, `unknown threshold key "${key}"`, 'key', `Use one of: ${THRESHOLD_KEYS.join(', ')}`);
    }
    const value = ctx.int(row, 'value', NaN);
    if (!Number.isFinite(value)) {
      ctx.err(row.line, `"value" must be a number`, 'value');
    }
    return { key, value, ...ctx.reviewed(row), __line: row.line } as Threshold & { __line: number };
  });
  return out.map(({ __line, ...r }) => r);
}

/* ---------------------------------------------------- cross-table checks */

function crossCheck(b: ContentBundle, issues: Issue[]) {
  const areas = new Set(b.bodyAreas.map((a) => a.id));
  const exIds = new Set(b.exercises.map((e) => e.id));
  const escIds = new Set(b.escalations.map((e) => e.id));
  const push = (file: string, message: string, fix?: string) =>
    issues.push({ severity: 'error', file, line: 0, message, fix });
  const warn = (file: string, message: string, fix?: string) =>
    issues.push({ severity: 'warning', file, line: 0, message, fix });

  for (const q of b.questions) {
    if (q.bodyArea !== 'global' && !areas.has(q.bodyArea)) {
      push('questions.csv', `question "${q.id}" refers to unknown body_area "${q.bodyArea}"`,
        'Add it to body_areas.csv or fix the spelling.');
    }
    for (const o of q.options) {
      if (o.escalationId && !escIds.has(o.escalationId)) {
        push('answer_options.csv', `option "${o.id}" refers to unknown escalation "${o.escalationId}"`);
      }
    }
  }

  for (const e of b.exercises) {
    if (!areas.has(e.bodyArea)) {
      push('exercises.csv', `exercise "${e.id}" refers to unknown body_area "${e.bodyArea}"`);
    }
  }

  const redPaths = new Set<string>();
  for (const q of b.questions) {
    for (const o of q.options) if (o.redFlag) redPaths.add(`${q.key}=${o.key}`);
  }

  for (const r of b.routes) {
    if (!areas.has(r.bodyArea)) {
      push('routes.csv', `route "${r.id}" refers to unknown body_area "${r.bodyArea}"`);
    }
    if (r.outcome === 'exercises') {
      for (const id of r.exerciseIds) {
        if (!exIds.has(id)) {
          push('routes.csv', `route "${r.id}" refers to unknown exercise "${id}"`,
            'Check the exercise_id against exercises.csv.');
        }
      }
      // SAFETY: a red-flag answer must never route to exercises
      for (const rp of redPaths) {
        if (r.answerPath.split('&').includes(rp)) {
          push('routes.csv',
            `route "${r.id}" sends the red-flag answer "${rp}" to exercises`,
            'Red-flag answers must always escalate. Remove this route.');
        }
      }
    } else if (!escIds.has(r.escalationId)) {
      push('routes.csv', `route "${r.id}" refers to unknown escalation "${r.escalationId}"`);
    }

    // every key in the path must be a real question key in that area
    const areaKeys = new Set(b.questions.filter((q) => q.bodyArea === r.bodyArea).map((q) => q.key));
    for (const part of r.answerPath.split('&').filter(Boolean)) {
      const [k, v] = part.split('=');
      if (!areaKeys.has(k)) {
        push('routes.csv',
          `route "${r.id}" uses question key "${k}", which no question in "${r.bodyArea}" has`,
          `Known keys here: ${[...areaKeys].join(', ') || '(none)'}`);
        continue;
      }
      const q = b.questions.find((qq) => qq.bodyArea === r.bodyArea && qq.key === k)!;
      if (!q.options.some((o) => o.key === v)) {
        push('routes.csv',
          `route "${r.id}" uses answer "${v}" for "${k}", which is not one of its options`,
          `Valid answers: ${q.options.map((o) => o.key).join(', ')}`);
      }
    }
  }

  // non-blocking coverage report
  for (const a of b.bodyAreas) {
    const published = b.exercises.filter(
      (e) => e.bodyArea === a.id && e.status === 'published' && e.reviewedBy,
    );
    if (published.length === 0) {
      warn('exercises.csv', `body area "${a.id}" has no published exercises — patients will reach a dead end`,
        'Publish at least one exercise, or remove the area until it is ready.');
    }
    const qs = b.questions.filter((q) => q.bodyArea === a.id && q.status === 'published');
    if (published.length > 0 && qs.length === 0) {
      warn('questions.csv', `body area "${a.id}" has exercises but no questions — patients will see the whole list`);
    }
  }
}

/* ----------------------------------------------------------------- entry */

export type ValidationResult = {
  bundle: ContentBundle;
  issues: Issue[];
  ok: boolean;
};

export type SourceFiles = {
  'body_areas.csv': string;
  'questions.csv': string;
  'answer_options.csv': string;
  'escalation_messages.csv': string;
  'exercises.csv': string;
  'routes.csv': string;
  'red_flags.csv': string;
  'precautions.csv': string;
  'thresholds.csv': string;
};

export function validateContent(files: SourceFiles): ValidationResult {
  const issues: Issue[] = [];
  const table = (name: keyof SourceFiles): CsvTable => {
    try {
      return parseCsv(name, files[name]);
    } catch (e: any) {
      issues.push({
        severity: 'error',
        file: name,
        line: e.line ?? 0,
        message: e.message,
        fix: 'Fix the row in the spreadsheet and export again.',
      });
      return { headers: [], rows: [] };
    }
  };

  const ctxs: Record<string, Ctx> = {};
  const c = (name: string) => (ctxs[name] ??= new Ctx(name));

  const bodyAreas = parseBodyAreas(table('body_areas.csv'), c('body_areas.csv'));
  const escalations = parseEscalations(table('escalation_messages.csv'), c('escalation_messages.csv'));
  const questions = parseQuestions(
    table('questions.csv'),
    table('answer_options.csv'),
    c('questions.csv'),
    c('answer_options.csv'),
  );
  const exercises = parseExercises(table('exercises.csv'), c('exercises.csv'));
  const routes = parseRoutes(table('routes.csv'), c('routes.csv'));
  const redFlags = parseRedFlags(table('red_flags.csv'), c('red_flags.csv'));
  const precautions = parsePrecautions(table('precautions.csv'), c('precautions.csv'));
  const thresholds = parseThresholds(table('thresholds.csv'), c('thresholds.csv'));

  for (const ctx of Object.values(ctxs)) issues.push(...ctx.issues);

  const bundle: ContentBundle = {
    bodyAreas,
    questions,
    routes,
    exercises,
    escalations,
    redFlags,
    precautions,
    thresholds,
  };
  crossCheck(bundle, issues);

  return { bundle, issues, ok: !issues.some((i) => i.severity === 'error') };
}

/** Human-readable report, grouped by file. */
export function formatIssues(issues: Issue[]): string {
  if (issues.length === 0) return '✅ content: no problems found';

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const lines: string[] = [];

  const byFile = new Map<string, Issue[]>();
  for (const i of issues) byFile.set(i.file, [...(byFile.get(i.file) ?? []), i]);

  for (const [file, list] of byFile) {
    lines.push(`\n${file}`);
    for (const i of list.sort((a, b) => a.line - b.line)) {
      const where = i.line > 0 ? `line ${i.line}` : 'file';
      const col = i.column ? `, column "${i.column}"` : '';
      lines.push(`  ${i.severity === 'error' ? '✖' : '⚠'} ${where}${col}: ${i.message}`);
      if (i.fix) lines.push(`      → ${i.fix}`);
    }
  }

  lines.push('');
  lines.push(`${errors.length} error(s), ${warnings.length} warning(s)`);
  if (errors.length) lines.push('Content with errors will not be published.');
  return lines.join('\n');
}
