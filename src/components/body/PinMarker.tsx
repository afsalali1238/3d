/**
 * 3D pain pin: a glowing marker welded to the skin surface.
 *  - oriented along the surface normal, offset 5 mm so it never clips
 *  - scales inversely with camera distance → constant screen size
 *  - draggable: dragging re-raycasts against the body so the pin slides
 *    along the skin
 *  - intensity 1..5 colour-graded yellow → orange → red
 */
import { useMemo, useRef } from 'react';
import { useFrame, invalidate } from '@react-three/fiber';
import * as THREE from 'three';
import type { PainPin } from './types';

const COLOR_LOW = new THREE.Color('#ffd23f');
const COLOR_MID = new THREE.Color('#ff8c1a');
const COLOR_HIGH = new THREE.Color('#ff3b30');

export function intensityColor(intensity: number): THREE.Color {
  const t = THREE.MathUtils.clamp((intensity - 1) / 4, 0, 1);
  const c = new THREE.Color();
  if (t < 0.5) c.lerpColors(COLOR_LOW, COLOR_MID, t * 2);
  else c.lerpColors(COLOR_MID, COLOR_HIGH, (t - 0.5) * 2);
  return c;
}

const NORMAL_OFFSET = 0.005; // 0.5 cm along the normal

export function PinMarker({
  pin,
  active,
  pulsing,
  onPointerDown,
}: {
  pin: PainPin;
  active?: boolean;
  pulsing?: boolean;
  onPointerDown?: (e: any) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const color = useMemo(() => intensityColor(pin.intensity), [pin.intensity]);

  const { position, quaternion } = useMemo(() => {
    const n = new THREE.Vector3(...pin.normal).normalize();
    const p = new THREE.Vector3(...pin.point).addScaledVector(n, NORMAL_OFFSET);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    return { position: p, quaternion: q };
  }, [pin.point, pin.normal]);

  useFrame(({ camera, clock }) => {
    const g = groupRef.current;
    if (!g) return;
    // constant screen size: scale with camera distance
    const d = camera.position.distanceTo(g.position);
    let s = d * 0.042;
    if (pulsing) {
      s *= 1 + 0.12 * Math.sin(clock.elapsedTime * 4.2);
      invalidate();
    }
    g.scale.setScalar(s);
  });

  return (
    <group
      ref={groupRef}
      position={position}
      quaternion={quaternion}
      onPointerDown={onPointerDown}
    >
      {/* stem */}
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.045, 0.012, 0.7, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.9} />
      </mesh>
      {/* head — emissive enough to catch the bloom pass */}
      <mesh position={[0, 0.82, 0]}>
        <sphereGeometry args={[0.24, 18, 14]} />
        <meshBasicMaterial
          color={active ? color.clone().multiplyScalar(1.6) : color}
          toneMapped={false}
        />
      </mesh>
      {/* base ring on the skin */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[0.16, 0.26, 24]} />
        <meshBasicMaterial
          color={color}
          toneMapped={false}
          transparent
          opacity={0.55}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* generous invisible hit target for dragging */}
      <mesh position={[0, 0.5, 0]} visible={false}>
        <sphereGeometry args={[0.75, 8, 6]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}
