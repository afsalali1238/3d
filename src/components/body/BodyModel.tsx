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

export type BodyModelProps = {
  gender?: Gender;
  breathing: boolean;
  /** 'low' halves the skin shader's texture fetches on weak devices */
  quality?: SkinQuality;
  onReady?: (handle: SkinMaterialHandle) => void;
  onPointerMove?: (e: any) => void;
  onPointerOut?: (e: any) => void;
  onClick?: (e: any) => void;
};

export const BodyModel = forwardRef<THREE.Mesh, BodyModelProps>(function BodyModel(
  { gender = 'male', breathing, quality = 'high', onReady, onPointerMove, onPointerOut, onClick },
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
    // The skin shader reads baked occlusion/curvature channels. An older or
    // third-party asset may not have them — fill neutral values rather than
    // letting the attribute default to 0 and render the body pitch black.
    const count = geo.getAttribute('position').count;
    for (const [name, fallback] of [
      ['_regionid', -1],
      ['_thickness', 0.08],
      ['_ao', 1],
      ['_curv', 0],
    ] as const) {
      if (!geo.getAttribute(name)) {
        console.warn(`[BodyViewer] model has no ${name.toUpperCase()} channel — using ${fallback}`);
        geo.setAttribute(
          name,
          new THREE.BufferAttribute(new Float32Array(count).fill(fallback), 1),
        );
      }
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
