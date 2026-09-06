import { useEffect, useRef, useState } from 'react';

type Props = {
  frames: string[];
  captions?: [string, string];
  playing: boolean;
  onToggle: () => void;
};

/** Ping-pong crossfade — reads as a short looping clip. */
export default function MoveClip({ frames, captions, playing, onToggle }: Props) {
  const [t, setT] = useState(0);
  const raf = useRef(0);
  const last = useRef(performance.now());

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    last.current = performance.now();
    const cycle = 2800;
    const tick = (now: number) => {
      const dt = now - last.current;
      last.current = now;
      setT((v) => {
        let n = v + dt / cycle;
        if (n > 1) n -= 1;
        return n;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, frames.length]);

  // 0–0.5 go A→B, 0.5–1 return B→A
  const ping = t < 0.5 ? t * 2 : 1 - (t - 0.5) * 2;
  const ease = ping * ping * (3 - 2 * ping);
  const showB = ease > 0.5;
  const cap = captions ? captions[showB ? 1 : 0] : null;

  return (
    <div className="clip">
      {frames.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          style={{ opacity: i === 0 ? 1 - ease : ease }}
        />
      ))}
      <div className="clip-scrim" />
      <button type="button" className="ex-play" aria-pressed={playing} onClick={onToggle}>
        {playing ? '❚❚' : '▶'}
      </button>
      {cap && <span className="ex-cap">{cap}</span>}
      <div className="clip-bar" aria-hidden>
        <i style={{ width: `${Math.round(ease * 100)}%` }} />
      </div>
    </div>
  );
}
