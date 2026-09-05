/**
 * Damped orbit camera + fly-to-region.
 *
 * All motion runs through critically-damped spherical interpolation
 * (theta/phi/radius + target, each with its own smoothed velocity) — never a
 * linear lerp. User orbit input writes to the *goal* spherical coords; the
 * camera itself always follows smoothly.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, invalidate } from '@react-three/fiber';
import * as THREE from 'three';
import { useViewerStore } from './store';

const BODY_CENTER = new THREE.Vector3(0, 0.88, 0);
const FULL_DIST = 3.1;
const MIN_DIST = 0.28;
const MAX_DIST = 4.2;
const MIN_PHI = Math.PI / 2 - THREE.MathUtils.degToRad(35);
const MAX_PHI = Math.PI / 2 + THREE.MathUtils.degToRad(35);
const IDLE_MS = 8000;
const AUTO_ROTATE_SPEED = 0.15; // rad/s

function dampAngle(current: number, target: number, lambda: number, dt: number) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-lambda * dt));
}

export function CameraRig({ enabled = true }: { enabled?: boolean }) {
  const { camera, gl, size } = useThree();
  const cmd = useViewerStore((s) => s.cameraCommand);
  const setInteracting = useViewerStore((s) => s.setInteracting);
  const bumpInteraction = useViewerStore((s) => s.bumpInteraction);

  const state = useRef({
    // goal spherical
    theta: 0,
    phi: Math.PI / 2 - 0.06,
    radius: FULL_DIST,
    target: BODY_CENTER.clone(),
    // current (smoothed)
    cTheta: 0,
    cPhi: Math.PI / 2 - 0.06,
    cRadius: FULL_DIST,
    cTarget: BODY_CENTER.clone(),
    lastNonce: -1,
    pointers: new Map<number, { x: number; y: number }>(),
    pinchDist: 0,
    settled: false,
  });

  // aspect-aware framing distance so the full body fits with ~8% padding
  const frameDistance = useMemo(() => {
    const persp = camera as THREE.PerspectiveCamera;
    const fov = THREE.MathUtils.degToRad(persp.fov ?? 35);
    const bodyH = 1.72 * 1.14;
    const distV = bodyH / 2 / Math.tan(fov / 2);
    const aspect = size.width / Math.max(1, size.height);
    const bodyW = 0.75 * 1.15;
    const distH = bodyW / 2 / (Math.tan(fov / 2) * aspect);
    return THREE.MathUtils.clamp(Math.max(distV, distH), 1.2, MAX_DIST);
  }, [camera, size.width, size.height]);

  useEffect(() => {
    const s = state.current;
    if (Math.abs(s.radius - FULL_DIST) < 0.001 || s.radius > frameDistance * 0.85) {
      s.radius = frameDistance;
    }
    invalidate();
  }, [frameDistance]);

  // external commands (reset / face / focus)
  useEffect(() => {
    if (!cmd) return;
    const s = state.current;
    if (cmd.nonce === s.lastNonce) return;
    s.lastNonce = cmd.nonce;
    if (cmd.kind === 'reset') {
      s.theta = 0;
      s.phi = Math.PI / 2 - 0.06;
      s.radius = frameDistance;
      s.target.copy(BODY_CENTER);
    } else if (cmd.kind === 'face') {
      s.theta = cmd.view === 'anterior' ? 0 : Math.PI;
      s.phi = Math.PI / 2 - 0.06;
    } else if (cmd.kind === 'focus') {
      s.target.set(cmd.target[0], cmd.target[1], cmd.target[2]);
      s.radius = THREE.MathUtils.clamp(cmd.distance, MIN_DIST, MAX_DIST);
      // keep the current side (front/back) while flying in
      const facing = Math.cos(s.theta) >= 0 ? 0 : Math.PI;
      const dz = cmd.target[2];
      // bias toward the hemisphere the region actually lives in
      if (Math.abs(dz) > 0.03) s.theta = dz >= 0 ? 0 : Math.PI;
      else s.theta = facing;
    }
    s.settled = false;
    invalidate();
  }, [cmd, frameDistance]);

  // pointer + wheel input on the canvas
  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement;
    const s = state.current;

    const onPointerDown = (e: PointerEvent) => {
      el.setPointerCapture?.(e.pointerId);
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        s.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      setInteracting(true);
      bumpInteraction();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!s.pointers.has(e.pointerId)) return;
      const prev = s.pointers.get(e.pointerId)!;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      bumpInteraction();
      if (s.pointers.size === 1) {
        s.theta -= (dx / el.clientHeight) * 3.6;
        s.phi = THREE.MathUtils.clamp(s.phi - (dy / el.clientHeight) * 3.6, MIN_PHI, MAX_PHI);
        s.settled = false;
        invalidate();
      } else if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (s.pinchDist > 0) {
          s.radius = THREE.MathUtils.clamp(s.radius * (s.pinchDist / d), MIN_DIST, MAX_DIST);
          s.settled = false;
          invalidate();
        }
        s.pinchDist = d;
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      s.pointers.delete(e.pointerId);
      if (s.pointers.size === 0) setInteracting(false);
      bumpInteraction();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      s.radius = THREE.MathUtils.clamp(
        s.radius * Math.exp(e.deltaY * 0.0011),
        MIN_DIST,
        MAX_DIST,
      );
      s.settled = false;
      bumpInteraction();
      invalidate();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [enabled, gl, setInteracting, bumpInteraction]);

  useFrame((_, rawDt) => {
    const s = state.current;
    const dt = Math.min(rawDt, 1 / 20);

    // idle auto-rotate
    const store = useViewerStore.getState();
    const idle = Date.now() - store.lastInteraction > IDLE_MS;
    if (idle && !store.interacting && enabled && Math.abs(s.radius - frameDistance) < 0.4) {
      s.theta += AUTO_ROTATE_SPEED * dt;
      s.settled = false;
    }

    const L = 6.2; // damping lambda ~ 800ms fly-to feel
    s.cTheta = dampAngle(s.cTheta, s.theta, L, dt);
    s.cPhi = THREE.MathUtils.damp(s.cPhi, s.phi, L, dt);
    s.cRadius = THREE.MathUtils.damp(s.cRadius, s.radius, L, dt);
    s.cTarget.x = THREE.MathUtils.damp(s.cTarget.x, s.target.x, L, dt);
    s.cTarget.y = THREE.MathUtils.damp(s.cTarget.y, s.target.y, L, dt);
    s.cTarget.z = THREE.MathUtils.damp(s.cTarget.z, s.target.z, L, dt);

    const sin = Math.sin(s.cPhi);
    camera.position.set(
      s.cTarget.x + s.cRadius * sin * Math.sin(s.cTheta),
      s.cTarget.y + s.cRadius * Math.cos(s.cPhi),
      s.cTarget.z + s.cRadius * sin * Math.cos(s.cTheta),
    );
    camera.lookAt(s.cTarget);

    const settledNow =
      Math.abs(s.cRadius - s.radius) < 0.0005 &&
      Math.abs(s.cPhi - s.phi) < 0.0005 &&
      Math.abs(dampAngle(s.cTheta, s.theta, 1000, 1) - s.cTheta) < 0.0005 &&
      s.cTarget.distanceTo(s.target) < 0.0005;
    if (!settledNow || idle) invalidate();
    s.settled = settledNow;
  });

  return null;
}
