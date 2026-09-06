/**
 * Export the current placeholder bundle to CSV.
 *
 * Purpose: give the clinician sheets that already contain a WORKING example
 * (a filled-in row is worth ten pages of column documentation), which she can
 * then overwrite with her own content.
 *
 * Run: npm run content:export
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { toCsv } from '../src/content/csv';
import { placeholderContent as C } from '../src/content/placeholder';

const DIR = 'content';
mkdirSync(DIR, { recursive: true });

const write = (name: string, headers: string[], rows: Array<Record<string, string>>) => {
  writeFileSync(`${DIR}/${name}`, toCsv(headers, rows), 'utf8');
  console.log(`  ${name.padEnd(26)} ${rows.length} row(s)`);
};

const rev = (r: { status: string; reviewedBy: string; reviewedOn: string }) => ({
  status: r.status,
  reviewed_by: r.reviewedBy,
  reviewed_on: r.reviewedOn,
});

console.log('Exporting content to CSV:');

write('body_areas.csv', ['body_area', 'label_en', 'label_ar', 'region_ids'],
  C.bodyAreas.map((a) => ({
    body_area: a.id,
    label_en: a.label.en,
    label_ar: a.label.ar,
    region_ids: a.regionIds.join('|'),
  })));

write('questions.csv',
  ['question_id', 'body_area', 'key', 'prompt_en', 'prompt_ar', 'hint_en', 'hint_ar', 'order', 'skippable', 'status', 'reviewed_by', 'reviewed_on'],
  C.questions.map((q) => ({
    question_id: q.id,
    body_area: q.bodyArea,
    key: q.key,
    prompt_en: q.prompt.en,
    prompt_ar: q.prompt.ar,
    hint_en: q.hint?.en ?? '',
    hint_ar: q.hint?.ar ?? '',
    order: String(q.order),
    skippable: q.skippable ? 'yes' : 'no',
    ...rev(q),
  })));

write('answer_options.csv',
  ['option_id', 'question_id', 'key', 'label_en', 'label_ar', 'order', 'red_flag', 'escalation_message_id'],
  C.questions.flatMap((q) =>
    q.options.map((o, i) => ({
      option_id: o.id,
      question_id: q.id,
      key: o.key,
      label_en: o.label.en,
      label_ar: o.label.ar,
      order: String(i + 1),
      red_flag: o.redFlag ? 'yes' : 'no',
      escalation_message_id: o.escalationId ?? '',
    }))));

write('escalation_messages.csv',
  ['message_id', 'title_en', 'title_ar', 'body_en', 'body_ar', 'cta', 'status', 'reviewed_by', 'reviewed_on'],
  C.escalations.map((m) => ({
    message_id: m.id,
    title_en: m.title.en,
    title_ar: m.title.ar,
    body_en: m.body.en,
    body_ar: m.body.ar,
    cta: m.cta,
    ...rev(m),
  })));

write('exercises.csv',
  ['exercise_id', 'body_area', 'name_en', 'name_ar', 'purpose_en', 'purpose_ar', 'steps_en', 'steps_ar', 'dosage_en', 'dosage_ar', 'safety_en', 'safety_ar', 'suits_sex', 'suits_age_bands', 'media_still_id', 'media_clip_id', 'status', 'reviewed_by', 'reviewed_on'],
  C.exercises.map((e) => ({
    exercise_id: e.id,
    body_area: e.bodyArea,
    name_en: e.name.en,
    name_ar: e.name.ar,
    purpose_en: e.purpose.en,
    purpose_ar: e.purpose.ar,
    steps_en: e.steps.map((s) => s.en).join('|'),
    steps_ar: e.steps.map((s) => s.ar).join('|'),
    dosage_en: e.dosage.en,
    dosage_ar: e.dosage.ar,
    safety_en: e.safety.en,
    safety_ar: e.safety.ar,
    suits_sex: e.suitsSex ?? '',
    suits_age_bands: e.suitsAgeBands?.join('|') ?? '',
    media_still_id: e.mediaStillId ?? '',
    media_clip_id: e.mediaClipId ?? '',
    ...rev(e),
  })));

write('routes.csv',
  ['route_id', 'body_area', 'answer_path', 'outcome', 'exercise_ids', 'escalation_message_id', 'status', 'reviewed_by', 'reviewed_on'],
  C.routes.map((r) => ({
    route_id: r.id,
    body_area: r.bodyArea,
    answer_path: r.answerPath,
    outcome: r.outcome,
    exercise_ids: r.outcome === 'exercises' ? r.exerciseIds.join('|') : '',
    escalation_message_id: r.outcome === 'escalate' ? r.escalationId : '',
    ...rev(r),
  })));

console.log('\nDone. Sheets are in ./content — open them in Excel or Google Sheets.');
