/** Looping line-figure that shows the movement itself. */
import type { CSSProperties } from 'react';

type Kind =
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

export default function MotionGuide({ kind }: { kind: Kind }) {
  return (
    <div className={`mg mg-${kind}`} aria-hidden>
      <svg viewBox="0 0 120 140" className="mg-svg">
        <defs>
          <linearGradient id="mgstroke" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7ff3d6" />
            <stop offset="100%" stopColor="#00d4a8" />
          </linearGradient>
        </defs>
        {kind === 'tilt' && <Tilt />}
        {kind === 'fold' && <Fold />}
        {kind === 'arch' && <Arch />}
        {kind === 'rise' && <Rise />}
        {kind === 'tuck' && <Tuck />}
        {kind === 'turn' && <Turn />}
        {kind === 'squeeze' && <Squeeze />}
        {kind === 'lift' && <Lift />}
        {kind === 'bend' && <Bend />}
        {kind === 'circle' && <Circle />}
      </svg>
    </div>
  );
}

const S: CSSProperties = { fill: 'none', stroke: 'url(#mgstroke)', strokeWidth: 4, strokeLinecap: 'round', strokeLinejoin: 'round' };

function Tilt() {
  return (
    <g>
      <line x1="18" y1="118" x2="102" y2="118" stroke="#334155" strokeWidth="3" />
      <circle className="mg-head" cx="86" cy="42" r="8" fill="#00d4a8" />
      <path d="M78 48 L58 58 L40 58" style={S} />
      <path className="mg-spine" d="M58 58 L52 86 L70 86 L86 48" style={S} />
      <path d="M40 58 L36 86 M70 86 L74 118 M52 86 L48 118" style={S} />
    </g>
  );
}
function Fold() {
  return (
    <g>
      <line x1="16" y1="118" x2="104" y2="118" stroke="#334155" strokeWidth="3" />
      <circle cx="32" cy="40" r="8" fill="#00d4a8" />
      <path d="M38 46 L52 70 L52 96" style={S} />
      <path className="mg-leg" d="M52 70 L78 52" style={S} />
      <path d="M52 96 L78 118 M52 96 L36 118" style={S} />
    </g>
  );
}
function Arch() {
  return (
    <g>
      <circle className="mg-head" cx="28" cy="42" r="8" fill="#00d4a8" />
      <path className="mg-spine" d="M34 50 L60 58 L90 50" style={S} />
      <path d="M60 58 L48 96 M60 58 L78 96 M34 50 L22 78 M90 50 L102 78" style={S} />
    </g>
  );
}
function Rise() {
  return (
    <g>
      <rect x="70" y="78" width="32" height="40" rx="4" fill="none" stroke="#334155" strokeWidth="3" />
      <circle className="mg-head" cx="44" cy="28" r="8" fill="#00d4a8" />
      <path className="mg-body" d="M44 36 L44 72 L44 110" style={S} />
      <path d="M44 50 L62 64 M44 110 L32 110 M44 110 L56 110" style={S} />
    </g>
  );
}
function Tuck() {
  return (
    <g>
      <circle className="mg-head" cx="60" cy="32" r="10" fill="#00d4a8" />
      <path d="M60 42 L60 88 L44 118 M60 88 L76 118 M60 56 L40 70 M60 56 L80 70" style={S} />
    </g>
  );
}
function Turn() {
  return (
    <g>
      <ellipse className="mg-head" cx="60" cy="32" rx="10" ry="10" fill="#00d4a8" />
      <path d="M60 42 L60 88 L44 118 M60 88 L76 118 M60 56 L38 68 M60 56 L82 68" style={S} />
    </g>
  );
}
function Squeeze() {
  return (
    <g>
      <circle cx="60" cy="28" r="8" fill="#00d4a8" />
      <path className="mg-arms" d="M60 40 L60 86 L44 118 M60 86 L76 118 M60 50 L34 66 M60 50 L86 66" style={S} />
    </g>
  );
}
function Lift() {
  return (
    <g>
      <line x1="16" y1="118" x2="104" y2="118" stroke="#334155" strokeWidth="3" />
      <circle cx="88" cy="50" r="8" fill="#00d4a8" />
      <path className="mg-hips" d="M80 56 L50 70 L34 70 L50 96 L78 96 L88 56" style={S} />
      <path d="M34 70 L28 96 M50 96 L46 118 M78 96 L82 118" style={S} />
    </g>
  );
}
function Bend() {
  return (
    <g>
      <rect x="18" y="40" width="18" height="78" rx="3" fill="none" stroke="#334155" strokeWidth="3" />
      <circle cx="64" cy="22" r="8" fill="#00d4a8" />
      <path d="M64 30 L64 70" style={S} />
      <path className="mg-leg" d="M64 70 L64 118" style={S} />
      <path d="M64 48 L36 56" style={S} />
    </g>
  );
}
function Circle() {
  return (
    <g>
      <circle cx="48" cy="28" r="8" fill="#00d4a8" />
      <path d="M48 36 L48 70 L36 110 M48 70 L62 92" style={S} />
      <circle className="mg-foot" cx="78" cy="104" r="7" fill="none" stroke="#00d4a8" strokeWidth="3" />
    </g>
  );
}
