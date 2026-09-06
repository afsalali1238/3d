import type { Exercise, Locale } from '../../content/types';
import './exercise.css';

const STILLS: Record<string, string> = {
  lb_ex_pelvic_tilt: '/exercises/pelvic-tilt.jpg',
  lb_ex_knee_to_chest: '/exercises/knee-to-chest.jpg',
  lb_ex_cat_camel: '/exercises/cat-camel.jpg',
  lb_ex_sit_stand: '/exercises/sit-stand.jpg',
  nk_ex_chin_tuck: '/exercises/chin-tuck.jpg',
  nk_ex_neck_turn: '/exercises/neck-turn.jpg',
  sh_ex_blade_squeeze: '/exercises/shoulder-squeeze.jpg',
  hp_ex_bridge: '/exercises/hip-bridge.jpg',
  kn_ex_bend: '/exercises/knee-bend.jpg',
  kn_ex_ankle: '/exercises/ankle-circle.jpg',
};

const MOTION: Record<string, string> = {
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

type Props = {
  exercise: Exercise;
  locale: Locale;
  session?: boolean;
};

export default function ExerciseCard({ exercise: e, locale, session }: Props) {
  const still = STILLS[e.id];
  const motion = MOTION[e.id] ?? 'pulse';
  return (
    <article className={`ex-card${session ? ' session' : ''}`}>
      <div className={`ex-media motion-${motion}`}>
        {still ? (
          <img src={still} alt="" />
        ) : (
          <div className="ex-fallback" />
        )}
        <span className="ex-live" aria-hidden>
          <i />
        </span>
      </div>
      <div className="ex-body">
        <h3>{e.name[locale]}</h3>
        <p className="ex-purpose">{e.purpose[locale]}</p>
        <ol className="ex-steps">
          {e.steps.map((s, i) => (
            <li key={i}>{s[locale]}</li>
          ))}
        </ol>
        <p className="ex-dose">{e.dosage[locale]}</p>
        <p className="ex-stop">{e.safety[locale]}</p>
      </div>
    </article>
  );
}
