import { useState } from 'react';
import type { Exercise, Locale } from '../../content/types';
import MotionGuide, { type MotionKind } from './MotionGuide';
import MoveClip from './MoveClip';
import './exercise.css';

const FRAMES: Record<string, string[]> = {
  lb_ex_pelvic_tilt: ['/exercises/pelvic-tilt-2.jpg', '/exercises/pelvic-tilt.jpg'],
  lb_ex_knee_to_chest: ['/exercises/knee-to-chest-2.jpg', '/exercises/knee-to-chest.jpg'],
  lb_ex_cat_camel: ['/exercises/cat-camel.jpg', '/exercises/cat-camel-2.jpg'],
  lb_ex_sit_stand: ['/exercises/sit-stand.jpg', '/exercises/sit-stand-2.jpg'],
  nk_ex_chin_tuck: ['/exercises/chin-tuck-2.jpg', '/exercises/chin-tuck.jpg'],
  nk_ex_neck_turn: ['/exercises/neck-turn-2.jpg', '/exercises/neck-turn.jpg'],
  sh_ex_blade_squeeze: ['/exercises/shoulder-squeeze-2.jpg', '/exercises/shoulder-squeeze.jpg'],
  hp_ex_bridge: ['/exercises/hip-bridge-2.jpg', '/exercises/hip-bridge.jpg'],
  kn_ex_bend: ['/exercises/knee-bend-2.jpg', '/exercises/knee-bend.jpg'],
  kn_ex_ankle: ['/exercises/ankle-circle.jpg', '/exercises/ankle-circle-2.jpg'],
};

const MOTION: Record<string, MotionKind> = {
  lb_ex_pelvic_tilt: 'tilt',
  lb_ex_knee_to_chest: 'fold',
  lb_ex_cat_camel: 'arch',
  lb_ex_sit_stand: 'rise',
  nk_ex_chin_tuck: 'tuck',
  nk_ex_neck_turn: 'turn',
  sh_ex_blade_squeeze: 'squeeze',
  hp_ex_bridge: 'lift',
  kn_ex_bend: 'bend',
  kn_ex_ankle: 'circle',
};

const CAPTION: Record<string, { en: [string, string]; ar: [string, string] }> = {
  lb_ex_pelvic_tilt: { en: ['Rest', 'Flatten'], ar: ['راحة', 'تسطيح'] },
  lb_ex_knee_to_chest: { en: ['Start', 'Draw in'], ar: ['بداية', 'سحب'] },
  lb_ex_cat_camel: { en: ['Round up', 'Let down'], ar: ['تقويس لأعلى', 'إنزال'] },
  lb_ex_sit_stand: { en: ['Sit', 'Stand'], ar: ['جلوس', 'وقوف'] },
  nk_ex_chin_tuck: { en: ['Start', 'Tuck'], ar: ['بداية', 'سحب'] },
  nk_ex_neck_turn: { en: ['Ahead', 'Turn'], ar: ['أمام', 'التفاف'] },
  sh_ex_blade_squeeze: { en: ['Relax', 'Squeeze'], ar: ['استرخاء', 'ضم'] },
  hp_ex_bridge: { en: ['Down', 'Lift'], ar: ['أسفل', 'رفع'] },
  kn_ex_bend: { en: ['Stand', 'Heel up'], ar: ['وقوف', 'كعب لأعلى'] },
  kn_ex_ankle: { en: ['Toes down', 'Toes up'], ar: ['أصابع لأسفل', 'أصابع لأعلى'] },
};

type Props = {
  exercise: Exercise;
  locale: Locale;
  session?: boolean;
};

export default function ExerciseCard({ exercise: e, locale, session }: Props) {
  const frames = FRAMES[e.id] ?? [];
  const motion = MOTION[e.id] ?? 'tilt';
  const captions = CAPTION[e.id]?.[locale];
  const [playing, setPlaying] = useState(true);
  const watch = locale === 'ar' ? 'شاهد الحركة' : 'Watch the movement';

  return (
    <article className={`ex-card${session ? ' session' : ''}`}>
      <div className="ex-stage">
        {frames.length >= 2 ? (
          <MoveClip
            frames={frames}
            captions={captions}
            playing={playing}
            onToggle={() => setPlaying((p) => !p)}
          />
        ) : (
          <div className="clip">{frames[0] && <img src={frames[0]} alt="" style={{ opacity: 1 }} />}</div>
        )}
        <div className="ex-guide">
          <p className="ex-guide-label">{watch}</p>
          <MotionGuide kind={motion} />
        </div>
      </div>
      <div className="ex-body">
        <h3>{e.name[locale]}</h3>
        <p className="ex-purpose">{e.purpose[locale]}</p>
        <ol className="ex-steps">
          {e.steps.map((s, n) => (
            <li key={n}>{s[locale]}</li>
          ))}
        </ol>
        <p className="ex-dose">{e.dosage[locale]}</p>
        <p className="ex-stop">{e.safety[locale]}</p>
      </div>
    </article>
  );
}
