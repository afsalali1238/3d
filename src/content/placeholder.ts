/**
 * ⚠️  PLACEHOLDER CONTENT — NOT CLINICAL ADVICE, NOT CLINICIAN-AUTHORED.  ⚠️
 *
 * Every string in this file is build-side lorem written to exercise the
 * guided-flow machinery end to end. It exists so the clinician can SEE the
 * flow working and react to it, which is far easier than reacting to a spec.
 *
 * The exercises below are deliberately generic mobility movements of the kind
 * found in any public warm-up guide. They carry `reviewedBy: 'PLACEHOLDER'`
 * so they render in demo mode, and `demo: true` so the UI can badge them.
 *
 * REPLACEMENT PROCEDURE
 *   1. Clinician authors the real rows (see docs/CLINICIAN-HANDOFF.md).
 *   2. Delete this file.
 *   3. `content/*.csv` becomes the source of truth.
 * A test asserts this file is the ONLY source of `PLACEHOLDER` signatures, so
 * it cannot quietly survive into production alongside real content.
 */
import type { ContentBundle } from './types';

const P = { status: 'published' as const, reviewedBy: 'PLACEHOLDER', reviewedOn: '2026-09-06' };

export const PLACEHOLDER_SIGNATURE = 'PLACEHOLDER';

export const placeholderContent: ContentBundle = {
  bodyAreas: [
    {
      id: 'lower_back',
      label: { en: 'Lower Back', ar: 'أسفل الظهر' },
      regionIds: ['lumbar_spine', 'sacrum_si', 'left_oblique', 'right_oblique'],
    },
    {
      id: 'neck',
      label: { en: 'Neck', ar: 'الرقبة' },
      regionIds: [
        'cervical_upper',
        'cervical_lower',
        'throat',
        'left_trapezius',
        'right_trapezius',
      ],
    },
  ],

  questions: [
    {
      ...P,
      id: 'lb_q1',
      bodyArea: 'lower_back',
      key: 'movement',
      order: 1,
      skippable: true,
      prompt: {
        en: 'Which movement feels most limited or uncomfortable?',
        ar: 'ما الحركة التي تشعر أنها الأكثر تقييداً أو إزعاجاً؟',
      },
      hint: {
        en: 'Pick the closest one. You can skip this.',
        ar: 'اختر الأقرب. يمكنك تخطي هذا السؤال.',
      },
      options: [
        { id: 'lb_q1_a', key: 'bending_forward', label: { en: 'Bending forward', ar: 'الانحناء للأمام' } },
        { id: 'lb_q1_b', key: 'leaning_back', label: { en: 'Leaning backward', ar: 'الميل للخلف' } },
        { id: 'lb_q1_c', key: 'twisting', label: { en: 'Twisting side to side', ar: 'الالتفاف يميناً ويساراً' } },
        {
          id: 'lb_q1_d',
          key: 'numbness_weakness',
          label: {
            en: 'I have numbness, tingling or weakness in a leg',
            ar: 'أشعر بخدر أو تنميل أو ضعف في الساق',
          },
          redFlag: true,
          escalationId: 'esc_see_someone',
        },
      ],
    },
    {
      ...P,
      id: 'lb_q2',
      bodyArea: 'lower_back',
      key: 'timing',
      order: 2,
      skippable: true,
      prompt: {
        en: 'When does it bother you most?',
        ar: 'متى يزعجك أكثر؟',
      },
      options: [
        { id: 'lb_q2_a', key: 'mornings', label: { en: 'In the morning', ar: 'في الصباح' } },
        { id: 'lb_q2_b', key: 'after_sitting', label: { en: 'After sitting a long time', ar: 'بعد الجلوس لفترة طويلة' } },
        { id: 'lb_q2_c', key: 'during_activity', label: { en: 'During or after activity', ar: 'أثناء النشاط أو بعده' } },
        {
          id: 'lb_q2_d',
          key: 'night_pain',
          label: {
            en: 'At night — it wakes me up',
            ar: 'في الليل — يوقظني من النوم',
          },
          redFlag: true,
          escalationId: 'esc_see_someone',
        },
      ],
    },
  ],

  escalations: [
    {
      ...P,
      id: 'esc_see_someone',
      cta: 'contact',
      title: {
        en: 'Let’s have someone look at this first',
        ar: 'دعنا نجعل أحد المختصين يفحص هذا أولاً',
      },
      body: {
        en: 'What you described is something a physiotherapist should assess in person before you start any exercises. This is not a cause for alarm — it simply means exercises are not the right next step until someone has examined you. Please get in touch and we will arrange an appointment.',
        ar: 'ما وصفته يحتاج إلى تقييم مباشر من أخصائي علاج طبيعي قبل البدء بأي تمارين. هذا ليس داعياً للقلق، لكنه يعني ببساطة أن التمارين ليست الخطوة التالية المناسبة قبل الفحص. يرجى التواصل معنا لتحديد موعد.',
      },
    },
  ],

  exercises: [
    {
      ...P,
      id: 'lb_ex_pelvic_tilt',
      bodyArea: 'lower_back',
      name: { en: 'Pelvic Tilt', ar: 'إمالة الحوض' },
      purpose: {
        en: 'A gentle way to start moving the lower back through a small, controlled range.',
        ar: 'طريقة لطيفة لبدء تحريك أسفل الظهر ضمن مدى صغير ومضبوط.',
      },
      steps: [
        { en: 'Lie on your back with your knees bent and feet flat on the floor.', ar: 'استلقِ على ظهرك مع ثني الركبتين ووضع القدمين على الأرض.' },
        { en: 'Gently flatten your lower back towards the floor.', ar: 'اضغط أسفل ظهرك برفق نحو الأرض.' },
        { en: 'Hold, then release back to a comfortable resting position.', ar: 'اثبت، ثم عد إلى وضع الراحة المريح.' },
      ],
      dosage: { en: '10 repetitions, hold 5 seconds. Twice a day.', ar: '١٠ تكرارات، ثبات ٥ ثوانٍ. مرتين يومياً.' },
      safety: {
        en: 'Stop if this increases your pain or causes symptoms down your leg.',
        ar: 'توقف إذا زاد هذا من ألمك أو سبب أعراضاً في ساقك.',
      },
    },
    {
      ...P,
      id: 'lb_ex_knee_to_chest',
      bodyArea: 'lower_back',
      name: { en: 'Single Knee to Chest', ar: 'سحب الركبة إلى الصدر' },
      purpose: {
        en: 'Eases the lower back into flexion one side at a time.',
        ar: 'يساعد أسفل الظهر على الانثناء تدريجياً جانباً واحداً في كل مرة.',
      },
      steps: [
        { en: 'Lie on your back with both knees bent.', ar: 'استلقِ على ظهرك مع ثني الركبتين.' },
        { en: 'Draw one knee gently towards your chest with both hands.', ar: 'اسحب إحدى الركبتين برفق نحو صدرك بكلتا اليدين.' },
        { en: 'Hold, lower slowly, then repeat on the other side.', ar: 'اثبت، ثم أنزلها ببطء وكرر مع الجانب الآخر.' },
      ],
      dosage: { en: 'Hold 20 seconds, 3 times each side. Once a day.', ar: 'ثبات ٢٠ ثانية، ٣ مرات لكل جانب. مرة يومياً.' },
      safety: {
        en: 'Keep the movement slow. Do not pull into pain.',
        ar: 'حافظ على بطء الحركة. لا تسحب إلى حد الألم.',
      },
    },
    {
      ...P,
      id: 'lb_ex_cat_camel',
      bodyArea: 'lower_back',
      name: { en: 'Cat–Camel', ar: 'تمرين القطة والجمل' },
      purpose: {
        en: 'Moves the whole spine through its range without loading it.',
        ar: 'يحرك العمود الفقري بالكامل ضمن مداه دون تحميل عليه.',
      },
      steps: [
        { en: 'Start on your hands and knees.', ar: 'ابدأ على يديك وركبتيك.' },
        { en: 'Slowly round your back upwards.', ar: 'قوّس ظهرك ببطء إلى الأعلى.' },
        { en: 'Then slowly let it sag downwards. Move smoothly between the two.', ar: 'ثم أنزله ببطء إلى الأسفل. تحرك بسلاسة بين الوضعين.' },
      ],
      dosage: { en: '10 slow cycles. Twice a day.', ar: '١٠ دورات بطيئة. مرتين يومياً.' },
      safety: {
        en: 'Move only as far as is comfortable in each direction.',
        ar: 'تحرك فقط ضمن المدى المريح في كل اتجاه.',
      },
      suitsAgeBands: ['teen', 'adult', 'older_adult'],
    },
    {
      ...P,
      id: 'lb_ex_sit_stand',
      bodyArea: 'lower_back',
      name: { en: 'Sit to Stand', ar: 'الجلوس والوقوف' },
      purpose: {
        en: 'Builds confidence with the movement most used in daily life.',
        ar: 'يبني الثقة بالحركة الأكثر استخداماً في الحياة اليومية.',
      },
      steps: [
        { en: 'Sit towards the front of a stable chair.', ar: 'اجلس نحو مقدمة كرسي ثابت.' },
        { en: 'Stand up without using your hands if you can.', ar: 'قف دون استخدام يديك إن أمكن.' },
        { en: 'Sit back down slowly and with control.', ar: 'اجلس ببطء وتحكم.' },
      ],
      dosage: { en: '8 repetitions. Twice a day.', ar: '٨ تكرارات. مرتين يومياً.' },
      safety: {
        en: 'Have a stable surface nearby to hold if you feel unsteady.',
        ar: 'احرص على وجود سطح ثابت قريب للإمساك به إذا شعرت بعدم الاتزان.',
      },
    },
  ],

  routes: [
    {
      ...P,
      id: 'lb_r1',
      bodyArea: 'lower_back',
      answerPath: 'movement=bending_forward&timing=mornings',
      outcome: 'exercises',
      exerciseIds: ['lb_ex_pelvic_tilt', 'lb_ex_cat_camel'],
    },
    {
      ...P,
      id: 'lb_r2',
      bodyArea: 'lower_back',
      answerPath: 'movement=bending_forward&timing=after_sitting',
      outcome: 'exercises',
      exerciseIds: ['lb_ex_cat_camel', 'lb_ex_sit_stand', 'lb_ex_knee_to_chest'],
    },
    {
      ...P,
      id: 'lb_r3',
      bodyArea: 'lower_back',
      answerPath: 'movement=leaning_back&timing=after_sitting',
      outcome: 'exercises',
      exerciseIds: ['lb_ex_knee_to_chest', 'lb_ex_pelvic_tilt'],
    },
    {
      ...P,
      id: 'lb_r4',
      bodyArea: 'lower_back',
      answerPath: 'movement=twisting&timing=during_activity',
      outcome: 'exercises',
      exerciseIds: ['lb_ex_cat_camel', 'lb_ex_pelvic_tilt'],
    },
  ],
};
