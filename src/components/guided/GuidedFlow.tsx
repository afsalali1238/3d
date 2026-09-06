/**
 * Guided flow — questions → outcome, for one body area.
 *
 * This component is a RENDERER. It holds answers in memory, asks
 * `resolveOutcome` what to show, and shows it. It contains no clinical logic,
 * no scoring, and no fallback cleverness.
 */
import { useMemo, useState } from 'react';
import {
  questionsFor,
  resolveOutcome,
  type Answers,
  type Profile,
} from '../../content/routing';
import type { ContentBundle, Locale } from '../../content/types';
import { PLACEHOLDER_SIGNATURE } from '../../content/placeholder';
import './guided.css';

type Props = {
  bundle: ContentBundle;
  bodyArea: string;
  locale: Locale;
  profile: Profile;
  onExit: () => void;
};

const S = {
  en: {
    step: (a: number, b: number) => `Question ${a} of ${b}`,
    skip: 'Skip this question',
    back: 'Back',
    exit: 'Start over',
    results: 'Your exercises',
    unrouted: 'Here is everything published for this area.',
    relaxed:
      'We are showing all exercises for this area, because narrowing them left nothing to show.',
    empty: 'There is nothing published for this area yet.',
    contact: 'Contact the clinic',
    demo: 'DEMO CONTENT — not clinical advice',
    dosage: 'How much',
    safety: 'Stop if',
    steps: 'How to do it',
    print: 'Print these',
    answersLabel: 'Your answers',
  },
  ar: {
    step: (a: number, b: number) => `السؤال ${a} من ${b}`,
    skip: 'تخطي هذا السؤال',
    back: 'رجوع',
    exit: 'ابدأ من جديد',
    results: 'تمارينك',
    unrouted: 'إليك جميع التمارين المنشورة لهذه المنطقة.',
    relaxed: 'نعرض جميع تمارين هذه المنطقة، لأن التصفية لم تترك شيئاً لعرضه.',
    empty: 'لا يوجد محتوى منشور لهذه المنطقة بعد.',
    contact: 'تواصل مع العيادة',
    demo: 'محتوى تجريبي — ليس نصيحة طبية',
    dosage: 'المقدار',
    safety: 'توقف إذا',
    steps: 'كيفية الأداء',
    print: 'اطبع',
    answersLabel: 'إجاباتك',
  },
} as const;

export function GuidedFlow({ bundle, bodyArea, locale, profile, onExit }: Props) {
  const t = S[locale];
  const questions = useMemo(() => questionsFor(bundle, bodyArea), [bundle, bodyArea]);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});

  const area = bundle.bodyAreas.find((a) => a.id === bodyArea);
  const done = step >= questions.length;

  // Red flags are evaluated on every answer, so an escalation can interrupt
  // mid-flow rather than waiting for the end.
  const interim = useMemo(
    () => resolveOutcome(bundle, bodyArea, answers, profile),
    [bundle, bodyArea, answers, profile],
  );
  const escalatedNow = interim.kind === 'escalate' && interim.reason === 'red_flag';

  const outcome = done || escalatedNow ? interim : null;

  const answer = (key: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setStep((s) => s + 1);
  };

  /* ------------------------------------------------------------ escalation */
  if (outcome?.kind === 'escalate') {
    const msg = bundle.escalations.find((m) => m.id === outcome.escalationId);
    if (!msg) return null;
    return (
      <section className="gf gf-escalate" role="alert" aria-live="assertive">
        <div className="gf-escalate-icon" aria-hidden>
          !
        </div>
        <h2>{msg.title[locale]}</h2>
        <p>{msg.body[locale]}</p>
        <div className="gf-actions">
          <button className="gf-btn gf-btn-primary">{t.contact}</button>
          <button className="gf-btn" onClick={onExit}>
            {t.exit}
          </button>
        </div>
        {msg.reviewedBy === PLACEHOLDER_SIGNATURE && <p className="gf-demo">{t.demo}</p>}
      </section>
    );
  }

  /* --------------------------------------------------------------- results */
  if (outcome) {
    if (outcome.kind === 'empty') {
      return (
        <section className="gf">
          <h2>{area?.label[locale]}</h2>
          <p className="gf-note">{t.empty}</p>
          <div className="gf-actions">
            <button className="gf-btn gf-btn-primary">{t.contact}</button>
            <button className="gf-btn" onClick={onExit}>
              {t.exit}
            </button>
          </div>
        </section>
      );
    }

    return (
      <section className="gf">
        <header className="gf-results-head">
          <h2>{t.results}</h2>
          <span className="gf-area">{area?.label[locale]}</span>
        </header>

        {(outcome.unrouted || outcome.filterRelaxed) && (
          <p className="gf-note">{outcome.filterRelaxed ? t.relaxed : t.unrouted}</p>
        )}

        <ol className="gf-ex-list">
          {outcome.exercises.map((e) => (
            <li key={e.id} className="gf-ex">
              <h3>{e.name[locale]}</h3>
              <p className="gf-ex-purpose">{e.purpose[locale]}</p>
              <div className="gf-ex-media" aria-hidden>
                <span>▶</span>
              </div>
              <h4>{t.steps}</h4>
              <ol className="gf-ex-steps">
                {e.steps.map((s, i) => (
                  <li key={i}>{s[locale]}</li>
                ))}
              </ol>
              <p className="gf-ex-dosage">
                <strong>{t.dosage}:</strong> {e.dosage[locale]}
              </p>
              <p className="gf-ex-safety">
                <strong>{t.safety}:</strong> {e.safety[locale]}
              </p>
              {e.reviewedBy === PLACEHOLDER_SIGNATURE && <p className="gf-demo">{t.demo}</p>}
            </li>
          ))}
        </ol>

        <div className="gf-actions">
          <button className="gf-btn" onClick={() => window.print()}>
            {t.print}
          </button>
          <button className="gf-btn" onClick={onExit}>
            {t.exit}
          </button>
        </div>
      </section>
    );
  }

  /* ------------------------------------------------------------- questions */
  const q = questions[step];
  if (!q) return null;

  return (
    <section className="gf">
      <div className="gf-progress">
        <span>{t.step(step + 1, questions.length)}</span>
        <div className="gf-bar">
          <div className="gf-bar-fill" style={{ inlineSize: `${((step + 1) / questions.length) * 100}%` }} />
        </div>
      </div>

      <h2 className="gf-prompt">{q.prompt[locale]}</h2>
      {q.hint && <p className="gf-hint">{q.hint[locale]}</p>}

      <ul className="gf-opts">
        {q.options.map((o) => (
          <li key={o.id}>
            <button className="gf-opt" onClick={() => answer(q.key, o.key)}>
              {o.label[locale]}
            </button>
          </li>
        ))}
      </ul>

      <div className="gf-actions">
        {step > 0 && (
          <button className="gf-btn" onClick={() => setStep((s) => s - 1)}>
            {t.back}
          </button>
        )}
        {q.skippable && (
          <button className="gf-btn gf-btn-quiet" onClick={() => setStep((s) => s + 1)}>
            {t.skip}
          </button>
        )}
      </div>
    </section>
  );
}

export default GuidedFlow;
