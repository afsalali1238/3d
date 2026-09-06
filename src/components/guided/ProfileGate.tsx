/**
 * Screen 1 — "Who is this for?"
 *
 * Skip is always available and is never a lesser path: skipping loads the
 * neutral figure and applies no filter. Nothing is transmitted; selections
 * live in one localStorage key on this device only.
 */
import { useState } from 'react';
import { AGE_BANDS, saveProfile } from './profile';
import type { AgeBand, Locale, Sex } from '../../content/types';
import './guided.css';

type Props = {
  locale: Locale;
  onDone: (p: { sex?: Sex; ageBand?: AgeBand }) => void;
};

const S = {
  en: {
    title: 'Who is this for?',
    sub: 'This only changes the figure shown and which exercises are suggested. You can skip it.',
    sex: 'Body form',
    male: 'Male',
    female: 'Female',
    age: 'Age',
    privacy: 'Stays on this device. No account, nothing sent anywhere.',
    cont: 'Continue',
    skip: 'Skip — show me everything',
  },
  ar: {
    title: 'لمن هذا؟',
    sub: 'هذا يغيّر فقط الشكل المعروض والتمارين المقترحة. يمكنك التخطي.',
    sex: 'شكل الجسم',
    male: 'ذكر',
    female: 'أنثى',
    age: 'العمر',
    privacy: 'يبقى على هذا الجهاز. لا حساب، ولا يُرسل أي شيء.',
    cont: 'متابعة',
    skip: 'تخطي — أرني كل شيء',
  },
} as const;

export function ProfileGate({ locale, onDone }: Props) {
  const t = S[locale];
  const [sex, setSex] = useState<Sex | undefined>();
  const [ageBand, setAgeBand] = useState<AgeBand | undefined>();

  return (
    <section className="gf gf-profile">
      <h2>{t.title}</h2>
      <p className="gf-hint">{t.sub}</p>

      <fieldset className="gf-fieldset">
        <legend>{t.sex}</legend>
        <div className="gf-chips">
          {(['male', 'female'] as const).map((s) => (
            <button
              key={s}
              className={`gf-chip${sex === s ? ' on' : ''}`}
              aria-pressed={sex === s}
              onClick={() => setSex(sex === s ? undefined : s)}
            >
              {t[s]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="gf-fieldset">
        <legend>{t.age}</legend>
        <div className="gf-chips">
          {AGE_BANDS.map((b) => (
            <button
              key={b.id}
              className={`gf-chip${ageBand === b.id ? ' on' : ''}`}
              aria-pressed={ageBand === b.id}
              onClick={() => setAgeBand(ageBand === b.id ? undefined : b.id)}
            >
              {b.label[locale]}
            </button>
          ))}
        </div>
      </fieldset>

      <p className="gf-privacy">🔒 {t.privacy}</p>

      <div className="gf-actions">
        <button
          className="gf-btn gf-btn-primary"
          onClick={() => {
            saveProfile({ sex, ageBand });
            onDone({ sex, ageBand });
          }}
        >
          {t.cont}
        </button>
        <button className="gf-btn gf-btn-quiet" onClick={() => onDone({})}>
          {t.skip}
        </button>
      </div>
    </section>
  );
}

export default ProfileGate;
