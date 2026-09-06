/**
 * Side-view line figures. Person faces LEFT.
 * Each loop is the real joint direction of that exercise.
 */
export type MotionKind =
  | 'tilt'
  | 'fold'
  | 'arch'
  | 'rise'
  | 'tuck'
  | 'turn'
  | 'squeeze'
  | 'lift'
  | 'bend'
  | 'circle';

export default function MotionGuide({ kind }: { kind: MotionKind }) {
  return (
    <div className={`mg mg-${kind}`} aria-hidden>
      <svg viewBox="0 0 120 140" className="mg-svg">
        <line x1="10" y1="128" x2="110" y2="128" stroke="#2a3442" strokeWidth="3" />
        {kind === 'tilt' && <Tilt />}
        {kind === 'fold' && <Fold />}
        {kind === 'arch' && <Arch />}
        {kind === 'rise' && <Rise />}
        {kind === 'tuck' && <Tuck />}
        {kind === 'turn' && <Turn />}
        {kind === 'squeeze' && <Squeeze />}
        {kind === 'lift' && <Lift />}
        {kind === 'bend' && <Bend />}
        {kind === 'circle' && <CircleAnkle />}
      </svg>
    </div>
  );
}

const st = {
  fill: 'none',
  stroke: '#00d4a8',
  strokeWidth: 4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Head({ cx, cy }: { cx: number; cy: number }) {
  return <circle cx={cx} cy={cy} r={8} fill="#00d4a8" />;
}

/** Supine, head LEFT. Pelvis tucks → low back flattens to the floor. */
function Tilt() {
  return (
    <g>
      <Head cx={28} cy={86} />
      <path d="M36 88 L62 90" style={st} />
      <g className="mg-pelvis">
        <path d="M62 90 L78 88 L92 92" style={st} />
        <path d="M78 88 L74 118 M92 92 L96 118" style={st} />
      </g>
    </g>
  );
}

/** Supine, head LEFT. Near knee draws toward the chest (toward the head). */
function Fold() {
  return (
    <g>
      <Head cx={26} cy={84} />
      <path d="M34 88 L58 92 L58 118" style={st} />
      <g className="mg-thigh">
        <path d="M58 92 L92 96" style={st} />
        <path d="M92 96 L88 118" style={st} />
      </g>
    </g>
  );
}

/** All fours, head LEFT. Cat = mid-back UP; camel = belly DOWN. */
function Arch() {
  return (
    <g>
      <Head cx={22} cy={58} />
      <path d="M28 66 L40 70" style={st} />
      <path className="mg-back" d="M40 70 Q60 70 84 70" style={st} />
      <path d="M40 70 L32 104 M84 70 L92 104 M28 66 L18 92" style={st} />
    </g>
  );
}

/** Sit → stand. Hips extend, body rises. */
function Rise() {
  return (
    <g className="mg-rise-g">
      <rect x="62" y="86" width="28" height="36" rx="3" fill="none" stroke="#2a3442" strokeWidth="3" />
      <Head cx={48} cy={36} />
      <path d="M48 44 L48 78 L48 112" style={st} />
      <path d="M48 58 L68 70 M48 112 L38 112 M48 112 L58 112" style={st} />
    </g>
  );
}

/** Profile facing LEFT. Chin slides BACK (to the right), not down. */
function Tuck() {
  return (
    <g>
      <g className="mg-head-tuck">
        <Head cx={40} cy={32} />
      </g>
      <path d="M48 38 L52 86 L38 120 M52 86 L66 120 M52 54 L34 68 M52 54 L72 64" style={st} />
    </g>
  );
}

/** Head turns to look over the LEFT shoulder, then returns ahead. */
function Turn() {
  return (
    <g>
      <ellipse className="mg-head-turn" cx="52" cy="32" rx="9" ry="10" fill="#00d4a8" />
      <path d="M52 42 L52 86 L38 120 M52 86 L66 120 M52 56 L34 68 M52 56 L72 64" style={st} />
    </g>
  );
}

/** Blades come BACK and slightly DOWN — never a shrug. */
function Squeeze() {
  return (
    <g>
      <Head cx={50} cy={28} />
      <path d="M50 36 L50 86 L38 120 M50 86 L64 120" style={st} />
      <g className="mg-scaps">
        <path d="M50 48 L28 62 M50 48 L72 62" style={st} />
      </g>
    </g>
  );
}

/** Hips lift UP off the floor. */
function Lift() {
  return (
    <g>
      <Head cx={26} cy={90} />
      <g className="mg-hips">
        <path d="M34 92 L70 88 L88 92" style={st} />
        <path d="M70 88 L66 118 M88 92 L94 118" style={st} />
      </g>
    </g>
  );
}

/** Standing. Heel comes UP toward the buttock (knee flexion), not a lunge. */
function Bend() {
  return (
    <g>
      <rect x="18" y="48" width="16" height="72" rx="2" fill="none" stroke="#2a3442" strokeWidth="3" />
      <Head cx={58} cy={22} />
      <path d="M58 30 L58 70 L44 48" style={st} />
      <path d="M58 70 L58 120" style={st} />
      <g className="mg-heel">
        <path d="M58 70 L78 118" style={st} />
      </g>
    </g>
  );
}

/** Foot circles around the ankle. */
function CircleAnkle() {
  return (
    <g>
      <Head cx={40} cy={28} />
      <path d="M40 36 L40 72 L36 112" style={st} />
      <path d="M40 72 L58 90" style={st} />
      <g className="mg-foot">
        <path d="M58 90 L78 96" style={st} />
      </g>
    </g>
  );
}
