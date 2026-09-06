import { describe, it, expect } from 'vitest';
import { parseCsv, toCsv } from './csv';
import { validateContent, formatIssues, type SourceFiles } from './validate';

/* ------------------------------------------------------------------ CSV */

describe('CSV parser', () => {
  it('handles quoted fields with commas', () => {
    const t = parseCsv('t.csv', 'a,b\n1,"hello, world"\n');
    expect(t.rows[0].cells.b).toBe('hello, world');
  });

  it('handles escaped quotes', () => {
    const t = parseCsv('t.csv', 'a\n"she said ""stop"""\n');
    expect(t.rows[0].cells.a).toBe('she said "stop"');
  });

  it('handles embedded newlines and keeps the record line number', () => {
    const t = parseCsv('t.csv', 'a,b\n1,"line one\nline two"\n3,4\n');
    expect(t.rows[0].cells.b).toBe('line one\nline two');
    expect(t.rows[1].line).toBe(4);
  });

  it('handles CRLF and a UTF-8 BOM (what Excel exports)', () => {
    const t = parseCsv('t.csv', '\uFEFFa,b\r\n1,2\r\n');
    expect(t.headers).toEqual(['a', 'b']);
    expect(t.rows[0].cells.a).toBe('1');
  });

  it('preserves Arabic text unchanged', () => {
    const t = parseCsv('t.csv', 'a\nأسفل الظهر\n');
    expect(t.rows[0].cells.a).toBe('أسفل الظهر');
  });

  it('skips blank lines', () => {
    expect(parseCsv('t.csv', 'a\n1\n\n2\n').rows.length).toBe(2);
  });

  it('rejects a row with more values than columns, naming the line', () => {
    expect(() => parseCsv('t.csv', 'a,b\n1,2,3\n')).toThrow(/only 2 columns/);
  });

  it('round-trips through toCsv', () => {
    const rows = [{ a: 'plain', b: 'has, comma' }, { a: 'has "quote"', b: 'line\nbreak' }];
    const t = parseCsv('t.csv', toCsv(['a', 'b'], rows));
    expect(t.rows.map((r) => r.cells)).toEqual(rows);
  });
});

/* ----------------------------------------------------------- validation */

/** A minimal, valid content set. Tests mutate one thing at a time. */
function goodFiles(): SourceFiles {
  return {
    'body_areas.csv': toCsv(['body_area', 'label_en', 'label_ar', 'region_ids'], [
      { body_area: 'lower_back', label_en: 'Lower Back', label_ar: 'أسفل الظهر', region_ids: 'lumbar_spine|sacrum_si' },
    ]),
    'questions.csv': toCsv(
      ['question_id', 'body_area', 'key', 'prompt_en', 'prompt_ar', 'order', 'skippable', 'status', 'reviewed_by', 'reviewed_on'],
      [{ question_id: 'q1', body_area: 'lower_back', key: 'movement', prompt_en: 'Which movement?', prompt_ar: 'أي حركة؟', order: '1', skippable: 'yes', status: 'published', reviewed_by: 'Dr X', reviewed_on: '2026-09-06' }],
    ),
    'answer_options.csv': toCsv(
      ['option_id', 'question_id', 'key', 'label_en', 'label_ar', 'order', 'red_flag', 'escalation_message_id'],
      [
        { option_id: 'o1', question_id: 'q1', key: 'bending', label_en: 'Bending', label_ar: 'الانحناء', order: '1', red_flag: 'no', escalation_message_id: '' },
        { option_id: 'o2', question_id: 'q1', key: 'numbness', label_en: 'Numbness in a leg', label_ar: 'خدر في الساق', order: '2', red_flag: 'yes', escalation_message_id: 'esc1' },
      ],
    ),
    'escalation_messages.csv': toCsv(
      ['message_id', 'title_en', 'title_ar', 'body_en', 'body_ar', 'cta', 'status', 'reviewed_by', 'reviewed_on'],
      [{ message_id: 'esc1', title_en: 'See someone', title_ar: 'راجع مختصاً', body_en: 'Please get in touch.', body_ar: 'يرجى التواصل.', cta: 'contact', status: 'published', reviewed_by: 'Dr X', reviewed_on: '2026-09-06' }],
    ),
    'exercises.csv': toCsv(
      ['exercise_id', 'body_area', 'name_en', 'name_ar', 'purpose_en', 'purpose_ar', 'steps_en', 'steps_ar', 'dosage_en', 'dosage_ar', 'safety_en', 'safety_ar', 'suits_sex', 'suits_age_bands', 'status', 'reviewed_by', 'reviewed_on'],
      [{ exercise_id: 'ex1', body_area: 'lower_back', name_en: 'Pelvic Tilt', name_ar: 'إمالة الحوض', purpose_en: 'Gentle movement.', purpose_ar: 'حركة لطيفة.', steps_en: 'Lie down|Tilt|Release', steps_ar: 'استلق|أمل|أرخِ', dosage_en: '10 reps', dosage_ar: '١٠ تكرارات', safety_en: 'Stop if painful.', safety_ar: 'توقف عند الألم.', suits_sex: '', suits_age_bands: '', status: 'published', reviewed_by: 'Dr X', reviewed_on: '2026-09-06' }],
    ),
    'routes.csv': toCsv(
      ['route_id', 'body_area', 'answer_path', 'outcome', 'exercise_ids', 'escalation_message_id', 'status', 'reviewed_by', 'reviewed_on'],
      [{ route_id: 'r1', body_area: 'lower_back', answer_path: 'movement=bending', outcome: 'exercises', exercise_ids: 'ex1', escalation_message_id: '', status: 'published', reviewed_by: 'Dr X', reviewed_on: '2026-09-06' }],
    ),
  };
}

/** every error message produced, joined — for substring assertions */
const errors = (f: SourceFiles) =>
  validateContent(f).issues.filter((i) => i.severity === 'error').map((i) => `${i.message} ${i.fix ?? ''}`).join('\n');

describe('valid content', () => {
  it('passes with no errors', () => {
    const r = validateContent(goodFiles());
    expect(formatIssues(r.issues.filter((i) => i.severity === 'error'))).toBe('✅ content: no problems found');
    expect(r.ok).toBe(true);
  });

  it('produces a usable bundle', () => {
    const { bundle } = validateContent(goodFiles());
    expect(bundle.bodyAreas[0].id).toBe('lower_back');
    expect(bundle.questions[0].options.length).toBe(2);
    expect(bundle.exercises[0].steps.length).toBe(3);
    expect(bundle.exercises[0].steps[0].ar).toBe('استلق');
  });
});

describe('the publication gate', () => {
  it('rejects published rows with no signature', () => {
    const f = goodFiles();
    f['exercises.csv'] = f['exercises.csv'].replace('Dr X', '');
    expect(errors(f)).toMatch(/published but "reviewed_by" is empty/);
  });

  it('allows draft rows with no signature', () => {
    const f = goodFiles();
    f['exercises.csv'] = f['exercises.csv'].replace('published,Dr X', 'draft,');
    expect(errors(f)).not.toMatch(/reviewed_by/);
  });

  it('rejects a malformed review date', () => {
    const f = goodFiles();
    f['exercises.csv'] = f['exercises.csv'].replace('2026-09-06', '6th Sept');
    expect(errors(f)).toMatch(/must look like 2026-09-06/);
  });
});

describe('red-flag safety', () => {
  it('rejects a red-flag option with no escalation message', () => {
    const f = goodFiles();
    f['answer_options.csv'] = f['answer_options.csv'].replace('yes,esc1', 'yes,');
    expect(errors(f)).toMatch(/red flag but has no escalation_message_id/);
  });

  it('rejects a route that sends a red-flag answer to exercises', () => {
    const f = goodFiles();
    f['routes.csv'] = f['routes.csv'].replace('movement=bending', 'movement=numbness');
    expect(errors(f)).toMatch(/red-flag answer .* to exercises/);
  });

  it('rejects an escalation reference that does not exist', () => {
    const f = goodFiles();
    f['answer_options.csv'] = f['answer_options.csv'].replace('esc1', 'nope');
    expect(errors(f)).toMatch(/unknown escalation "nope"/);
  });
});

describe('referential integrity', () => {
  it('rejects an unknown body area', () => {
    const f = goodFiles();
    f['exercises.csv'] = f['exercises.csv'].replace('lower_back', 'elbow');
    expect(errors(f)).toMatch(/unknown body_area "elbow"/);
  });

  it('rejects a region that is not on the 3D model', () => {
    const f = goodFiles();
    f['body_areas.csv'] = f['body_areas.csv'].replace('lumbar_spine', 'lumbar_spinne');
    expect(errors(f)).toMatch(/does not exist on the 3D model/);
  });

  it('rejects a route pointing at a missing exercise', () => {
    const f = goodFiles();
    f['routes.csv'] = f['routes.csv'].replace(',ex1,', ',ex_missing,');
    expect(errors(f)).toMatch(/unknown exercise "ex_missing"/);
  });

  it('rejects a route using a question key that does not exist', () => {
    const f = goodFiles();
    f['routes.csv'] = f['routes.csv'].replace('movement=bending', 'timing=mornings');
    expect(errors(f)).toMatch(/uses question key "timing"/);
  });

  it('rejects a route using an answer that is not an option', () => {
    const f = goodFiles();
    f['routes.csv'] = f['routes.csv'].replace('movement=bending', 'movement=twisting');
    expect(errors(f)).toMatch(/is not one of its options/);
    expect(errors(f)).toMatch(/Valid answers: bending, numbness/);
  });

  it('rejects a region claimed by two body areas', () => {
    const f = goodFiles();
    f['body_areas.csv'] += 'neck,Neck,الرقبة,lumbar_spine\n';
    expect(errors(f)).toMatch(/claimed by both/);
  });

  it('rejects duplicate ids', () => {
    const f = goodFiles();
    f['exercises.csv'] += f['exercises.csv'].split('\n')[1] + '\n';
    expect(errors(f)).toMatch(/duplicate exercise_id/);
  });

  it('rejects two routes answering the same path', () => {
    const f = goodFiles();
    const row = f['routes.csv'].split('\n')[1].replace('r1', 'r2');
    f['routes.csv'] += row + '\n';
    expect(errors(f)).toMatch(/duplicates the answer path/);
  });

  it('rejects two questions in one area sharing a key', () => {
    const f = goodFiles();
    f['questions.csv'] += 'q2,lower_back,movement,Another?,آخر؟,2,yes,published,Dr X,2026-09-06\n';
    expect(errors(f)).toMatch(/both use key "movement"/);
  });
});

describe('compliance is enforced at authoring time', () => {
  it('rejects a condition name in a question prompt', () => {
    const f = goodFiles();
    f['questions.csv'] = f['questions.csv'].replace('Which movement?', 'Do you have sciatica?');
    expect(errors(f)).toMatch(/contains "sciatica"/);
  });

  it('rejects a condition name in an exercise name', () => {
    const f = goodFiles();
    f['exercises.csv'] = f['exercises.csv'].replace('Pelvic Tilt', 'Frozen shoulder release');
    expect(errors(f)).toMatch(/contains "frozen shoulder"/);
  });

  it('rejects a treatment claim in escalation copy', () => {
    const f = goodFiles();
    f['escalation_messages.csv'] = f['escalation_messages.csv'].replace('Please get in touch.', 'This will cure you.');
    expect(errors(f)).toMatch(/contains "cure"/);
  });
});

describe('author-friendly failures', () => {
  it('rejects an unknown age band and lists the valid ones', () => {
    const f = goodFiles();
    f['exercises.csv'] = f['exercises.csv'].replace(',,published', ',elderly,published');
    const e = errors(f);
    expect(e).toMatch(/unknown age band "elderly"/);
    expect(e).toMatch(/teen, adult, older_adult, senior/);
  });

  it('rejects a malformed answer_path with an example', () => {
    const f = goodFiles();
    f['routes.csv'] = f['routes.csv'].replace('movement=bending', 'movement bending');
    expect(errors(f)).toMatch(/movement=overhead&timing=mornings/);
  });

  it('rejects mismatched step counts between languages', () => {
    const f = goodFiles();
    f['exercises.csv'] = f['exercises.csv'].replace('استلق|أمل|أرخِ', 'استلق|أمل');
    expect(errors(f)).toMatch(/3 English steps but 2 Arabic steps/);
  });

  it('rejects an id with spaces or capitals', () => {
    const f = goodFiles();
    f['exercises.csv'] = f['exercises.csv'].replace('ex1', 'Ex 1');
    expect(errors(f)).toMatch(/lowercase letters, numbers and underscores/);
  });

  it('rejects a question with no options and says where to add them', () => {
    const f = goodFiles();
    f['answer_options.csv'] = f['answer_options.csv'].split('\n')[0] + '\n';
    const e = errors(f);
    expect(e).toMatch(/has no answer options/);
    expect(e).toMatch(/answer_options\.csv with question_id = q1/);
  });

  it('every error carries file, line and a message', () => {
    const f = goodFiles();
    f['exercises.csv'] = f['exercises.csv'].replace('Pelvic Tilt', '');
    for (const i of validateContent(f).issues) {
      expect(i.file).toBeTruthy();
      expect(i.message).toBeTruthy();
      expect(typeof i.line).toBe('number');
    }
  });
});

describe('warnings do not block', () => {
  it('warns but passes when Arabic is missing', () => {
    const f = goodFiles();
    f['exercises.csv'] = f['exercises.csv'].replace('إمالة الحوض', '');
    const r = validateContent(f);
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.severity === 'warning' && /Arabic/.test(i.message))).toBe(true);
  });

  it('warns when a body area has no published exercises', () => {
    const f = goodFiles();
    f['exercises.csv'] = f['exercises.csv'].replace('published,Dr X', 'draft,');
    const r = validateContent(f);
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => /no published exercises/.test(i.message))).toBe(true);
  });
});
