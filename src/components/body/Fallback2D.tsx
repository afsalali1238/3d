/**
 * No-WebGL fallback: an interactive 2D SVG body diagram generated from the
 * same segmented mesh (region outlines are orthographic projections of the
 * 3D regions), with the same region IDs and the same callback contract, so
 * the app layer is completely unaffected.
 */
import { useMemo, useState } from 'react';
import { FALLBACK_SHAPES, FALLBACK_HEIGHT } from './fallbackShapes.gen';
import { REGION_BY_ID, regionLabel } from './regions';
import type { BodyViewerProps } from './types';

const ACCENT = '#00d4a8';

export function Fallback2D(props: BodyViewerProps) {
  const { view, locale = 'en', selectedRegionId, onRegionSelect, onRegionHover } = props;
  const [hover, setHover] = useState<string | null>(null);
  const shapes = FALLBACK_SHAPES[view];

  const viewBox = useMemo(() => {
    const pad = 0.06;
    return `${-0.4 - pad} ${-pad} ${0.8 + 2 * pad} ${FALLBACK_HEIGHT + 2 * pad}`;
  }, []);

  return (
    <div className="bv-fallback2d" role="img" aria-label="2D body diagram">
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {/* flip y: svg grows downward */}
        <g transform={`translate(0 ${FALLBACK_HEIGHT}) scale(1 -1)`}>
          {shapes.map((s) => {
            const r = REGION_BY_ID[s.id];
            if (!r) return null;
            const isSel = selectedRegionId === s.id;
            const isHov = hover === s.id;
            const d = `M ${s.points.map(([px, py]) => `${px} ${py}`).join(' L ')} Z`;
            return (
              <path
                key={s.id}
                d={d}
                fill={isSel ? ACCENT : isHov ? 'rgba(0,212,168,0.45)' : 'rgba(148,163,184,0.28)'}
                stroke={isSel ? ACCENT : 'rgba(148,163,184,0.5)'}
                strokeWidth={0.003}
                style={{ cursor: 'pointer', transition: 'fill 160ms' }}
                role="button"
                tabIndex={0}
                aria-label={regionLabel(s.id, locale)}
                onPointerEnter={() => {
                  setHover(s.id);
                  onRegionHover?.(s.id);
                }}
                onPointerLeave={() => {
                  setHover(null);
                  onRegionHover?.(null);
                }}
                onClick={() => onRegionSelect?.(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onRegionSelect?.(s.id);
                }}
              />
            );
          })}
        </g>
      </svg>
      {(hover || selectedRegionId) && (
        <div className="bv-fallback2d-label">
          {regionLabel((hover ?? selectedRegionId)!, locale)}
        </div>
      )}
      <div className="bv-fallback2d-note">
        {locale === 'ar' ? 'وضع ثنائي الأبعاد (WebGL غير متاح)' : '2D mode (WebGL unavailable)'}
      </div>
    </div>
  );
}
