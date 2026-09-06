/**
 * Validate the CSV content and report problems in plain language.
 *
 * Run: npm run content:check
 * Exit code 1 on any error, so CI fails on bad content.
 */
import { readFileSync, existsSync } from 'node:fs';
import { validateContent, formatIssues, type SourceFiles } from '../src/content/validate';
import { selectPublished } from '../src/content/routing';

const NAMES: Array<keyof SourceFiles> = [
  'body_areas.csv',
  'questions.csv',
  'answer_options.csv',
  'escalation_messages.csv',
  'exercises.csv',
  'routes.csv',
  'red_flags.csv',
  'precautions.csv',
  'thresholds.csv',
];

const missing = NAMES.filter((n) => !existsSync(`content/${n}`));
if (missing.length === NAMES.length) {
  console.log('No content/ sheets found. Run `npm run content:export` to create them.');
  process.exit(0);
}
if (missing.length) {
  console.error(`Missing content files: ${missing.join(', ')}`);
  process.exit(1);
}

const files = Object.fromEntries(
  NAMES.map((n) => [n, readFileSync(`content/${n}`, 'utf8')]),
) as SourceFiles;

const { bundle, issues, ok } = validateContent(files);

console.log(formatIssues(issues));

// what a patient would actually see
const pubEx = selectPublished(bundle.exercises);
const pubQ = selectPublished(bundle.questions);
const pubR = selectPublished(bundle.routes);

console.log('\nWhat patients can see right now:');
console.log(`  body areas           ${bundle.bodyAreas.length}`);
console.log(`  questions            ${pubQ.length} published / ${bundle.questions.length} total`);
console.log(`  routes               ${pubR.length} published / ${bundle.routes.length} total`);
console.log(`  exercises            ${pubEx.length} published / ${bundle.exercises.length} total`);
console.log(`  escalation messages  ${selectPublished(bundle.escalations).length} published / ${bundle.escalations.length} total`);

for (const a of bundle.bodyAreas) {
  const n = pubEx.filter((e) => e.bodyArea === a.id).length;
  console.log(`    ${a.id.padEnd(20)} ${n} exercise(s)`);
}

if (!ok) {
  console.error('\n✖ Content has errors and will not be published.');
  process.exit(1);
}
console.log('\n✅ Content is valid.');
