export type BodyGroup = 'head_neck' | 'shoulder_arm' | 'trunk' | 'lower_limb';
export type BodySide = 'left' | 'right' | 'center';
export type BodyView = 'anterior' | 'posterior';
export type ViewerMode = 'explore' | 'select' | 'pinpoint';
export type Gender = 'neutral' | 'male' | 'female';
export type Locale = 'en' | 'ar';

export type BodyRegion = {
  /** stable string id, e.g. "lumbar_spine" or "left_biceps" */
  id: string;
  /** numeric id baked into the model's _REGIONID vertex attribute (1-based) */
  numericId: number;
  /** the flat RGB colour this region would carry in a region-mask texture */
  maskColor: [number, number, number];
  label: string;
  labelAr?: string;
  side: BodySide;
  view: BodyView | 'both';
  group: BodyGroup;
  /** world-space centroid to orbit around */
  focusTarget: [number, number, number];
  /** camera distance for the zoom-in */
  focusDistance: number;
  /** adjacent regions, for "did you mean...?" disambiguation */
  neighbours: string[];
};

export type PainPin = {
  id: string;
  regionId: string;
  point: [number, number, number];
  normal: [number, number, number];
  /** 1 (mild, yellow) .. 5 (severe, red) */
  intensity: number;
};

export type PointConfirmPayload = {
  regionId: string;
  point: [number, number, number];
  normal: [number, number, number];
  uv: [number, number];
  gender?: Gender;
};

export type BodyViewerProps = {
  gender?: Gender;
  view: BodyView;
  selectedRegionId?: string | null;
  pins?: PainPin[];
  mode: ViewerMode;
  locale?: Locale;
  /** increment to re-frame the camera to the default view */
  resetSignal?: number;
  onRegionHover?: (regionId: string | null) => void;
  onRegionSelect?: (regionId: string) => void;
  onRegionClear?: () => void;
  onPointConfirm?: (p: PointConfirmPayload) => void;
  onReady?: () => void;
  onError?: (e: Error) => void;
};
