/**
 * Minimal intake — the only thing we ask before the body map.
 *
 * Five fields only:
 *   1. Male / Female
 *   2. Height (cm)
 *   3. Weight (kg)
 *   4. Long-term condition yes/no
 *   5. Pain 0–10
 *
 * Height and weight are captured raw. Nothing leaves the device. No
 * red-flag / precaution / onset screens.
 */
import { useState } from 'react';
import type { Locale, Sex } from '../../content/types';
import NrsSlider from '../symptom/NrsSlider';
import type { Intake, LongTermCondition } from '../../privacy/intake';
import '../guided/guided.css';

type Props = {
  locale: Locale;
  initial?: Intake | null;
  onDone: (i: Omit<Intake, 'savedAt'>) => void;
};

const S = {
  en: {
    title: 'A few quick details',
    sub: 'Five questions, then you pick the spot on the body. Your answers stay on this device.',
    sex: 'I am',
    male: 'Male',
    female: 'Female',
    height: 'Height (cm)',
    weight: 'Weight (kg)',
    condition: 'Do you have a long-term condition?',
    yes: 'Yes',
    no: 'No',
    pain: 'How much pain are you in right now? (0–10)',
    continue: 'Continue',
    privacy: 'Stored on this device only. Nothing is sent anywhere. No account.',
  },
  ar: {
    title: 'تفاصيل سريعة',
    sub: 'خمسة أسئلة، ثم تختار الموضع على الجسم. إجاباتك تبقى على هذا الجهاز.',
    sex: 'أنا',
    male: 'ذكر',
    female: 'أنثى',
    height: 'الطول (سم)',
    weight: 'الوزن (كغ)',
    condition: 'هل لديك حالة مزمنة؟',
    yes: 'نعم',
    no: 'لا',
    pain: 'ما شدة الألم الآن؟ (٠–١٠)',
    continue: 'متابعة',
    privacy: 'تُخزَّن على هذا الجهاز فقط. لا يُرسل أي شيء. لا حساب.',
  },
} as const;

export default function IntakeForm({ locale, initial, onDone }: Props) {
  const t = S[locale];
  const [sex, setSex] = useState<Sex | undefined>(initial?.sex);
  const [heightCm, setHeightCm] = useState<string>(initial ? String(initial.heightCm) : '');
  const [weightKg, setWeightKg] = useState<string>(initial ? String(initial.weightKg) : '');
  const [longTermCondition, setLongTermCondition] = useState<LongTermCondition | undefined>(
    initial?.longTermCondition,
  );
  const [pain, setPain] = useState<number | null>(initial?.pain ?? null);

  const height = Number(heightCm);
  const weight = Number(weightKg);
  const heightOk = Number.isFinite(height) && height >= 80 && height <= 250;
  const weightOk = Number.isFinite(weight) && weight >= 25 && weight <= 350;
  const ready = !!sex && heightOk && weightOk && !!longTermCondition && pain != null;

  const submit = () => {
    if (!ready || !sex || !longTermCondition || pain == null) return;
    onDone({ sex, heightCm: height, weightKg: weight, longTermCondition, pain });
  };

  return (
    <section className="gf gf-intake">
      <h2>{t.title}</h2>
      <p className="gf-hint">{t.sub}</p>

      <fieldset className="gf-fieldset">
        <legend>{t.sex}</legend>
        <div className="gf-chips">
          {(['male', 'female'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`gf-chip${sex === s ? ' on' : ''}`}
              aria-pressed={sex === s}
              onClick={() => setSex(s)}
            >
              {t[s]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="gf-grid">
        <label className="gf-input">
          <span>{t.height}</span>
          <input
            type="number"
            inputMode="decimal"
            min={80}
            max={250}
            step={1}
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            placeholder="170"
          />
        </label>
        <label className="gf-input">
          <span>{t.weight}</span>
          <input
            type="number"
            inputMode="decimal"
            min={25}
            max={350}
            step={1}
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            placeholder="70"
          />
        </label>
      </div>

      <fieldset className="gf-fieldset">
        <legend>{t.condition}</legend>
        <div className="gf-chips">
          {(['yes', 'no'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`gf-chip${longTermCondition === v ? ' on' : ''}`}
              aria-pressed={longTermCondition === v}
              onClick={() => setLongTermCondition(v)}
            >
              {t[v]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="gf-intake-pain">
        <NrsSlider
          locale={locale}
          value={pain ?? 0}
          onChange={setPain}
          label={t.pain}
        />
      </div>

      <p className="gf-privacy">🔒 {t.privacy}</p>

      <div className="gf-actions sticky-cta">
        <button className="gf-btn gf-btn-primary" disabled={!ready} onClick={submit}>
          {t.continue}
        </button>
      </div>
    </section>
  );
}
