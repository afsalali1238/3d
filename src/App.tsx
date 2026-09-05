/**
 * Demo route (/body) exercising every BodyViewer mode.
 * This layer owns app state (gender, view, mode, selection, confirmed pins)
 * and talks to the 3D module exclusively through the BodyViewer prop API.
 */
import { useCallback, useMemo, useState } from 'react';
import BodyViewer from './components/body/BodyViewer';
import { GROUP_LABELS, REGIONS, regionLabel } from './components/body/regions';
import type {
  BodyView,
  Gender,
  Locale,
  PainPin,
  PointConfirmPayload,
  ViewerMode,
} from './components/body/types';
import './app.css';

const T = {
  en: {
    title: 'Body Map',
    subtitle: 'Tap the body where it hurts',
    front: 'Front',
    back: 'Back',
    male: 'Male',
    female: 'Female',
    reset: 'Reset view',
    explore: 'Explore',
    select: 'Select region',
    pinpoint: 'Pinpoint',
    cantFind: "I can't find it",
    listTitle: 'Choose a region',
    close: 'Close',
    pins: 'Pain points',
    clear: 'Clear',
    none: 'No pain points yet — select a region, then tap the exact spot.',
    selected: 'Selected',
    intensity: 'Intensity',
    maxPins: 'Maximum of 5 pain points reached.',
    hovering: ' ',
  },
  ar: {
    title: 'خريطة الجسم',
    subtitle: 'اضغط على مكان الألم في الجسم',
    front: 'أمامي',
    back: 'خلفي',
    male: 'ذكر',
    female: 'أنثى',
    reset: 'إعادة الضبط',
    explore: 'استكشاف',
    select: 'اختيار منطقة',
    pinpoint: 'تحديد دقيق',
    cantFind: 'لا أستطيع إيجاده',
    listTitle: 'اختر منطقة',
    close: 'إغلاق',
    pins: 'نقاط الألم',
    clear: 'مسح',
    none: 'لا توجد نقاط ألم بعد — اختر منطقة ثم اضغط على النقطة المحددة.',
    selected: 'المنطقة المحددة',
    intensity: 'الشدة',
    maxPins: 'تم بلوغ الحد الأقصى (٥ نقاط).',
    hovering: ' ',
  },
} as const;

export default function App() {
  const [gender, setGender] = useState<Gender>('male');
  const [view, setView] = useState<BodyView>('anterior');
  const [mode, setMode] = useState<ViewerMode>('select');
  const [locale, setLocale] = useState<Locale>('en');
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pins, setPins] = useState<PainPin[]>([]);
  const [intensity, setIntensity] = useState(3);
  const [showList, setShowList] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const t = T[locale];

  const handleRegionSelect = useCallback((id: string) => {
    setSelectedRegionId(id);
    setMode('pinpoint');
  }, []);

  const handleConfirm = useCallback(
    (p: PointConfirmPayload) => {
      setPins((prev) => {
        if (prev.length >= 5) {
          setToast(t.maxPins);
          setTimeout(() => setToast(null), 2500);
          return prev;
        }
        return [
          ...prev,
          {
            id: `pin-${Date.now()}`,
            regionId: p.regionId,
            point: p.point,
            normal: p.normal,
            intensity,
          },
        ];
      });
      setSelectedRegionId(null);
      setMode('select');
    },
    [intensity, t.maxPins],
  );

  const handleClear = useCallback(() => {
    setSelectedRegionId(null);
    setMode('select');
  }, []);

  const groups = useMemo(() => {
    const out: Record<string, typeof REGIONS> = {};
    for (const r of REGIONS) (out[r.group] ??= [] as any).push(r);
    return out;
  }, []);

  const isRtl = locale === 'ar';

  return (
    <div className="app" dir={isRtl ? 'rtl' : 'ltr'}>
      <header className="app-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="header-controls">
          <div className="seg">
            <button className={mode === 'explore' ? 'on' : ''} onClick={() => { setMode('explore'); setSelectedRegionId(null); }}>
              {t.explore}
            </button>
            <button className={mode === 'select' ? 'on' : ''} onClick={() => setMode('select')}>
              {t.select}
            </button>
            <button className={mode === 'pinpoint' ? 'on' : ''} onClick={() => setMode('pinpoint')} disabled={!selectedRegionId}>
              {t.pinpoint}
            </button>
          </div>
          <button className="ghost" onClick={() => setLocale(isRtl ? 'en' : 'ar')} aria-label="Toggle language">
            {isRtl ? 'EN' : 'عربي'}
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="viewer-wrap">
          <BodyViewer
            gender={gender}
            view={view}
            mode={mode}
            locale={locale}
            selectedRegionId={selectedRegionId}
            pins={pins}
            resetSignal={resetSignal}
            onRegionHover={setHoverId}
            onRegionSelect={handleRegionSelect}
            onRegionClear={handleClear}
            onPointConfirm={handleConfirm}
            onError={(e) => console.error('BodyViewer error:', e)}
          />

          {/* viewer chrome */}
          <div className="viewer-toolbar">
            <div className="seg">
              <button className={view === 'anterior' ? 'on' : ''} onClick={() => setView('anterior')}>
                {t.front}
              </button>
              <button className={view === 'posterior' ? 'on' : ''} onClick={() => setView('posterior')}>
                {t.back}
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
            <button
              className="ghost"
              onClick={() => {
                setSelectedRegionId(null);
                setResetSignal((n) => n + 1);
              }}
            >
              {t.reset}
            </button>
          </div>

          {hoverId && !selectedRegionId && (
            <div className="hover-hint">{regionLabel(hoverId, locale)}</div>
          )}

          <button className="cant-find" onClick={() => setShowList(true)}>
            {t.cantFind}
          </button>

          {toast && <div className="toast">{toast}</div>}
        </div>

        <aside className="side-panel">
          <section>
            <h2>{t.selected}</h2>
            <div className="selected-box">
              {selectedRegionId ? regionLabel(selectedRegionId, locale) : '—'}
            </div>
            <label className="intensity-row">
              <span>{t.intensity}</span>
              <input
                type="range"
                min={1}
                max={5}
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
              />
              <b className={`lvl lvl-${intensity}`}>{intensity}</b>
            </label>
          </section>

          <section>
            <div className="pins-head">
              <h2>
                {t.pins} ({pins.length}/5)
              </h2>
              {pins.length > 0 && (
                <button className="ghost small" onClick={() => setPins([])}>
                  {t.clear}
                </button>
              )}
            </div>
            {pins.length === 0 ? (
              <p className="muted">{t.none}</p>
            ) : (
              <ul className="pin-list">
                {pins.map((p) => (
                  <li key={p.id}>
                    <span className={`dot lvl-${p.intensity}`} />
                    <span className="pin-label">{regionLabel(p.regionId, locale)}</span>
                    <button
                      className="ghost small"
                      aria-label="remove"
                      onClick={() => setPins((prev) => prev.filter((x) => x.id !== p.id))}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </main>

      {/* region-list escape hatch */}
      {showList && (
        <div className="sheet-backdrop" onClick={() => setShowList(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t.listTitle}>
            <div className="sheet-head">
              <h2>{t.listTitle}</h2>
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
                          handleRegionSelect(r.id);
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
