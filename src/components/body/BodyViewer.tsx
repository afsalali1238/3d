/**
 * <BodyViewer /> — self-contained interactive 3D human body module.
 *
 * The only surface the rest of the app sees is the prop/callback API in
 * ./types.ts. No Three.js types leak out; the component owns no domain logic
 * — it reports *where*, the app decides *what that means*.
 */
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree, invalidate } from '@react-three/fiber';
import { ContactShadows, Environment, Html, useProgress } from '@react-three/drei';
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  SMAA,
  Vignette,
} from '@react-three/postprocessing';
import * as THREE from 'three';
import { BodyModel, PlaceholderBody } from './BodyModel';
import { CameraRig } from './CameraRig';
import { PinMarker } from './PinMarker';
import { Fallback2D } from './Fallback2D';
import { useRegionPicker, type RegionHit } from './useRegionPicker';
import { useViewerStore } from './store';
import { REGIONS, REGION_BY_ID, regionLabel } from './regions';
import type { SkinMaterialHandle } from './skinMaterial';
import type { BodyViewerProps, PainPin } from './types';
import './bodyViewer.css';

/* ------------------------------------------------------------------ perf */

function detectQuality(): { post: boolean; dpr: [number, number] } {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  const lowEnd = cores <= 4 && dpr > 1.5; // typical low/mid mobile
  return { post: !lowEnd, dpr: [1, 2] };
}

function webglAvailable(): boolean {
  // ?force2d exercises the no-WebGL path for testing
  if (typeof window !== 'undefined' && window.location.search.includes('force2d')) return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Drops render resolution if the running average frame cost gets heavy. */
function AdaptiveDpr() {
  const setDpr = useThree((s) => s.setDpr);
  const samples = useRef<number[]>([]);
  const lowered = useRef(false);
  useFrame((_, dt) => {
    if (lowered.current) return;
    samples.current.push(dt * 1000);
    if (samples.current.length >= 60) {
      const avg = samples.current.reduce((a, b) => a + b, 0) / samples.current.length;
      samples.current.length = 0;
      if (avg > 20 && window.devicePixelRatio > 1.5) {
        lowered.current = true;
        setDpr(1.5);
      }
    }
  });
  return null;
}

/* ------------------------------------------------------- loading skeleton */

function LoaderOverlay() {
  const { progress, active } = useProgress();
  if (!active && progress >= 100) return null;
  return (
    <div className="bv-loader">
      <svg viewBox="0 0 100 220" className="bv-loader-silhouette" aria-hidden>
        <circle cx="50" cy="24" r="14" />
        <path d="M32 44 h36 l6 52 h-10 l-4 -34 v96 h-9 l-2.5 -52 h-1 L45 158 h-9 V62 l-4 34 h-10 z" />
      </svg>
      <div className="bv-loader-bar">
        <div className="bv-loader-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="bv-loader-pct">{Math.round(progress)}%</div>
    </div>
  );
}

/* -------------------------------------------------------- error boundary */

class ModelBoundary extends Component<
  { fallback: ReactNode; onError?: (e: Error) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: Error) {
    console.error('[BodyViewer] model failed to load:', err.message);
    this.props.onError?.(err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** push a label anchor out of the body toward the region's facing side */
function labelAnchor(region: { focusTarget: [number, number, number]; view: string; side: string }) {
  const [x, y, z] = region.focusTarget;
  const zPush = region.view === 'posterior' ? -0.14 : region.view === 'anterior' ? 0.14 : z >= 0 ? 0.12 : -0.12;
  const xPush = region.side === 'left' ? 0.06 : region.side === 'right' ? -0.06 : 0;
  return [x + xPush, y + 0.05, z + zPush] as [number, number, number];
}

/* ------------------------------------------------------------ inner scene */

type SceneProps = BodyViewerProps & {
  containerRef: React.RefObject<HTMLDivElement | null>;
};

function Scene(props: SceneProps) {
  const {
    gender,
    view,
    selectedRegionId,
    pins,
    mode,
    locale = 'en',
    resetSignal,
    onRegionHover,
    onRegionSelect,
    onPointConfirm,
    onReady,
    onError,
    containerRef,
  } = props;

  const meshRef = useRef<THREE.Mesh>(null);
  const handleRef = useRef<SkinMaterialHandle | null>(null);
  const { pick, eventToNdc, resolveHit } = useRegionPicker(meshRef);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  const sendCamera = useViewerStore((s) => s.sendCamera);
  const setHover = useViewerStore((s) => s.setHover);
  const hoverRegionId = useViewerStore((s) => s.hoverRegionId);
  const interacting = useViewerStore((s) => s.interacting);
  const pendingPoint = useViewerStore((s) => s.pendingPoint);
  const setPendingPoint = useViewerStore((s) => s.setPendingPoint);
  const draggingPinId = useViewerStore((s) => s.draggingPinId);
  const setDraggingPin = useViewerStore((s) => s.setDraggingPin);
  const nonce = useRef(1);

  const selectedRegion = selectedRegionId ? REGION_BY_ID[selectedRegionId] : null;

  /* view / reset / focus commands ------------------------------------- */
  useEffect(() => {
    sendCamera({ kind: 'face', view, nonce: nonce.current++ });
  }, [view, sendCamera]);

  useEffect(() => {
    if (resetSignal !== undefined && resetSignal > 0) {
      sendCamera({ kind: 'reset', nonce: nonce.current++ });
    }
  }, [resetSignal, sendCamera]);

  useEffect(() => {
    if (selectedRegion) {
      sendCamera({
        kind: 'focus',
        target: selectedRegion.focusTarget,
        distance: selectedRegion.focusDistance,
        nonce: nonce.current++,
      });
    } else {
      sendCamera({ kind: 'reset', nonce: nonce.current++ });
    }
  }, [selectedRegion, sendCamera]);

  /* shader uniforms ----------------------------------------------------- */
  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;
    h.uniforms.uActiveRegion.value = selectedRegion?.numericId ?? -1;
    h.uniforms.uDimOthers.value = selectedRegion ? 1 : 0;
    invalidate();
  }, [selectedRegion]);

  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;
    const r = hoverRegionId ? REGION_BY_ID[hoverRegionId] : null;
    h.uniforms.uHoverRegion.value = r?.numericId ?? -1;
    invalidate();
  }, [hoverRegionId]);

  // drive pulse time + keep rendering while a region pulses
  useFrame(({ clock }) => {
    const h = handleRef.current;
    if (!h) return;
    h.uniforms.uTime.value = clock.elapsedTime;
    if (selectedRegion || hoverRegionId) invalidate();
  });

  const onModelReady = useCallback(
    (h: SkinMaterialHandle) => {
      handleRef.current = h;
      h.uniforms.uActiveRegion.value = selectedRegion?.numericId ?? -1;
      h.uniforms.uDimOthers.value = selectedRegion ? 1 : 0;
      onReady?.();
      invalidate();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onReady],
  );

  /* hover (desktop, throttled ~30 Hz) ----------------------------------- */
  const lastHoverT = useRef(0);
  const handlePointerMove = useCallback(
    (e: any) => {
      if (mode === 'explore') return;
      if (e.pointerType === 'touch') return;
      const now = performance.now();
      if (now - lastHoverT.current < 33) return;
      lastHoverT.current = now;
      if (interacting) return;
      const hit = resolveHit(e as THREE.Intersection);
      setHover(hit ? hit.region.id : null);
      if (hit) onRegionHover?.(hit.region.id);
      gl.domElement.style.cursor = hit ? 'pointer' : 'grab';
    },
    [mode, interacting, resolveHit, setHover, onRegionHover, gl],
  );

  const handlePointerOut = useCallback(() => {
    setHover(null);
    onRegionHover?.(null);
    gl.domElement.style.cursor = 'grab';
  }, [setHover, onRegionHover, gl]);

  /* click: select region or drop pin ------------------------------------ */
  const downPos = useRef<[number, number] | null>(null);
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      downPos.current = [e.clientX, e.clientY];
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [gl]);

  const handleClick = useCallback(
    (e: any) => {
      // suppress click-after-drag
      if (downPos.current) {
        const dx = e.clientX - downPos.current[0];
        const dy = e.clientY - downPos.current[1];
        if (Math.hypot(dx, dy) > 6) return;
      }
      const [nx, ny] = eventToNdc(e.clientX, e.clientY, gl.domElement);
      const hit = pick(nx, ny, true);
      if (!hit) return;
      navigator.vibrate?.(10);
      if (mode === 'pinpoint' && selectedRegion) {
        setPendingPoint({
          regionId: hit.region.id,
          point: hit.point.toArray() as [number, number, number],
          normal: hit.normal.toArray() as [number, number, number],
          uv: hit.uv,
        });
        invalidate();
      } else if (mode === 'select' || mode === 'pinpoint') {
        onRegionSelect?.(hit.region.id);
      }
    },
    [mode, selectedRegion, pick, eventToNdc, gl, onRegionSelect, setPendingPoint],
  );

  /* pin dragging --------------------------------------------------------- */
  useEffect(() => {
    if (!draggingPinId) return;
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      const [nx, ny] = eventToNdc(e.clientX, e.clientY, el);
      const hit = pick(nx, ny, false);
      if (hit && pendingPoint && draggingPinId === '__pending__') {
        setPendingPoint({
          regionId: hit.region.id,
          point: hit.point.toArray() as [number, number, number],
          normal: hit.normal.toArray() as [number, number, number],
          uv: hit.uv,
        });
        invalidate();
      }
    };
    const up = () => setDraggingPin(null);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
  }, [draggingPinId, pendingPoint, pick, eventToNdc, gl, setPendingPoint, setDraggingPin]);

  /* pins ------------------------------------------------------------------ */
  const allPins: PainPin[] = pins ?? [];
  const pendingPin: PainPin | null = pendingPoint
    ? {
        id: '__pending__',
        regionId: pendingPoint.regionId,
        point: pendingPoint.point,
        normal: pendingPoint.normal,
        intensity: 3,
      }
    : null;

  /* key light direction in view space for the SSS term -------------------- */
  const keyDir = useMemo(() => new THREE.Vector3(-1.6, 2.6, 2.2).normalize(), []);
  useFrame(() => {
    const h = handleRef.current;
    if (!h) return;
    h.uniforms.uKeyLightDirView.value
      .copy(keyDir)
      .transformDirection(camera.matrixWorldInverse);
  });

  const breathing = !interacting && !draggingPinId;

  return (
    <>
      <CameraRig enabled />
      <AdaptiveDpr />

      {/* three-point rig over the HDRI ambient */}
      <directionalLight
        position={[-1.6, 2.6, 2.2]}
        intensity={2.0}
        color="#fff4e6"
        castShadow={false}
      />
      <directionalLight position={[1.8, 1.4, 1.6]} intensity={0.6} color="#e6f0ff" />
      <directionalLight position={[0.4, 2.8, -2.4]} intensity={1.5} color="#ffffff" />

      <Environment files="/textures/studio.hdr" environmentIntensity={0.6} background={false} />

      <ModelBoundary
        onError={onError}
        fallback={
          <>
            <PlaceholderBody label={`missing model /models/body-${gender}.glb`} />
            <Html center position={[0, 1.78, 0]}>
              <div className="bv-placeholder-tag">Model asset missing — see ASSET-SPEC.md</div>
            </Html>
          </>
        }
      >
        <Suspense fallback={null}>
          <BodyModel
            key={gender}
            ref={meshRef}
            gender={gender}
            breathing={breathing}
            onReady={onModelReady}
            onPointerMove={handlePointerMove}
            onPointerOut={handlePointerOut}
            onClick={handleClick}
          />
        </Suspense>
      </ModelBoundary>

      <ContactShadows
        position={[0, 0.002, 0]}
        opacity={0.5}
        blur={2.5}
        far={1.4}
        resolution={512}
        scale={2.4}
        frames={1}
      />

      {/* committed pins */}
      {allPins.map((p) => (
        <PinMarker key={p.id} pin={p} />
      ))}
      {/* pending (draggable) pin */}
      {pendingPin && (
        <PinMarker
          pin={pendingPin}
          active
          pulsing
          onPointerDown={(e: any) => {
            e.stopPropagation();
            setDraggingPin('__pending__');
          }}
        />
      )}

      {/* floating label anchored to the selected region, pushed out of the
          surface toward the hemisphere the region faces so it isn't buried */}
      {selectedRegion && !pendingPin && (
        <Html
          position={labelAnchor(selectedRegion)}
          center
          zIndexRange={[20, 10]}
          className="bv-region-html"
        >
          <div className="bv-region-tag" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
            {regionLabel(selectedRegion.id, locale)}
          </div>
        </Html>
      )}
    </>
  );
}

/* --------------------------------------------------------------- effects */

function Effects({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  if (typeof window !== 'undefined' && window.location.search.includes('nofx')) return null;
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      {/* threshold above 1.0: skin (tone-mapped, <=1) can never bloom — only
          the tone-mapping-exempt pin markers and highlight glow do */}
      <Bloom intensity={0.25} luminanceThreshold={1.05} luminanceSmoothing={0.15} mipmapBlur />
      <Vignette eskil={false} offset={0.18} darkness={0.55} />
      <ChromaticAberration
        offset={[0.00025, 0.00025] as any}
        radialModulation={false}
        modulationOffset={0}
      />
    </EffectComposer>
  );
}

/* ------------------------------------------------------------- component */

export function BodyViewer(props: BodyViewerProps) {
  const { locale = 'en', mode, onPointConfirm, gender } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [quality] = useState(detectQuality);
  const [hasWebgl] = useState(webglAvailable);

  const pendingPoint = useViewerStore((s) => s.pendingPoint);
  const setPendingPoint = useViewerStore((s) => s.setPendingPoint);

  // clear stale pending point when leaving pinpoint mode
  useEffect(() => {
    if (mode !== 'pinpoint' && pendingPoint) setPendingPoint(null);
  }, [mode, pendingPoint, setPendingPoint]);

  if (!hasWebgl) {
    return (
      <div ref={containerRef} className="bv-root" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <Fallback2D {...props} />
      </div>
    );
  }

  const confirmLabels =
    locale === 'ar'
      ? {
          q: 'هل هذا هو مكان الألم بالضبط؟',
          yes: 'نعم، هذا هو',
          adjust: 'تعديل',
          elsewhere: 'إنه في مكان آخر',
        }
      : {
          q: 'Is this exactly where it hurts?',
          yes: "Yes, that's it",
          adjust: 'Adjust',
          elsewhere: "It's somewhere else",
        };

  return (
    <div ref={containerRef} className="bv-root" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <Canvas
        frameloop="demand"
        dpr={quality.dpr}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
          outputColorSpace: THREE.SRGBColorSpace,
          powerPreference: 'high-performance',
        }}
        camera={{ fov: 35, near: 0.05, far: 30, position: [0, 0.92, 3.1] }}
        style={{ touchAction: 'none' }}
        aria-label="Interactive 3D human body"
      >
        <Scene {...props} containerRef={containerRef} />
        <Effects enabled={quality.post} />
      </Canvas>

      <LoaderOverlay />

      {/* keyboard access: every region is a named, tabbable ARIA target */}
      <div className="bv-sr-regions" aria-label={locale === 'ar' ? 'مناطق الجسم' : 'Body regions'} role="listbox">
        {REGIONS.map((r) => (
          <button
            key={r.id}
            role="option"
            aria-selected={props.selectedRegionId === r.id}
            onClick={() => props.onRegionSelect?.(r.id)}
            onFocus={() => props.onRegionHover?.(r.id)}
            onBlur={() => props.onRegionHover?.(null)}
          >
            {regionLabel(r.id, locale)}
          </button>
        ))}
      </div>

      {/* Stage 4 — confirm overlay */}
      {pendingPoint && mode === 'pinpoint' && (
        <div className="bv-confirm" role="dialog" aria-label={confirmLabels.q}>
          <div className="bv-confirm-q">{confirmLabels.q}</div>
          <div className="bv-confirm-actions">
            <button
              className="bv-btn bv-btn-primary"
              onClick={() => {
                navigator.vibrate?.(10);
                onPointConfirm?.({
                  regionId: pendingPoint.regionId,
                  point: pendingPoint.point,
                  normal: pendingPoint.normal,
                  uv: pendingPoint.uv,
                  gender,
                });
                setPendingPoint(null);
              }}
            >
              {confirmLabels.yes}
            </button>
            <button className="bv-btn" onClick={() => setPendingPoint(null)}>
              {confirmLabels.adjust}
            </button>
            <button
              className="bv-btn"
              onClick={() => {
                setPendingPoint(null);
                props.onRegionClear?.();
              }}
            >
              {confirmLabels.elsewhere}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default BodyViewer;
