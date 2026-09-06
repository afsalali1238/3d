/** Accessible NRS 0–10. Numbers + word anchors. Not an emoji scale. RTL-safe. */
import type { Locale } from '../../content/types';

type Props = {
  locale: Locale;
  value: number;
  onChange: (n: number) => void;
  label: string;
};

const ANCHOR = {
  en: { min: 'No pain', max: 'Worst imaginable' },
  ar: { min: 'لا ألم', max: 'أسوأ ما يمكن تخيّله' },
};

export default function NrsSlider({ locale, value, onChange, label }: Props) {
  const a = ANCHOR[locale];
  return (
    <div className="nrs">
      <label className="nrs-label" htmlFor="nrs-now">
        {label}
      </label>
      <div className="nrs-row">
        <span className="nrs-anchor">{a.min} 0</span>
        <input
          id="nrs-now"
          type="range"
          min={0}
          max={10}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-valuemin={0}
          aria-valuemax={10}
          aria-valuenow={value}
          aria-label={label}
        />
        <span className="nrs-anchor">10 {a.max}</span>
      </div>
      <div className="nrs-value" aria-live="polite">
        {value}
      </div>
    </div>
  );
}
