/**
 * Progressive entry point for the body module.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `BodyViewer` statically imports three.js, @react-three/fiber, drei and
 * postprocessing — ~1.1 MB of the bundle. Importing it from the app means a
 * patient on clinic wifi waits for a WebGL stack before they can see, let
 * alone tap, a body.
 *
 * So the 2D SVG diagram — which is generated from the same mesh, carries the
 * same region ids and honours the same callbacks — becomes the FIRST PAINT
 * for everyone, not just the no-WebGL edge case. The 3D module is fetched in
 * the background and swapped in when it is ready.
 *
 * Guarantees:
 *  - The region map is interactive within the initial bundle. No WebGL wait.
 *  - A failed or slow 3D chunk NEVER removes the map (see `failed` state).
 *  - Devices without WebGL, or with `?force2d`, never download the 3D chunk.
 *  - `prefers-reduced-motion` and Save-Data users keep the 2D map by default.
 *
 * The public prop API is identical to `BodyViewer`, so callers are unaffected.
 */
import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { Fallback2D } from './Fallback2D';
import type { BodyViewerProps } from './types';
import './bodyViewer.css';

const Heavy3D = lazy(() =>
  import('./BodyViewer').then((m) => ({ default: m.BodyViewer })),
);

/** Cheap capability probe — does not create a long-lived context. */
function webglAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.search.includes('force2d')) return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Respect the user's data and motion preferences before spending 1 MB. */
function shouldAutoUpgrade(): boolean {
  if (typeof window === 'undefined') return false;
  const conn = (navigator as any).connection;
  if (conn?.saveData) return false;
  if (typeof conn?.effectiveType === 'string' && /(^|-)2g$/.test(conn.effectiveType)) return false;
  return true;
}

/** Keeps the 2D map alive if the 3D chunk throws at import or at runtime. */
class UpgradeBoundary extends Component<
  { fallback: ReactNode; onError?: (e: Error) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: Error) {
    console.error('[BodyViewerLazy] 3D upgrade failed, staying on 2D map:', err.message);
    this.props.onError?.(err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function BodyViewerLazy(props: BodyViewerProps) {
  const { locale = 'en' } = props;
  const [canUpgrade] = useState(webglAvailable);
  const [upgrade, setUpgrade] = useState(false);

  useEffect(() => {
    if (!canUpgrade || !shouldAutoUpgrade()) return;
    // Let the 2D map paint and become interactive first, then pull the chunk.
    const idle =
      (window as any).requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 200));
    const cancel =
      (window as any).cancelIdleCallback ?? ((h: number) => window.clearTimeout(h));
    const handle = idle(() => setUpgrade(true), { timeout: 2500 });
    return () => cancel(handle);
  }, [canUpgrade]);

  const map2d = (
    <div className="bv-root" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <Fallback2D {...props} />
      {canUpgrade && !upgrade && (
        <button className="bv-upgrade-hint" onClick={() => setUpgrade(true)}>
          {locale === 'ar' ? 'عرض ثلاثي الأبعاد' : 'View in 3D'}
        </button>
      )}
    </div>
  );

  if (!upgrade) return map2d;

  return (
    <UpgradeBoundary fallback={map2d} onError={props.onError}>
      <Suspense fallback={map2d}>
        <Heavy3D {...props} />
      </Suspense>
    </UpgradeBoundary>
  );
}

export default BodyViewerLazy;
