/**
 * Region picking against the segmented body mesh.
 *
 * The GLB carries a per-vertex `_regionid` attribute painted from the same
 * region table the shader highlights with (the vertex-attribute equivalent of
 * a region-ID mask texture — the mesh has no UV atlas, so the ID channel
 * rides on vertices instead of texels; the resolution contract is identical:
 * raycast → face → ID → region).
 *
 * Includes the mobile fat-finger fallback: if the primary ray misses or small
 * regions need help, a spiral of jittered rays within ~20 screen px snaps to
 * the nearest hit.
 */
import { useCallback, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { REGION_BY_NUMERIC } from './regions.gen';
import type { BodyRegion } from './types';

export type RegionHit = {
  region: BodyRegion;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  uv: [number, number];
  distance: number;
};

const SNAP_PX = 20;

export function useRegionPicker(meshRef: React.RefObject<THREE.Mesh | null>) {
  const { camera, size } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const ndc = useRef(new THREE.Vector2());

  const resolveHit = useCallback(
    (hit: THREE.Intersection): RegionHit | null => {
      const mesh = meshRef.current;
      if (!mesh || hit.face === undefined || hit.face === null) return null;
      const geo = mesh.geometry as THREE.BufferGeometry;
      const regAttr = geo.getAttribute('_regionid');
      if (!regAttr) return null;
      // majority vote across the face's three corners
      const ids = [
        regAttr.getX(hit.face.a),
        regAttr.getX(hit.face.b),
        regAttr.getX(hit.face.c),
      ].map((v) => Math.round(v));
      const id =
        ids[0] === ids[1] || ids[0] === ids[2] ? ids[0] : ids[1] === ids[2] ? ids[1] : ids[0];
      const region = REGION_BY_NUMERIC[id];
      if (!region) return null;
      const normal = hit.face.normal
        .clone()
        .transformDirection(mesh.matrixWorld)
        .normalize();
      // planar body-space UV stand-in (mesh has no texture UVs): x/height
      const p = hit.point;
      const uv: [number, number] = hit.uv
        ? [hit.uv.x, hit.uv.y]
        : [(p.x + 0.35) / 0.7, p.y / 1.72];
      return { region, point: p.clone(), normal, uv, distance: hit.distance };
    },
    [meshRef],
  );

  /** pick at NDC coordinates; jitter=true enables the screen-radius snap */
  const pick = useCallback(
    (ndcX: number, ndcY: number, jitter = false): RegionHit | null => {
      const mesh = meshRef.current;
      if (!mesh) return null;
      ndc.current.set(ndcX, ndcY);
      raycaster.current.setFromCamera(ndc.current, camera);
      const hits = raycaster.current.intersectObject(mesh, false);
      if (hits.length > 0) {
        const r = resolveHit(hits[0]);
        if (r) return r;
      }
      if (!jitter) return null;
      // spiral of offset rays within SNAP_PX
      const rx = (SNAP_PX / size.width) * 2;
      const ry = (SNAP_PX / size.height) * 2;
      let best: RegionHit | null = null;
      for (let ring = 1; ring <= 2; ring++) {
        const f = ring / 2;
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2 + ring * 0.39;
          ndc.current.set(ndcX + Math.cos(ang) * rx * f, ndcY + Math.sin(ang) * ry * f);
          raycaster.current.setFromCamera(ndc.current, camera);
          const h = raycaster.current.intersectObject(mesh, false);
          if (h.length > 0) {
            const r = resolveHit(h[0]);
            if (r && (!best || r.distance < best.distance)) best = r;
          }
        }
        if (best) break;
      }
      return best;
    },
    [camera, meshRef, resolveHit, size.width, size.height],
  );

  /** convert a DOM pointer event on the canvas to NDC */
  const eventToNdc = useCallback(
    (clientX: number, clientY: number, el: HTMLElement): [number, number] => {
      const rect = el.getBoundingClientRect();
      return [
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ];
    },
    [],
  );

  return { pick, eventToNdc, resolveHit };
}
