/**
 * Patient journey — the ten-step flow. This file is a renderer.
 * Clinical rules live in CSV + the safety engines.
 */
import { useCallback, useMemo, useState } from 'react';
import BodyViewerLazy from '../body/BodyViewerLazy';
import RegionSearch from '../search/RegionSearch';
import GuidedFlow from '../guided/GuidedFlow';
import ProfileGate from '../guided/ProfileGate';
import NrsSlider from '../symptom/NrsSlider';
import { CONTENT } from '../../content/bundle.gen';
import { areaForRegion, questionsFor, resolveOutcome, type Answers, type Profile } from '../../content/routing';
import { loadConsent, saveConsent } from '../../privacy/consent';
import { clearAllPatientData, type PersistMode } from '../../privacy/storage';
import { evaluateRedFlags, publishedRedFlags, redFlagScreenReady } from '../../safety/redFlags';
import { evaluatePrecautions, publishedPrecautions, applyPrecautionHide } from '../../safety/precautions';
import { evaluateEscalationRules, thresholdValue } from '../../safety/escalationRules';
import { startEpisode, loadEpisode, appendSession } from '../../episode/store';
import { resolveTrafficLight } from '../../episode/trafficLight';
import ExerciseCard from '../exercise/ExerciseCard';
import { GROUP_LABELS, REGIONS, regionLabel } from '../body/regions';
import type { BodyView, Gender, Locale, ViewerMode } from '../body/types';
import type { Irritability } from '../../content/types';
import '../../app.css';
import '../guided/guided.css';
import './journey.css';

type Step =
  | 'welcome'
  | 'red_flags'
  | 'precautions'
  | 'about'
  | 'body'
  | 'symptoms'
  | 'area_qs'
  | 'results'
  | 'session'
  | 'check'
  | 'progress'
  | 'stopped';

const COPY = {
  en: {
    app: 'Home programme',
    notAdvice: 'This follows your physiotherapist’s programme. It does not tell you what is wrong.',
    consentTitle: 'Before we start',
    consentBody:
      'We will ask a few questions about how you feel. Answers stay on this device. Nothing is sent anywhere. No account. You can clear everything in one tap.',
    notMine: 'This is not my device — keep answers for this visit only',
    agree: 'I understand — continue',
    yes: 'Yes',
    no: 'No',
    rfTitle: 'A few safety questions first',
    rfSub: 'Please answer all of these. If something here applies, we will stop and ask you to speak to a physiotherapist rather than suggest exercises.',
    precTitle: 'Anything we should know before you move?',
    precSub: 'Pick any that apply. This is a safety check, not a diagnosis.',
    continue: 'Continue',
    nrsNow: 'How intense is it right now? (0–10)',
    nrsWorst: 'At worst this week? (optional)',
    startSession: 'Start this session',
    doneSession: 'I have finished',
    checkTitle: 'How does it feel now?',
    print: 'Print a summary for your visit',
    clear: 'Clear my data',
    contact: 'Contact the clinic',
    stopped: 'We are not going to guess.',
    browse: 'Browse the body map',
    text: 'Text size',
    green: 'Unchanged or eased — continue as shown.',
    amber: 'A little more than before — ease back and hold progression.',
    red: 'Stop this exercise and speak to a physiotherapist.',
    noColour: 'We cannot classify this change until the clinic has set a threshold.',
    unrouted: 'Here is everything published for this area. If this does not fit, talk to the clinic — we will not guess.',
    missingRf: 'The safety screen is not ready. Please contact the clinic rather than using exercises.',
  },
  ar: {
    app: 'البرنامج المنزلي',
    notAdvice: 'هذا يتبع برنامج أخصائي العلاج الطبيعي. لا يخبرك ما المشكلة.',
    consentTitle: 'قبل أن نبدأ',
    consentBody:
      'سنطرح بعض الأسئلة عن شعورك. الإجابات تبقى على هذا الجهاز. لا يُرسل شيء. لا حساب. يمكنك مسح كل شيء بضغطة واحدة.',
    notMine: 'هذا ليس جهازي — احتفظ بالإجابات لهذه الزيارة فقط',
    agree: 'فهمت — متابعة',
    yes: 'نعم',
    no: 'لا',
    rfTitle: 'أسئلة سلامة أولاً',
    rfSub: 'أجب عن جميع هذه الأسئلة. إذا انطبق شيء منها، سنتوقف ونطلب منك مراجعة أخصائي بدلاً من اقتراح تمارين.',
    precTitle: 'أي شيء ينبغي معرفته قبل الحركة؟',
    precSub: 'اختر ما ينطبق. هذا فحص سلامة وليس تشخيصاً.',
    continue: 'متابعة',
    nrsNow: 'ما شدة الإحساس الآن؟ (٠–١٠)',
    nrsWorst: 'في أسوأ لحظة هذا الأسبوع؟ (اختياري)',
    startSession: 'ابدأ هذه الجلسة',
    doneSession: 'انتهيت',
    checkTitle: 'كيف تشعر الآن؟',
    print: 'اطبع ملخصاً للموعد',
    clear: 'امسح بياناتي',
    contact: 'تواصل مع العيادة',
    demo: 'محتوى تجريبي — ليس نصيحة طبية',
    stopped: 'لن نخمّن.',
    browse: 'خريطة الجسم',
    text: 'حجم النص',
    green: 'لم يتغير أو خف — تابع كما هو.',
    amber: 'زيادة خفيفة — خفّف وتوقف عن التقدم.',
    red: 'أوقف هذا التمرين وتحدث مع أخصائي علاج طبيعي.',
    noColour: 'لا يمكننا تصنيف هذا التغير حتى تحدد العيادة العتبة.',
    unrouted: 'إليك كل ما هو منشور لهذه المنطقة. إن لم يناسبك، تواصل مع العيادة — لن نخمّن.',
    missingRf: 'شاشة السلامة غير جاهزة. يرجى التواصل مع العيادة بدلاً من استخدام التمارين.',
  },
} as const;

export default function Journey() {
  const [locale, setLocale] = useState<Locale>('en');
  const [textSize, setTextSize] = useState(1);
  const [step, setStep] = useState<Step>(() => (loadConsent() ? 'red_flags' : 'welcome'));
  const [notMine, setNotMine] = useState(false);
  const [rfAnswers, setRfAnswers] = useState<Record<string, string>>({});
  const [precKeys, setPrecKeys] = useState<string[]>([]);
  const [profile, setProfile] = useState<Profile>({});
  const [gender, setGender] = useState<Gender>('male');
  const [view, setView] = useState<BodyView>('anterior');
  const [mode, setMode] = useState<ViewerMode>('select');
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [bodyArea, setBodyArea] = useState<string | null>(null);
  const [globalAnswers, setGlobalAnswers] = useState<Answers>({});
  const [globalStep, setGlobalStep] = useState(0);
  const [nrsNow, setNrsNow] = useState(3);
  const [nrsWorst, setNrsWorst] = useState<number | null>(null);
  const [nrsAfter, setNrsAfter] = useState(3);
  const [stopMessageId, setStopMessageId] = useState<string | null>(null);
  const [sessionExIds, setSessionExIds] = useState<string[]>([]);
  const [rfIndex, setRfIndex] = useState(0);

  const t = COPY[locale];
  const isRtl = locale === 'ar';
  const flags = publishedRedFlags(CONTENT);
  const precs = publishedPrecautions(CONTENT);
  const globalQs = useMemo(() => questionsFor(CONTENT, 'global'), []);

  const groups = useMemo(() => {
    const out: Record<string, typeof REGIONS> = {};
    for (const r of REGIONS) (out[r.group] ??= [] as any).push(r);
    return out;
  }, []);

  const stopWith = (messageId: string) => {
    setStopMessageId(messageId);
    setStep('stopped');
  };

  const handleConsent = () => {
    const mode: PersistMode = notMine ? 'session' : 'device';
    saveConsent(locale, mode);
    setStep('red_flags');
  };

  const finishRedFlags = () => {
    if (!redFlagScreenReady(CONTENT)) {
      setStep('stopped');
      return;
    }
    const ev = evaluateRedFlags(CONTENT, rfAnswers);
    if (ev.stopped) stopWith(ev.messageId);
    else setStep('precautions');
  };

  const finishPrecautions = () => {
    const ev = evaluatePrecautions(CONTENT, precKeys);
    if (ev.kind === 'stop') stopWith(ev.messageId);
    else setStep('about');
  };

  const pickRegion = useCallback((id: string) => {
    setSelectedRegionId(id);
    const area = areaForRegion(CONTENT, id);
    if (area) setBodyArea(area);
    setMode('pinpoint');
  }, []);

  const goSymptoms = () => {
    if (!bodyArea) return;
    setStep('symptoms');
  };

  const finishGlobal = () => {
    const irr = globalAnswers.irritability as Irritability | undefined;
    if (irr === 'quick' || irr === 'hours' || irr === 'day') {
      setProfile((p) => ({ ...p, irritability: irr }));
    }
    const nrsRef = thresholdValue(CONTENT, 'nrs_referral');
    if (nrsRef != null && nrsNow >= nrsRef) {
      const msg = CONTENT.escalations.find((m) => m.status === 'published');
      if (msg) {
        stopWith(msg.id);
        return;
      }
    }
    setStep('area_qs');
  };

  const areaQuestions = bodyArea ? questionsFor(CONTENT, bodyArea) : [];

  const outcome = useMemo(() => {
    if (!bodyArea) return null;
    return resolveOutcome(CONTENT, bodyArea, { ...globalAnswers }, profile);
  }, [bodyArea, globalAnswers, profile]);

  const shownExercises = useMemo(() => {
    if (!outcome || outcome.kind !== 'exercises') return [];
    const prec = evaluatePrecautions(CONTENT, precKeys);
    if (prec.kind !== 'ok') return [];
    return applyPrecautionHide(outcome.exercises, prec.hideIds);
  }, [outcome, precKeys]);

  const light = resolveTrafficLight(CONTENT, nrsNow, nrsAfter);
  const esc = evaluateEscalationRules(CONTENT, loadEpisode(), {
    unrouted: outcome?.kind === 'exercises' && outcome.unrouted,
    nrsNow,
  });

  const msg = stopMessageId ? CONTENT.escalations.find((m) => m.id === stopMessageId) : null;

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
          <button
            className="ghost"
            onClick={() => {
              clearAllPatientData();
              setStep('welcome');
            }}
          >
            {t.clear}
          </button>
        </div>
      </header>

      <main className="journey-main">
        {step === 'welcome' && (
          <section className="gf hero">
            <p className="hero-kicker">{t.app}</p>
            <h2>{t.consentTitle}</h2>
            <p className="gf-hint">{t.consentBody}</p>
            <p className="gf-hint">{t.notAdvice}</p>
            <label className="privacy-row">
              <input type="checkbox" checked={notMine} onChange={(e) => setNotMine(e.target.checked)} />
              <span>{t.notMine}</span>
            </label>
            <div className="gf-actions sticky-cta">
              <button className="gf-btn gf-btn-primary" onClick={handleConsent}>
                {t.agree}
              </button>
            </div>
          </section>
        )}

        {step === 'red_flags' && flags[rfIndex] && (
          <section className="gf rf-card">
            <div className="step-dots" aria-hidden>
              {flags.map((f, i) => (
                <i key={f.id} className={i === rfIndex ? 'on' : ''} />
              ))}
            </div>
            <p className="rf-count">
              {rfIndex + 1} / {flags.length}
            </p>
            <h2 className="gf-prompt">{flags[rfIndex].prompt[locale]}</h2>
            <div className="gf-chips">
              <button
                className={`gf-chip${rfAnswers[flags[rfIndex].id] === flags[rfIndex].positiveKey ? ' on' : ''}`}
                onClick={() => {
                  const f = flags[rfIndex];
                  const next = { ...rfAnswers, [f.id]: f.positiveKey };
                  setRfAnswers(next);
                  if (rfIndex + 1 < flags.length) setRfIndex(rfIndex + 1);
                  else {
                    const ev = evaluateRedFlags(CONTENT, next);
                    if (ev.stopped) stopWith(ev.messageId);
                    else setStep('precautions');
                  }
                }}
              >
                {t.yes}
              </button>
              <button
                className={`gf-chip${rfAnswers[flags[rfIndex].id] === 'no' ? ' on' : ''}`}
                onClick={() => {
                  const f = flags[rfIndex];
                  const next = { ...rfAnswers, [f.id]: 'no' };
                  setRfAnswers(next);
                  if (rfIndex + 1 < flags.length) setRfIndex(rfIndex + 1);
                  else {
                    const ev = evaluateRedFlags(CONTENT, next);
                    if (ev.stopped) stopWith(ev.messageId);
                    else setStep('precautions');
                  }
                }}
              >
                {t.no}
              </button>
            </div>
          </section>
        )}

        {step === 'precautions' && (
          <section className="gf">
            <h2>{t.precTitle}</h2>
            <p className="gf-hint">{t.precSub}</p>
            <div className="gf-chips">
              {precs.map((p) => {
                const on = precKeys.includes(p.conditionKey);
                return (
                  <button
                    key={p.conditionKey}
                    className={`gf-chip${on ? ' on' : ''}`}
                    onClick={() => {
                      if (p.conditionKey === 'none' || p.conditionKey === 'prefer_not_to_say') {
                        setPrecKeys([p.conditionKey]);
                        return;
                      }
                      setPrecKeys((keys) => {
                        const next = keys.filter((k) => k !== 'none' && k !== 'prefer_not_to_say');
                        return on ? next.filter((k) => k !== p.conditionKey) : [...next, p.conditionKey];
                      });
                    }}
                  >
                    {p.label[locale]}
                  </button>
                );
              })}
            </div>
            <div className="gf-actions">
              <button className="gf-btn gf-btn-primary" disabled={precKeys.length === 0} onClick={finishPrecautions}>
                {t.continue}
              </button>
            </div>
          </section>
        )}

        {step === 'about' && (
          <ProfileGate
            locale={locale}
            onDone={(p) => {
              setProfile(p);
              if (p.sex) setGender(p.sex);
              setStep('body');
            }}
          />
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
                pins={[]}
                resetSignal={resetSignal}
                onRegionHover={() => {}}
                onRegionSelect={pickRegion}
                onRegionClear={() => setSelectedRegionId(null)}
                onPointConfirm={() => {}}
              />
              <div className="viewer-search">
                <RegionSearch locale={locale} selectedRegionId={selectedRegionId} onSelect={pickRegion} />
              </div>
              <div className="viewer-toolbar">
                <div className="seg">
                  <button className={view === 'anterior' ? 'on' : ''} onClick={() => setView('anterior')}>
                    {locale === 'ar' ? 'أمامي' : 'Front'}
                  </button>
                  <button className={view === 'posterior' ? 'on' : ''} onClick={() => setView('posterior')}>
                    {locale === 'ar' ? 'خلفي' : 'Back'}
                  </button>
                </div>
                <div className="seg">
                  <button className={gender === 'male' ? 'on' : ''} onClick={() => setGender('male')}>
                    {locale === 'ar' ? 'ذكر' : 'Male'}
                  </button>
                  <button className={gender === 'female' ? 'on' : ''} onClick={() => setGender('female')}>
                    {locale === 'ar' ? 'أنثى' : 'Female'}
                  </button>
                </div>
                <button
                  className="ghost"
                  onClick={() => {
                    setSelectedRegionId(null);
                    setResetSignal((n) => n + 1);
                  }}
                >
                  {locale === 'ar' ? 'إعادة الضبط' : 'Reset view'}
                </button>
              </div>
              <button className="cant-find" onClick={() => setShowList(true)}>
                {locale === 'ar' ? 'لا أستطيع إيجاده' : "I can't find it"}
              </button>
            </div>
            <aside className="side-panel">
              <section>
                <h2>{locale === 'ar' ? 'المنطقة المحددة' : 'Selected'}</h2>
                <div className="selected-box">{selectedRegionId ? regionLabel(selectedRegionId, locale) : '—'}</div>
                {bodyArea && (
                  <div className="gf-actions sticky-cta">
                    <button className="gf-btn gf-btn-primary body-cta" onClick={goSymptoms}>
                      {t.continue}
                    </button>
                  </div>
                )}
              </section>
            </aside>
          </div>
        )}

        {step === 'symptoms' && (
          <section className="gf">
            <NrsSlider locale={locale} value={nrsNow} onChange={setNrsNow} label={t.nrsNow} />
            <NrsSlider
              locale={locale}
              value={nrsWorst ?? nrsNow}
              onChange={(n) => setNrsWorst(n)}
              label={t.nrsWorst}
            />
            {globalQs[globalStep] ? (
              <>
                <h2 className="gf-prompt">{globalQs[globalStep].prompt[locale]}</h2>
                <ul className="gf-opts">
                  {globalQs[globalStep].options.map((o) => (
                    <li key={o.id}>
                      <button
                        className="gf-opt"
                        onClick={() => {
                          setGlobalAnswers((a) => ({ ...a, [globalQs[globalStep].key]: o.key }));
                          setGlobalStep((s) => s + 1);
                        }}
                      >
                        {o.label[locale]}
                      </button>
                    </li>
                  ))}
                </ul>
                {globalQs[globalStep].skippable && (
                  <button className="gf-btn gf-btn-quiet" onClick={() => setGlobalStep((s) => s + 1)}>
                    {locale === 'ar' ? 'تخطي' : 'Skip'}
                  </button>
                )}
              </>
            ) : (
              <div className="gf-actions">
                <button className="gf-btn gf-btn-primary" onClick={finishGlobal}>
                  {t.continue}
                </button>
              </div>
            )}
          </section>
        )}

        {step === 'area_qs' && bodyArea && (
          <GuidedFlow
            bundle={CONTENT}
            bodyArea={bodyArea}
            locale={locale}
            profile={profile}
            onExit={() => setStep('body')}
            onContinueToSession={() => {
              startEpisode({
                bodyArea,
                regionId: selectedRegionId ?? undefined,
                answers: globalAnswers,
                nrsNow,
              });
              setSessionExIds(shownExercises.map((e) => e.id));
              setStep('session');
            }}
          />
        )}

        {step === 'results' && (
          <section className="gf">
            <h2>{locale === 'ar' ? 'تمارينك' : 'Your exercises'}</h2>
            {outcome?.kind === 'exercises' && outcome.unrouted && <p className="gf-note">{t.unrouted}</p>}
            {esc?.reason === 'unrouted' && <p className="gf-note">{t.stopped}</p>}
            <ol className="gf-ex-list">
              {shownExercises.map((e) => (
                <li key={e.id}>
                  <ExerciseCard exercise={e} locale={locale} />
                </li>
              ))}
            </ol>
            <div className="gf-actions">
              <button
                className="gf-btn gf-btn-primary"
                onClick={() => {
                  if (bodyArea) {
                    startEpisode({
                      bodyArea,
                      regionId: selectedRegionId ?? undefined,
                      answers: globalAnswers,
                      nrsNow,
                    });
                    setSessionExIds(shownExercises.map((e) => e.id));
                  }
                  setStep('session');
                }}
                disabled={shownExercises.length === 0}
              >
                {t.startSession}
              </button>
              <button className="gf-btn" onClick={() => window.print()}>
                {t.print}
              </button>
            </div>
          </section>
        )}

        {step === 'session' && (
          <section className="gf">
            <h2>{t.startSession}</h2>
            <ol className="gf-ex-list">
              {shownExercises
                .filter((e) => sessionExIds.includes(e.id))
                .map((e) => (
                  <li key={e.id}>
                    <ExerciseCard exercise={e} locale={locale} session />
                  </li>
                ))}
            </ol>
            <div className="sticky-cta">
              <button className="gf-btn gf-btn-primary" onClick={() => setStep('check')}>
                {t.doneSession}
              </button>
            </div>
          </section>
        )}

        {step === 'check' && (
          <section className="gf">
            <h2>{t.checkTitle}</h2>
            <NrsSlider locale={locale} value={nrsAfter} onChange={setNrsAfter} label={t.nrsNow} />
            <p className="gf-note">
              {light === 'green' ? t.green : light === 'amber' ? t.amber : light === 'red' ? t.red : t.noColour}
            </p>
            <div className="gf-actions">
              <button
                className="gf-btn gf-btn-primary"
                onClick={() => {
                  if (bodyArea) {
                    appendSession({
                      at: new Date().toISOString(),
                      bodyArea,
                      exerciseIds: sessionExIds,
                      nrsBefore: nrsNow,
                      nrsAfter,
                      light: light ?? undefined,
                    });
                  }
                  if (light === 'red') {
                    const m = CONTENT.escalations[0];
                    if (m) stopWith(m.id);
                    else setStep('progress');
                  } else setStep('progress');
                }}
              >
                {t.continue}
              </button>
            </div>
          </section>
        )}

        {step === 'progress' && (
          <section className="gf visit-summary">
            <h2>{t.print}</h2>
            <p>
              {locale === 'ar' ? 'المنطقة' : 'Area'}: {bodyArea}
            </p>
            <p>NRS: {nrsNow} → {nrsAfter}</p>
            <p>
              {locale === 'ar' ? 'التمارين' : 'Tried'}: {sessionExIds.join(', ')}
            </p>
            {esc && <p className="gf-note">{t.contact}</p>}
            <div className="gf-actions">
              <button className="gf-btn" onClick={() => window.print()}>
                {t.print}
              </button>
              <button className="gf-btn">{t.contact}</button>
            </div>
          </section>
        )}

        {step === 'stopped' && (
          <section className="gf gf-escalate" role="alert">
            <h2>{msg?.title[locale] ?? t.stopped}</h2>
            <p>{msg?.body[locale] ?? t.missingRf}</p>
            <div className="gf-actions sticky-cta">
              <button className="gf-btn gf-btn-primary">{t.contact}</button>
            </div>
          </section>
        )}
      </main>

      {showList && (
        <div className="sheet-backdrop" onClick={() => setShowList(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="sheet-head">
              <h2>{locale === 'ar' ? 'اختر منطقة' : 'Choose a region'}</h2>
              <button className="ghost" onClick={() => setShowList(false)}>
                {locale === 'ar' ? 'إغلاق' : 'Close'}
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
