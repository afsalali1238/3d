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
    {
      id: 'shoulder',
      label: { en: 'Shoulder', ar: 'الكتف' },
      regionIds: [
        'left_deltoid_anterior',
        'right_deltoid_anterior',
        'left_deltoid_lateral',
        'right_deltoid_lateral',
        'left_deltoid_posterior',
        'right_deltoid_posterior',
        'left_rotator_cuff',
        'right_rotator_cuff',
      ],
    },
    {
      id: 'hip',
      label: { en: 'Hip', ar: 'الورك' },
      regionIds: ['left_glute', 'right_glute', 'left_hip_groin', 'right_hip_groin'],
    },
    {
      id: 'knee',
      label: { en: 'Knee', ar: 'الركبة' },
      regionIds: [
        'left_knee_anterior',
        'right_knee_anterior',
        'left_knee_medial',
        'right_knee_medial',
        'left_knee_lateral',
        'right_knee_lateral',
        'left_knee_posterior',
        'right_knee_posterior',
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
      id: 'g_onset',
      bodyArea: 'global',
      key: 'onset',
      order: 1,
      skippable: false,
      prompt: {
        en: 'Did this start after a particular activity, or has it been around for a while?',
        ar: 'هل بدأ هذا بعد نشاط معيّن، أم أنه موجود منذ فترة؟',
      },
      options: [
        { id: 'g_onset_a', key: 'new_after_activity', label: { en: 'New, after an activity', ar: 'جديد، بعد نشاط' } },
        { id: 'g_onset_b', key: 'long_standing', label: { en: 'It has been around for a while', ar: 'موجود منذ فترة' } },
      ],
    },
    {
      ...P,
      id: 'g_duration',
      bodyArea: 'global',
      key: 'duration',
      order: 2,
      skippable: true,
      prompt: {
        en: 'Roughly how long has it been present?',
        ar: 'منذ متى تقريباً وهو موجود؟',
      },
      options: [
        { id: 'g_dur_a', key: 'days', label: { en: 'A few days', ar: 'بضعة أيام' } },
        { id: 'g_dur_b', key: 'weeks', label: { en: 'A few weeks', ar: 'بضعة أسابيع' } },
        { id: 'g_dur_c', key: 'months', label: { en: 'Months or longer', ar: 'أشهر أو أكثر' } },
      ],
    },
    {
      ...P,
      id: 'g_irritability',
      bodyArea: 'global',
      key: 'irritability',
      order: 3,
      skippable: false,
      prompt: {
        en: 'If it gets stirred up, how long before it settles?',
        ar: 'إذا اشتد، كم يمضي قبل أن يهدأ؟',
      },
      options: [
        { id: 'g_irr_a', key: 'quick', label: { en: 'It settles quickly', ar: 'يهدأ بسرعة' } },
        { id: 'g_irr_b', key: 'hours', label: { en: 'An hour or two', ar: 'ساعة أو ساعتان' } },
        { id: 'g_irr_c', key: 'day', label: { en: 'The rest of the day', ar: 'بقية اليوم' } },
      ],
    },
    {
      ...P,
      id: 'g_pattern',
      bodyArea: 'global',
      key: 'pattern',
      order: 4,
      skippable: true,
      prompt: {
        en: 'When in the day does it tend to bother you most?',
        ar: 'في أي وقت من اليوم يزعجك أكثر؟',
      },
      options: [
        { id: 'g_pat_a', key: 'morning', label: { en: 'Worse in the morning', ar: 'أسوأ في الصباح' } },
        { id: 'g_pat_b', key: 'sitting', label: { en: 'Worse with sitting', ar: 'أسوأ مع الجلوس' } },
        { id: 'g_pat_c', key: 'activity', label: { en: 'Worse with activity', ar: 'أسوأ مع النشاط' } },
      ],
    },
    {
      ...P,
      ...P,
      id: 'nk_q1',
      bodyArea: 'neck',
      key: 'movement',
      order: 1,
      skippable: true,
      prompt: {
        en: 'Which way feels most limited?',
        ar: 'أي اتجاه تشعر أنه الأكثر تقييداً؟',
      },
      options: [
        { id: 'nk_q1_a', key: 'turning', label: { en: 'Turning', ar: 'الالتفاف' } },
        { id: 'nk_q1_b', key: 'looking_up', label: { en: 'Looking up', ar: 'النظر إلى الأعلى' } },
        { id: 'nk_q1_c', key: 'looking_down', label: { en: 'Looking down', ar: 'النظر إلى الأسفل' } },
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
      mediaStillId: 'lb_ex_cat_camel',
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
      mediaStillId: 'lb_ex_sit_stand',
    },
    {
      ...P,
      id: 'nk_ex_chin_tuck',
      bodyArea: 'neck',
      name: { en: 'Chin Tuck', ar: 'سحب الذقن' },
      purpose: {
        en: 'A small, slow way to lengthen the neck without looking down.',
        ar: 'طريقة صغيرة وبطيئة لإطالة الرقبة دون النظر إلى الأسفل.',
      },
      steps: [
        { en: 'Sit tall with your shoulders relaxed.', ar: 'اجلس باستقامة مع استرخاء الكتفين.' },
        { en: 'Gently draw your chin straight back, as if making a double chin.', ar: 'اسحب ذقنك برفق إلى الخلف مباشرة.' },
        { en: 'Hold, then return to a comfortable rest.', ar: 'اثبت، ثم عد إلى وضع مريح.' },
      ],
      dosage: { en: '8 slow repetitions. Twice a day.', ar: '٨ تكرارات بطيئة. مرتين يومياً.' },
      safety: {
        en: 'Stop if this increases pain or sends symptoms into an arm.',
        ar: 'توقف إذا زاد الألم أو امتدت الأعراض إلى الذراع.',
      },
      mediaStillId: 'nk_ex_chin_tuck',
    },
    {
      ...P,
      id: 'nk_ex_neck_turn',
      bodyArea: 'neck',
      name: { en: 'Easy Neck Turn', ar: 'التفاف الرقبة بلطف' },
      purpose: {
        en: 'Moves the neck through a comfortable turning range.',
        ar: 'يحرك الرقبة ضمن مدى التفاف مريح.',
      },
      steps: [
        { en: 'Sit or stand tall.', ar: 'اجلس أو قف باستقامة.' },
        { en: 'Slowly turn to look over one shoulder.', ar: 'استدر ببطء للنظر فوق أحد الكتفين.' },
        { en: 'Return through centre, then the other side.', ar: 'عد عبر الوسط ثم الجانب الآخر.' },
      ],
      dosage: { en: '6 turns each side. Once or twice a day.', ar: '٦ التفافات لكل جانب. مرة أو مرتين يومياً.' },
      safety: {
        en: 'Stay in a range that feels easy. Do not force the end.',
        ar: 'ابقِ ضمن مدى سهل. لا تجبر نهاية الحركة.',
      },
      mediaStillId: 'nk_ex_neck_turn',
    },
    {
      ...P,
      id: 'sh_ex_blade_squeeze',
      bodyArea: 'shoulder',
      name: { en: 'Shoulder Blade Squeeze', ar: 'ضم لوحي الكتف' },
      purpose: {
        en: 'Gently brings the shoulder blades together without shrugging.',
        ar: 'يقرّب لوحي الكتف بلطف دون رفع الكتفين.',
      },
      steps: [
        { en: 'Sit or stand with arms relaxed.', ar: 'اجلس أو قف مع استرخاء الذراعين.' },
        { en: 'Draw the shoulder blades slightly together and down.', ar: 'قرّب لوحي الكتف قليلاً إلى الداخل والأسفل.' },
        { en: 'Hold, then release.', ar: 'اثبت، ثم أرخِ.' },
      ],
      dosage: { en: 'Hold 5 seconds, 10 times. Twice a day.', ar: 'ثبات ٥ ثوانٍ، ١٠ مرات. مرتين يومياً.' },
      safety: {
        en: 'Keep the movement small. Do not pinch into pain.',
        ar: 'أبقِ الحركة صغيرة. لا تضغط إلى حد الألم.',
      },
      mediaStillId: 'sh_ex_blade_squeeze',
    },
    {
      ...P,
      id: 'hp_ex_bridge',
      bodyArea: 'hip',
      name: { en: 'Gentle Bridge', ar: 'الجسر اللطيف' },
      purpose: {
        en: 'Lifts the hips a short way to move the back of the hips.',
        ar: 'يرفع الوركين مسافة قصيرة لتحريك خلف الورك.',
      },
      steps: [
        { en: 'Lie on your back with knees bent and feet flat.', ar: 'استلقِ على ظهرك مع ثني الركبتين.' },
        { en: 'Press through the feet and lift the hips a little.', ar: 'اضغط بالقدمين وارفع الوركين قليلاً.' },
        { en: 'Lower slowly.', ar: 'أنزل ببطء.' },
      ],
      dosage: { en: '8 repetitions. Once a day.', ar: '٨ تكرارات. مرة يومياً.' },
      safety: {
        en: 'Stop if this increases pain in the back or down a leg.',
        ar: 'توقف إذا زاد ألم الظهر أو الساق.',
      },
      mediaStillId: 'hp_ex_bridge',
    },
    {
      ...P,
      id: 'kn_ex_bend',
      bodyArea: 'knee',
      name: { en: 'Supported Knee Bend', ar: 'ثني الركبة مع دعم' },
      purpose: {
        en: 'Bends the knee through a small, supported range.',
        ar: 'يثني الركبة ضمن مدى صغير مع دعم.',
      },
      steps: [
        { en: 'Stand beside a stable chair and hold on.', ar: 'قف بجانب كرسي ثابت وأمسك به.' },
        { en: 'Bend one knee a little, keeping the movement slow.', ar: 'اثنِ ركبة واحدة قليلاً ببطء.' },
        { en: 'Straighten, then switch sides.', ar: 'مدّها ثم بدّل الجانب.' },
      ],
      dosage: { en: '10 each side. Once a day.', ar: '١٠ لكل جانب. مرة يومياً.' },
      safety: {
        en: 'Hold the chair. Stay in a comfortable range.',
        ar: 'أمسك الكرسي. ابقَ ضمن مدى مريح.',
      },
      mediaStillId: 'kn_ex_bend',
    },
    {
      ...P,
      id: 'kn_ex_ankle',
      bodyArea: 'knee',
      name: { en: 'Ankle Circles', ar: 'دوائر الكاحل' },
      purpose: {
        en: 'Keeps the lower leg moving while you rest the knee.',
        ar: 'يبقي أسفل الساق متحركاً أثناء راحة الركبة.',
      },
      steps: [
        { en: 'Sit with the back supported.', ar: 'اجلس مع دعم الظهر.' },
        { en: 'Lift one foot a little and slowly circle the ankle.', ar: 'ارفع قدماً قليلاً وحرّك الكاحل بدوائر بطيئة.' },
        { en: 'Change direction, then switch sides.', ar: 'غيّر الاتجاه ثم بدّل الجانب.' },
      ],
      dosage: { en: '10 circles each way, each side.', ar: '١٠ دوائر لكل اتجاه ولكل جانب.' },
      safety: {
        en: 'Move slowly. Stop if the movement increases pain.',
        ar: 'تحرك ببطء. توقف إذا زاد الألم.',
      },
      mediaStillId: 'kn_ex_ankle',
    },
  ],

  redFlags: [
    {
      ...P,
      id: 'rf_trauma',
      order: 1,
      positiveKey: 'yes',
      messageId: 'esc_see_someone',
      prompt: {
        en: 'Did this start after a fall, a collision, or another significant impact?',
        ar: 'هل بدأ هذا بعد سقوط أو اصطدام أو تأثير قوي؟',
      },
    },
    {
      ...P,
      id: 'rf_neuro',
      order: 2,
      positiveKey: 'yes',
      messageId: 'esc_see_someone',
      prompt: {
        en: 'Are you noticing new numbness, tingling that is spreading, or weakness in an arm or a leg?',
        ar: 'هل تلاحظ خدراً جديداً أو تنميلاً منتشراً أو ضعفاً في ذراع أو ساق؟',
      },
    },
    {
      ...P,
      id: 'rf_night',
      order: 3,
      positiveKey: 'yes',
      messageId: 'esc_see_someone',
      prompt: {
        en: 'Does pain wake you at night and stay with you even after you change position?',
        ar: 'هل يوقظك الألم ليلاً ويبقى حتى بعد تغيير وضعيتك؟',
      },
    },
    {
      ...P,
      id: 'rf_bladder',
      order: 4,
      positiveKey: 'yes',
      messageId: 'esc_see_someone',
      prompt: {
        en: 'Have you noticed a change in bladder or bowel control that is new for you?',
        ar: 'هل لاحظت تغيراً جديداً في التحكم بالمثانة أو الأمعاء؟',
      },
    },
    {
      ...P,
      id: 'rf_weight',
      order: 5,
      positiveKey: 'yes',
      messageId: 'esc_see_someone',
      prompt: {
        en: 'Have you lost weight without trying, alongside this pain?',
        ar: 'هل فقدت وزناً دون محاولة، مع هذا الألم؟',
      },
    },
    {
      ...P,
      id: 'rf_chest',
      order: 6,
      positiveKey: 'yes',
      messageId: 'esc_see_someone',
      prompt: {
        en: 'Do you get chest tightness, unusual breathlessness, or arm pain with effort?',
        ar: 'هل تشعر بضيق في الصدر أو ضيق نفس غير معتاد أو ألم في الذراع مع الجهد؟',
      },
    },
  ],

  precautions: [
    {
      ...P,
      conditionKey: 'none',
      label: { en: 'None of these', ar: 'لا شيء من هذا' },
      restrictsTags: [],
      restrictsIds: [],
      action: 'warn',
      messageId: 'esc_see_someone',
    },
    {
      ...P,
      conditionKey: 'prefer_not_to_say',
      label: { en: 'Prefer not to say', ar: 'أفضل عدم الإفصاح' },
      restrictsTags: [],
      restrictsIds: [],
      action: 'warn',
      messageId: 'esc_see_someone',
    },
    {
      ...P,
      conditionKey: 'recent_surgery',
      label: { en: 'Recent surgery in the last 3 months', ar: 'عملية جراحية خلال الأشهر الثلاثة الماضية' },
      restrictsTags: [],
      restrictsIds: [],
      action: 'stop_and_refer',
      messageId: 'esc_see_someone',
    },
    {
      ...P,
      conditionKey: 'balance_concern',
      label: { en: 'A balance problem that makes standing unaided unsafe', ar: 'مشكلة في التوازن تجعل الوقوف دون مساعدة غير آمن' },
      restrictsTags: [],
      restrictsIds: ['lb_ex_sit_stand'],
      action: 'hide',
      messageId: 'esc_see_someone',
    },
    {
      ...P,
      conditionKey: 'pregnancy_or_postpartum',
      label: { en: 'Currently pregnant or within 6 weeks after birth', ar: 'حامل حالياً أو خلال ستة أسابيع بعد الولادة' },
      restrictsTags: [],
      restrictsIds: [],
      action: 'stop_and_refer',
      messageId: 'esc_see_someone',
    },
  ],

  thresholds: [
    { ...P, key: 'nrs_referral', value: 8 },
    { ...P, key: 'amber_window_hours', value: 24 },
    { ...P, key: 'rising_sessions_n', value: 3 },
    { ...P, key: 'review_weeks', value: 6 },
    { ...P, key: 'reminder_days', value: 21 },
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
