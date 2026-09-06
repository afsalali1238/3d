/**
 * Internal transient viewer state (zustand).
 * Only ephemeral 3D-side state lives here — the app controls the viewer via
 * BodyViewer props; this store never leaks outside the body module.
 */
import { create } from 'zustand';
import type { PainPin } from './types';

export type PendingPoint = {
  regionId: string;
  point: [number, number, number];
  normal: [number, number, number];
  uv: [number, number];
} | null;

export type CameraCommand =
  | { kind: 'reset'; nonce: number }
  | { kind: 'face'; view: 'anterior' | 'posterior'; nonce: number }
  | { kind: 'focus'; target: [number, number, number]; distance: number; nonce: number }
  | null;

type ViewerState = {
  hoverRegionId: string | null;
  pendingPoint: PendingPoint;
  draggingPinId: string | null;
  interacting: boolean;
  lastInteraction: number;
  cameraCommand: CameraCommand;
  localPins: PainPin[];
  setHover: (id: string | null) => void;
  setPendingPoint: (p: PendingPoint) => void;
  setDraggingPin: (id: string | null) => void;
  setInteracting: (v: boolean) => void;
  bumpInteraction: () => void;
  sendCamera: (cmd: Exclude<CameraCommand, null>) => void;
  setLocalPins: (pins: PainPin[]) => void;
};

export const useViewerStore = create<ViewerState>((set) => ({
  hoverRegionId: null,
  pendingPoint: null,
  draggingPinId: null,
  interacting: false,
  lastInteraction: Date.now(),
  cameraCommand: null,
  localPins: [],
  setHover: (hoverRegionId) => set({ hoverRegionId }),
  setPendingPoint: (pendingPoint) => set({ pendingPoint }),
  setDraggingPin: (draggingPinId) => set({ draggingPinId }),
  setInteracting: (interacting) => set({ interacting }),
  bumpInteraction: () => set({ lastInteraction: Date.now() }),
  sendCamera: (cameraCommand) => set({ cameraCommand }),
  setLocalPins: (localPins) => set({ localPins }),
}));
