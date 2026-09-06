/**
 * Minimal patient journey.
 *
 * welcome → select a body region → pinpoint the exact spot → safety questions → exercises.
 *
 * The 3D BodyViewer internals are untouched. The long questionnaires
 * (red-flag, precaution, onset, movement / timing screens) are not part of
 * this flow; their content rows are currently draft in content/*.csv.
 */
import { useCallback, useMemo, useState } from 'react';
import BodyViewerLazy from '../body/BodyViewerLazy';
import RegionSearch from '../search/RegionSearch';
import ExerciseCard from '../exercise/ExerciseCard';
import IntakeForm from './Intake';
import { CONTENT } from '../../content/bundle.gen';
import { areaForRegion, resolveOutcome } from '../../content/routing';
import { loadConsent, saveConsent } from '../../privacy/consent';
import { clearAllPatientData, type PersistMode } from '../../privacy/storage';
import { loadIntake, saveIntake, clearIntake, type Intake } from '../../privacy/intake';
import { GROUP_LABELS, REGIONS, regionLabel } from '../body/regions';
import type { BodyView, Gender, Locale, ViewerMode, PainPin, PointConfirmPayload } from '../body/types';

import '../../app.css';
import '../guided/guided.css';
import './journey.css';

type Step = 'welcome' | 'intake' | 'body' | 'results';

const COPY = {
  en: {
    app: 'Home programme',
    notAdvice: 'Follows your physiotherapist’s programme.',
    welcomeTitle: 'Find your exercises',
    welcomeBody: 'Just a few quick details, then you tap where it hurts.',
    consentBody: 'Your answers stay on this device. Nothing is sent anywhere. No account.',
    notMine: 'This is not my device — keep answers for this visit only',
    start: 'Continue',
    continue: 'Continue',
    back: 'Back',
    results: 'Your exercises',
    empty: 'There is nothing published for this area yet.',
    unrouted: 'Here is everything published for this area.',
    tapBody: 'Tap the painful area on the body',
    pinpoint: 'Now tap the exact spot that hurts',
    front: 'Front',
    backView: 'Back',
    male: 'Male',
    female: 'Female',
    list: 'List',
    clear: 'Clear my data',
    text: 'Text size',
    map: 'Body map',
    startAgain: 'Start again',
    close: 'Close',
    chooseRegion: 'Choose a region',
    session: 'Exercise',
  },
  ar: {
    app: 'البرنامج المنزلي',
    notAdvice: 'يتبع برنامج أخصائي العلاج الطبيعي.',
    welcomeTitle: 'ابحث عن تمارينك',
    welcomeBody: 'القليل من التفاصيل السريعة، ثم تضغط على مكان الألم.',
    consentBody: 'إجاباتك تبقى على هذا الجهاز. لا يُرسل شيء. لا حساب.',
    notMine: 'هذا ليس جهازي — احتفظ بالإجابات لهذه الزيارة فقط',
    start: 'متابعة',
    continue: 'متابعة',
    back: 'رجوع',
    results: 'تمارينك',
    empty: 'لا يوجد محتوى منشور لهذه المنطقة بعد.',
    unrouted: 'إليك جميع التمارين المنشورة لهذه المنطقة.',
    tapBody: 'اضغط على منطقة الألم في الجسم',
    pinpoint: 'الآن اضغط على موضع الألم بالضبط',
    front: 'أمامي',
    backView: 'خلفي',
    male: 'ذكر',
    female: 'أنثى',
    list: 'قائمة',
    clear: 'امسح بياناتي',
    text: 'حجم النص',
    map: 'خريطة الجسم',
    startAgain: 'ابدأ من جديد',
    close: 'إغلاق',
    chooseRegion: 'اختر منطقة',
    session: 'تمرين',
  },
} as const;

export default function Journey() {
  const [locale, setLocale] = useState<Locale>('en');
  const [textSize, setTextSize] = useState(1);

  const [step, setStep] = useState<Step>(() => {
    const consent = loadConsent();
    if (!consent) return 'welcome';
    // Location comes before questions: users should see the 3D workflow immediately.
    return 'body';
  });

  const [notMine, setNotMine] = useState(false);
  const [intake, setIntake] = useState<Intake | null>(() => loadIntake());
  const [gender, setGender] = useState<Gender>(() => intake?.sex ?? 'male');
  const [view, setView] = useState<BodyView>('anterior');
  const [mode, setMode] = useState<ViewerMode>('select');
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [bodyArea, setBodyArea] = useState<string | null>(null);
  const [pin, setPin] = useState<PainPin | null>(null);

  const t = COPY[locale];
  const isRtl = locale === 'ar';

  const groups = useMemo(() => {
    const out: Record<string, typeof REGIONS> = {};
    for (const r of REGIONS) (out[r.group] ??= [] as any).push(r);
    return out;
  }, []);

  const outcome = useMemo(() => {
    if (!bodyArea || !intake) return null;
    return resolveOutcome(CONTENT, bodyArea, {}, { sex: intake.sex });
  }, [bodyArea, intake]);

  const exercises = useMemo(
    () => (outcome?.kind === 'exercises' ? outcome.exercises : []),
    [outcome],
  );

  const handleConsent = () => {
    const persistMode: PersistMode = notMine ? 'session' : 'device';
    saveConsent(locale, persistMode);
    setStep('body');
  };

  const handleIntake = (input: Omit<Intake, 'savedAt'>) => {
    saveIntake(input);
    const next: Intake = { ...input, savedAt: new Date().toISOString() };
    setIntake(next);
    setGender(input.sex);
    setStep(pin ? 'results' : 'body');
  };

  const pickRegion = useCallback((id: string) => {
    setSelectedRegionId(id);
    const area = areaForRegion(CONTENT, id);
    if (area) setBodyArea(area);
    setPin(null);
    setMode('pinpoint');
  }, []);

  const handlePointConfirm = useCallback((point: PointConfirmPayload) => {
    const nextPin: PainPin = {
      id: `pain-${Date.now()}`,
      regionId: point.regionId,
      point: point.point,
      normal: point.normal,
      intensity: intake?.pain ? Math.max(1, Math.min(5, Math.round(intake.pain / 2))) : 3,
    };
    setPin(nextPin);
    setStep('intake');
  }, [intake?.pain]);

  const clear = () => {
    clearAllPatientData();
    clearIntake();
    setIntake(null);
    setSelectedRegionId(null);
    setBodyArea(null);
    setGender('male');
    setMode('select');
    setView('anterior');
    setStep('welcome');
  };

  return (
    <div className="app journey" dir={isRtl ? 'rtl' : 'ltr'} style={{ fontSize: `${17 * textSize}px` }}>
      <header className="app-header">
        <div>
          <h1>{t.app}</h1>
          <p>{t.notAdvice}</p>
        </div>
        <div className="header-controls">
          <button className="ghost" onClick={() => setLocale(isRtl ? 'en' : 'ar')}>
            {isRtl ? 'EN' : 'عربي'}
          </button>
          <label className="text-size">
            {t.text}
            <input
              type="range"
              min={1}
              max={1.4}
              step={0.1}
              value={textSize}
              onChange={(e) => setTextSize(Number(e.target.value))}
            />
          </label>
          <button className="ghost" onClick={clear}>
            {t.clear}
          </button>
        </div>
      </header>

      <main className="journey-main">
        {step === 'welcome' && (
          <section className="gf hero">
            <p className="hero-kicker">{t.app}</p>
            <h2>{t.welcomeTitle}</h2>
            <p className="gf-hint">{t.welcomeBody}</p>
            <p className="gf-hint">{t.consentBody}</p>
            <label className="privacy-row">
              <input type="checkbox" checked={notMine} onChange={(e) => setNotMine(e.target.checked)} />
              <span>{t.notMine}</span>
            </label>
            <div className="gf-actions sticky-cta">
              <button className="gf-btn gf-btn-primary" onClick={handleConsent}>
                {t.start}
              </button>
            </div>
          </section>
        )}

        {step === 'intake' && (
          <IntakeForm locale={locale} initial={intake} onDone={handleIntake} />
        )}

        {step === 'body' && (
          <div className="app-main body-step">
            <div className="viewer-wrap">
              <BodyViewerLazy
                gender={gender}
                view={view}
                mode={mode}
                locale={locale}
                selectedRegionId={selectedRegionId}
                pins={pin ? [pin] : []}
                onRegionHover={() => {}}
                onRegionSelect={pickRegion}
                onRegionClear={() => {
                  setSelectedRegionId(null);
                  setBodyArea(null);
                  setPin(null);
                  setMode('select');
                }}
                onPointConfirm={handlePointConfirm}
              />
              <div className="viewer-search">
                <RegionSearch locale={locale} selectedRegionId={selectedRegionId} onSelect={pickRegion} />
              </div>
              <div className="map-dock">
                <div className="seg">
                  <button className={view === 'anterior' ? 'on' : ''} onClick={() => setView('anterior')}>
                    {t.front}
                  </button>
                  <button className={view === 'posterior' ? 'on' : ''} onClick={() => setView('posterior')}>
                    {t.backView}
                  </button>
                </div>
                <div className="seg">
                  <button className={gender === 'male' ? 'on' : ''} onClick={() => setGender('male')}>
                    {t.male}
                  </button>
                  <button className={gender === 'female' ? 'on' : ''} onClick={() => setGender('female')}>
                    {t.female}
                  </button>
                </div>
                <button className="ghost" onClick={() => setShowList(true)}>
                  {t.list}
                </button>
              </div>
            </div>
            <aside className={`map-sheet${selectedRegionId ? ' open' : ''}`}>
              <p className="map-hint">
                {selectedRegionId
                  ? pin
                    ? regionLabel(selectedRegionId, locale)
                    : t.pinpoint
                  : t.tapBody}
              </p>
              {pin && (
                <button className="gf-btn gf-btn-primary body-cta" onClick={() => setStep('intake')}>
                  {t.continue}
                </button>
              )}
            </aside>
          </div>
        )}

        {step === 'results' && bodyArea && (
          <section className="gf">
            <header className="gf-results-head">
              <h2>{t.results}</h2>
              <span className="gf-area">
                {CONTENT.bodyAreas.find((a) => a.id === bodyArea)?.label[locale] ?? bodyArea}
              </span>
            </header>

            {outcome?.kind === 'empty' && <p className="gf-note">{t.empty}</p>}
            {outcome?.kind === 'exercises' && outcome.unrouted && <p className="gf-note">{t.unrouted}</p>}

            <ol className="gf-ex-list">
              {exercises.map((e) => (
                <li key={e.id}>
                  <ExerciseCard exercise={e} locale={locale} />
                </li>
              ))}
            </ol>

            <div className="gf-actions">
              <button className="gf-btn gf-btn-primary" onClick={() => setStep('body')}>
                {t.back}
              </button>
              <button className="gf-btn" onClick={clear}>
                {t.startAgain}
              </button>
            </div>
          </section>
        )}
      </main>

      {showList && (
        <div className="sheet-backdrop" onClick={() => setShowList(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="sheet-head">
              <h2>{t.chooseRegion}</h2>
              <button className="ghost" onClick={() => setShowList(false)}>
                {t.close}
              </button>
            </div>
            <div className="sheet-body">
              {Object.entries(groups).map(([g, rs]) => (
                <div key={g} className="group">
                  <h3>{GROUP_LABELS[g as keyof typeof GROUP_LABELS][locale]}</h3>
                  <div className="chip-grid">
                    {rs.map((r) => (
                      <button
                        key={r.id}
                        className="chip"
                        onClick={() => {
                          pickRegion(r.id);
                          setShowList(false);
                        }}
                      >
                        {regionLabel(r.id, locale)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
