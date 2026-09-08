/**
 * Loads the segmented anatomical GLB and applies the patched skin material.
 * GLTFLoader is wired with Draco + KTX2 + Meshopt decoders (self-hosted in
 * /public/decoders) so production-compressed assets can be swapped in without
 * code changes. If the GLB is missing or fails to parse, the parent error
 * boundary renders a clearly-labelled placeholder figure instead.
 */
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader, useThree, invalidate } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createSkinMaterial, type SkinMaterialHandle, type SkinQuality } from './skinMaterial';
import type { Gender } from './types';

export const MODEL_URLS: Record<Gender, string> = {
  male: '/models/body-male.glb?v=6',
  female: '/models/body-female.glb?v=6',
  neutral: '/models/body-male.glb?v=6',
};

const dracoLoader = new DRACOLoader().setDecoderPath('/decoders/');
const ktx2Loader = new KTX2Loader().setTranscoderPath('/decoders/');
const ignoreRaycast: THREE.Object3D['raycast'] = () => {
  /* decorative surface details must not block anatomical picking */
};

export type BodyModelProps = {
  gender?: Gender;
  quality?: SkinQuality;
  breathing: boolean;
  onReady?: (handle: SkinMaterialHandle) => void;
  onPointerMove?: (e: any) => void;
  onPointerOut?: (e: any) => void;
  onClick?: (e: any) => void;
};

function SurfaceDetails({ gender }: { gender: Gender }) {
  const female = gender === 'female';
  const y = female ? -0.063 : 0;
  const xScale = female ? 0.94 : 1;
  const z = female ? -0.004 : 0;

  const mats = useMemo(
    () => ({
      hair: new THREE.MeshPhysicalMaterial({
        color: '#1c120c',
        roughness: 0.88,
        metalness: 0,
        sheen: 0.12,
        sheenColor: new THREE.Color('#5a3724'),
      }),
      brow: new THREE.MeshStandardMaterial({ color: '#24150e', roughness: 0.92 }),
      sclera: new THREE.MeshPhysicalMaterial({ color: '#f0dfcf', roughness: 0.42, clearcoat: 0.06 }),
      iris: new THREE.MeshPhysicalMaterial({ color: '#3a2215', roughness: 0.32, clearcoat: 0.12 }),
      pupil: new THREE.MeshBasicMaterial({ color: '#080604' }),
      lip: new THREE.MeshPhysicalMaterial({
        color: female ? '#9a3f48' : '#7e3432',
        roughness: 0.47,
        clearcoat: 0.045,
      }),
      nostril: new THREE.MeshBasicMaterial({ color: '#20110d', transparent: true, opacity: 0.62 }),
      areola: new THREE.MeshBasicMaterial({
        color: '#7a4339',
        transparent: true,
        opacity: female ? 0.42 : 0.28,
        depthWrite: false,
      }),
    }),
    [female],
  );

  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
    },
    [mats],
  );

  const side = (sx: -1 | 1) => sx * xScale;
  const eyeY = 1.586 + y;
  const browY = 1.615 + y;
  const mouthY = 1.522 + y;
  const chestY = (female ? 1.145 : 1.176) + y * 0.25;

  return (
    <group name="surface-realism-details">
      {/* Hair cap and sideburns: separate geometry makes the change visible at
          full-body distance, unlike subtle per-vertex tint on the scan shell. */}
      <mesh
        name="short-hair-cap"
        material={mats.hair}
        position={[0, 1.606 + y, -0.014 + z]}
        scale={[0.083 * xScale, 0.104, 0.088]}
        castShadow
        raycast={ignoreRaycast}
      >
        <sphereGeometry args={[1, 56, 28, 0, Math.PI * 2, 0, Math.PI * 0.60]} />
      </mesh>
      {([-1, 1] as const).map((sx) => (
        <mesh
          key={`sideburn-${sx}`}
          name="temple-hair"
          material={mats.hair}
          position={[side(sx) * 0.069, 1.565 + y, 0.036 + z]}
          scale={[0.010, 0.048, 0.020]}
          rotation={[0, 0, sx * 0.08]}
          castShadow
          raycast={ignoreRaycast}
        >
          <sphereGeometry args={[1, 20, 12]} />
        </mesh>
      ))}

      {([-1, 1] as const).map((sx) => (
        <group key={`eye-${sx}`}>
          <mesh
            name="sclera"
            material={mats.sclera}
            position={[side(sx) * 0.034, eyeY, 0.094 + z]}
            scale={[0.0175 * xScale, 0.0062, 0.0036]}
            rotation={[0.02, sx * 0.04, sx * 0.06]}
            raycast={ignoreRaycast}
          >
            <sphereGeometry args={[1, 28, 14]} />
          </mesh>
          <mesh
            name="iris"
            material={mats.iris}
            position={[side(sx) * 0.034, eyeY - 0.0003, 0.0982 + z]}
            scale={[0.0056 * xScale, 0.0039, 1]}
            raycast={ignoreRaycast}
          >
            <circleGeometry args={[1, 24]} />
          </mesh>
          <mesh
            name="pupil"
            material={mats.pupil}
            position={[side(sx) * 0.034, eyeY - 0.0004, 0.0988 + z]}
            scale={[0.0022 * xScale, 0.0022, 1]}
            raycast={ignoreRaycast}
          >
            <circleGeometry args={[1, 18]} />
          </mesh>
          <mesh
            name="eyebrow"
            material={mats.brow}
            position={[side(sx) * 0.034, browY, 0.091 + z]}
            rotation={[0, 0, Math.PI / 2 + sx * 0.16]}
            scale={[1, 1, 1]}
            castShadow
            raycast={ignoreRaycast}
          >
            <capsuleGeometry args={[0.0035, 0.030 * xScale, 5, 14]} />
          </mesh>
        </group>
      ))}

      {/* Lips and nostrils are tiny but strongly humanising at the app's camera distance. */}
      <mesh
        name="upper-lip"
        material={mats.lip}
        position={[0, mouthY + 0.0045, 0.096 + z]}
        scale={[0.030 * xScale, 0.0046, 0.0028]}
        raycast={ignoreRaycast}
      >
        <sphereGeometry args={[1, 28, 12]} />
      </mesh>
      <mesh
        name="lower-lip"
        material={mats.lip}
        position={[0, mouthY - 0.0045, 0.0965 + z]}
        scale={[0.034 * xScale, 0.0056, 0.0032]}
        raycast={ignoreRaycast}
      >
        <sphereGeometry args={[1, 28, 12]} />
      </mesh>
      {([-1, 1] as const).map((sx) => (
        <mesh
          key={`nostril-${sx}`}
          name="nostril"
          material={mats.nostril}
          position={[side(sx) * 0.009, 1.553 + y, 0.110 + z]}
          scale={[0.0038, 0.0025, 1]}
          rotation={[0, 0, sx * 0.16]}
          raycast={ignoreRaycast}
        >
          <circleGeometry args={[1, 16]} />
        </mesh>
      ))}

      {([-1, 1] as const).map((sx) => (
        <mesh
          key={`areola-${sx}`}
          name="subtle-areola"
          material={mats.areola}
          position={[side(sx) * (female ? 0.060 : 0.071), chestY, 0.094 + z]}
          scale={[female ? 0.011 : 0.0065, female ? 0.011 : 0.0065, 1]}
          raycast={ignoreRaycast}
        >
          <circleGeometry args={[1, 24]} />
        </mesh>
      ))}
    </group>
  );
}

export const BodyModel = forwardRef<THREE.Mesh, BodyModelProps>(function BodyModel(
  { gender = 'male', quality = 'high', breathing, onReady, onPointerMove, onPointerOut, onClick },
  ref,
) {
  const gl = useThree((s) => s.gl);
  const modelUrl = MODEL_URLS[gender] ?? MODEL_URLS.male;
  const gltf = useLoader(GLTFLoader, modelUrl, (loader) => {
    loader.setDRACOLoader(dracoLoader);
    loader.setKTX2Loader(ktx2Loader.detectSupport(gl));
    loader.setMeshoptDecoder(MeshoptDecoder);
  });

  const [handle] = useState<SkinMaterialHandle>(() => createSkinMaterial(undefined, quality));
  const groupRef = useRef<THREE.Group>(null);

  const sourceMesh = useMemo(() => {
    let found: THREE.Mesh | null = null;
    gltf.scene.traverse((o: THREE.Object3D) => {
      if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
    });
    if (!found) throw new Error('BodyViewer: GLB contains no mesh');
    const mesh = found as THREE.Mesh;
    const geo = mesh.geometry as THREE.BufferGeometry;
    if (!geo.getAttribute('_regionid')) {
      console.warn('[BodyViewer] model has no _REGIONID attribute — region picking disabled');
    }
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    return mesh;
  }, [gltf]);

  useEffect(() => {
    onReady?.(handle);
  }, [handle, onReady]);

  // dispose on unmount — no WebGL leaks across route changes
  useEffect(() => {
    return () => {
      const geo = sourceMesh.geometry as THREE.BufferGeometry;
      geo.dispose();
      handle.material.dispose();
    };
  }, [sourceMesh, handle]);

  // idle breathing: ±0.4% torso oscillation at ~0.2 Hz; paused while dragging
  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    if (breathing) {
      const s = 1 + 0.004 * Math.sin(clock.elapsedTime * Math.PI * 2 * 0.2);
      g.scale.set(s, 1, s);
      invalidate();
    } else if (g.scale.x !== 1) {
      g.scale.set(1, 1, 1);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={ref}
        geometry={sourceMesh.geometry}
        material={handle.material}
        onPointerMove={onPointerMove}
        onPointerOut={onPointerOut}
        onClick={onClick}
        castShadow
        receiveShadow
      />
      <SurfaceDetails gender={gender} />
    </group>
  );
});

/** Clearly-labelled stand-in when a model file is missing or fails to load. */
export function PlaceholderBody({ label }: { label: string }) {
  useEffect(() => {
    console.error(`[BodyViewer] ${label} — rendering placeholder figure. See ASSET-SPEC.md.`);
  }, [label]);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#5b6472',
        roughness: 0.7,
        wireframe: false,
        transparent: true,
        opacity: 0.85,
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <group>
      {/* torso */}
      <mesh material={mat} position={[0, 1.05, 0]}>
        <capsuleGeometry args={[0.16, 0.5, 8, 24]} />
      </mesh>
      {/* head */}
      <mesh material={mat} position={[0, 1.58, 0]}>
        <sphereGeometry args={[0.11, 24, 18]} />
      </mesh>
      {/* arms */}
      <mesh material={mat} position={[-0.26, 1.05, 0]} rotation={[0, 0, 0.12]}>
        <capsuleGeometry args={[0.05, 0.55, 6, 16]} />
      </mesh>
      <mesh material={mat} position={[0.26, 1.05, 0]} rotation={[0, 0, -0.12]}>
        <capsuleGeometry args={[0.05, 0.55, 6, 16]} />
      </mesh>
      {/* legs */}
      <mesh material={mat} position={[-0.09, 0.42, 0]}>
        <capsuleGeometry args={[0.07, 0.68, 6, 16]} />
      </mesh>
      <mesh material={mat} position={[0.09, 0.42, 0]}>
        <capsuleGeometry args={[0.07, 0.68, 6, 16]} />
      </mesh>
    </group>
  );
}
