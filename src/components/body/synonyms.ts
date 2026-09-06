/**
 * Region synonyms — patient vocabulary that should find an anatomical region.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  STATUS: build-side SEED, pending clinician confirmation.
 *  These are plain-language *anatomy* words only — the same category of
 *  non-clinical vocabulary as the region labels themselves. They contain no
 *  condition names, no symptoms, and no diagnostic implication.
 *
 *  Condition names are BANNED here and the ban is enforced by
 *  `src/content/compliance.ts` + its test, which fails the build on any hit.
 *  "sciatica" must never map to lumbar_spine, however much SEO wants it.
 *
 *  The clinician owns this list. Terms she rejects get deleted; terms she
 *  adds go through the same scan. See docs/CLINICIAN-HANDOFF.md §B7.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type RegionSynonym = {
  regionId: string;
  term: string;
  locale: 'en' | 'ar';
  /** 'seed' = build-side suggestion, 'reviewed' = clinician-confirmed */
  status: 'seed' | 'reviewed';
};

/** Terms that apply to both sides of a bilateral pair, keyed by id suffix. */
const BILATERAL: Record<string, { en: string[]; ar: string[] }> = {
  temple: { en: ['temple', 'side of head'], ar: ['صدغ', 'جانب الرأس'] },
  jaw: { en: ['jaw', 'tmj', 'jaw joint'], ar: ['فك', 'مفصل الفك'] },
  trapezius: { en: ['trap', 'traps', 'top of shoulder', 'base of neck'], ar: ['أعلى الكتف', 'شبه المنحرفة'] },
  deltoid_anterior: { en: ['front shoulder', 'front of shoulder'], ar: ['مقدمة الكتف'] },
  deltoid_lateral: { en: ['shoulder', 'outer shoulder', 'side of shoulder', 'deltoid'], ar: ['كتف', 'جانب الكتف'] },
  deltoid_posterior: { en: ['back of shoulder', 'rear shoulder'], ar: ['خلف الكتف'] },
  rotator_cuff: { en: ['shoulder blade', 'rotator cuff', 'scapula', 'wing bone'], ar: ['لوح الكتف', 'الكفة المدورة'] },
  biceps: { en: ['biceps', 'front of arm', 'upper arm'], ar: ['العضلة ذات الرأسين', 'أعلى الذراع'] },
  triceps: { en: ['triceps', 'back of arm'], ar: ['خلف الذراع'] },
  elbow: { en: ['elbow'], ar: ['مرفق', 'كوع'] },
  forearm_flexor: { en: ['inner forearm', 'underside of forearm'], ar: ['باطن الساعد'] },
  forearm_extensor: { en: ['outer forearm', 'top of forearm', 'forearm'], ar: ['ظاهر الساعد', 'ساعد'] },
  wrist: { en: ['wrist'], ar: ['معصم', 'رسغ'] },
  hand: { en: ['hand', 'palm', 'back of hand'], ar: ['يد', 'كف'] },
  thumb: { en: ['thumb'], ar: ['إبهام'] },
  fingers: { en: ['fingers', 'finger', 'knuckles'], ar: ['أصابع اليد', 'إصبع'] },
  chest: { en: ['chest', 'pec', 'pectoral', 'breastbone area'], ar: ['صدر'] },
  upper_back: { en: ['upper back', 'between shoulder blades', 'rhomboid'], ar: ['أعلى الظهر', 'بين لوحي الكتف'] },
  oblique: { en: ['side', 'flank', 'love handle', 'obliques', 'waist'], ar: ['خاصرة', 'جانب البطن'] },
  glute: { en: ['glute', 'buttock', 'backside', 'bum', 'seat'], ar: ['ألية', 'المؤخرة'] },
  hip_groin: { en: ['hip', 'groin', 'hip flexor', 'front of hip'], ar: ['ورك', 'أربية', 'فخذ علوي'] },
  quadriceps: { en: ['quad', 'quads', 'front of thigh', 'thigh'], ar: ['مقدمة الفخذ', 'فخذ'] },
  hamstring: { en: ['hamstring', 'back of thigh', 'back of leg'], ar: ['خلف الفخذ', 'أوتار الفخذ'] },
  it_band: { en: ['it band', 'outer thigh', 'side of thigh', 'iliotibial'], ar: ['خارج الفخذ'] },
  knee_anterior: { en: ['knee', 'kneecap', 'front of knee', 'patella'], ar: ['ركبة', 'مقدمة الركبة', 'صابونة الركبة'] },
  knee_medial: { en: ['inner knee', 'inside of knee'], ar: ['داخل الركبة'] },
  knee_lateral: { en: ['outer knee', 'outside of knee'], ar: ['خارج الركبة'] },
  knee_posterior: { en: ['back of knee', 'behind the knee'], ar: ['خلف الركبة'] },
  calf: { en: ['calf', 'back of lower leg'], ar: ['ربلة الساق', 'بطة الساق', 'سمانة'] },
  shin: { en: ['shin', 'front of lower leg', 'shinbone', 'tibia'], ar: ['قصبة الساق', 'مقدمة الساق'] },
  achilles: { en: ['achilles', 'achilles tendon', 'back of ankle', 'heel cord'], ar: ['وتر أخيل', 'خلف الكاحل'] },
  ankle: { en: ['ankle'], ar: ['كاحل'] },
  heel: { en: ['heel', 'bottom of heel'], ar: ['كعب'] },
  foot_arch: { en: ['foot', 'arch', 'sole', 'ball of foot', 'instep'], ar: ['قدم', 'قوس القدم', 'باطن القدم'] },
  toes: { en: ['toes', 'toe', 'big toe'], ar: ['أصابع القدم', 'إصبع القدم'] },
};

/** Terms for midline / single regions. */
const MIDLINE: Record<string, { en: string[]; ar: string[] }> = {
  scalp: { en: ['head', 'top of head', 'crown', 'scalp'], ar: ['رأس', 'أعلى الرأس', 'فروة'] },
  forehead: { en: ['forehead', 'brow'], ar: ['جبهة', 'جبين'] },
  face: { en: ['face', 'cheek', 'eye area'], ar: ['وجه', 'خد'] },
  throat: { en: ['throat', 'front of neck', 'adam apple'], ar: ['حلق', 'مقدمة الرقبة', 'زور'] },
  cervical_upper: { en: ['neck', 'upper neck', 'base of skull', 'top of neck'], ar: ['رقبة', 'عنق', 'أعلى الرقبة', 'قفا'] },
  cervical_lower: { en: ['lower neck', 'neck and shoulders', 'cervical'], ar: ['أسفل الرقبة', 'أسفل العنق'] },
  mid_back: { en: ['mid back', 'middle of back', 'thoracic', 'between the blades'], ar: ['منتصف الظهر', 'وسط الظهر'] },
  lumbar_spine: {
    en: ['lower back', 'low back', 'small of my back', 'small of the back', 'lumbar', 'back', 'loin'],
    ar: ['أسفل الظهر', 'ظهر', 'الفقرات القطنية', 'وسط الضهر'],
  },
  abdomen_upper: { en: ['upper abdomen', 'upper stomach', 'belly', 'stomach'], ar: ['أعلى البطن', 'بطن', 'معدة'] },
  abdomen_lower: { en: ['lower abdomen', 'lower belly', 'lower stomach'], ar: ['أسفل البطن'] },
  sacrum_si: { en: ['tailbone', 'sacrum', 'si joint', 'base of spine', 'coccyx'], ar: ['العصعص', 'العجز', 'أسفل العمود الفقري'] },
};

function build(): RegionSynonym[] {
  const out: RegionSynonym[] = [];
  const push = (regionId: string, term: string, locale: 'en' | 'ar') =>
    out.push({ regionId, term, locale, status: 'seed' });

  for (const [suffix, sets] of Object.entries(BILATERAL)) {
    for (const side of ['left', 'right'] as const) {
      const id = `${side}_${suffix}`;
      const sideEn = side === 'left' ? 'left' : 'right';
      const sideAr = side === 'left' ? 'يسار' : 'يمين';
      for (const t of sets.en) {
        push(id, t, 'en');
        // "left knee" / "right shoulder" — patients type the side
        push(id, `${sideEn} ${t}`, 'en');
      }
      for (const t of sets.ar) {
        push(id, t, 'ar');
        push(id, `${t} ${sideAr}`, 'ar');
      }
    }
  }

  for (const [id, sets] of Object.entries(MIDLINE)) {
    for (const t of sets.en) push(id, t, 'en');
    for (const t of sets.ar) push(id, t, 'ar');
  }

  return out;
}

export const SYNONYMS: RegionSynonym[] = build();
