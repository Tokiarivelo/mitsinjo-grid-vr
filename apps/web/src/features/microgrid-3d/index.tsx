'use client';

import dynamic from 'next/dynamic';
import { VillageScenePlaceholder } from './ui/scene-placeholder';

export * from './types';
export * from './utils/to-scene-model';
export * from './utils/webgl';
export { useWebGLAvailable } from './hooks/use-webgl-available';
export { useReducedMotion } from './hooks/use-reduced-motion';
export { useFullscreen } from './hooks/use-fullscreen';
export { useSceneQuality, type SceneQuality } from './hooks/use-scene-quality';
export { useWebXR, type WebXRStatus } from './hooks/use-webxr';
export { useSceneModelFor, useStoreSceneModel, type SceneModelFor } from './hooks/use-scene-model';
export { useXrHandoff, standNear, type XrHandoff } from './utils/xr-handoff';
export { useImmersionQuery } from './hooks/use-immersion-query';
export {
  immersionHref,
  labOfStage,
  type ImmersionLab,
  type ImmersionQuery,
} from './utils/immersion-query';
export { useContextLoss, type ContextLoss } from './hooks/use-context-loss';
export { disableIWERFrameClear } from './utils/xr-session';
export { isDevXREmulated } from './utils/dev-xr-emulator';
export { EmulatedXRExit, type EmulatedXRExitProps } from './ui/emulated-xr-exit';
export { VillageScenePlaceholder };
export { GridDiagram, type GridDiagramProps } from './ui/grid-diagram';
export {
  DispatchControllerUnit,
  type DispatchControllerUnitProps,
} from './ui/dispatch-controller-unit';
export { ImmersionLabels, AirOptionBeacon, type ImmersionLabelsProps } from './ui/immersion-labels';
export type { DiagramVariant } from './utils/diagram-layout';

export const LazyVillageCanvas = dynamic(
  () => import('./ui/village-canvas').then((mod) => mod.VillageCanvas),
  {
    ssr: false,
    loading: () => <VillageScenePlaceholder />,
  }
);

/**
 * The village world alone (scene, VR panels, camera) for another page's Canvas: the /village VR
 * session shows the simulation without leaving the headset (VS-T49). Loaded on demand.
 */
export const LazyVillageWorld = dynamic(
  () => import('./ui/village-canvas').then((mod) => mod.VillageWorld),
  { ssr: false, loading: () => null }
);
export type { VillageWorldProps } from './ui/village-canvas';
