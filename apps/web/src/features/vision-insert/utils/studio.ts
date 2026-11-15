import type { PieceEdit } from '@/lib/piece-edits';

/**
 * The 3D Studio's vocabulary (PQ-T77): tools, view modes and camera presets, with the keys a
 * Blender user expects. Pure: shared by the toolbar, the keyboard and the 3D view.
 */

export const STUDIO_TOOLS = ['select', 'move', 'rotate', 'scale'] as const;
export type StudioTool = (typeof STUDIO_TOOLS)[number];
export const TOOL_KEYS: Record<StudioTool, string> = {
  select: 'q',
  move: 'g',
  rotate: 'r',
  scale: 's',
};
/** The gizmo mode of a tool (none for select). */
export const GIZMO_MODE = { move: 'translate', rotate: 'rotate', scale: 'scale' } as const;

export const VIEW_MODES = ['textured', 'solid', 'wireframe', 'xray'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
/** The plain grey of the « Solid » view (clay): shapes without their drawings. */
export const STUDIO_CLAY_HEX = '#b9bec7';
/** X-ray opacity: every piece seen through. */
export const XRAY_OPACITY = 0.35;

export const CAMERA_VIEWS = ['front', 'right', 'top', 'back', 'left', 'bottom', 'persp'] as const;
export type CameraView = (typeof CAMERA_VIEWS)[number];
/** Numpad keys (the digit row too): 1 front, 3 right, 7 top, 5 perspective. */
export const CAMERA_KEYS: Partial<Record<string, CameraView>> = {
  '1': 'front',
  '3': 'right',
  '7': 'top',
  '5': 'persp',
};
/** Where the camera stands for a preset (a direction, scaled to the studio distance). */
export const CAMERA_DIRECTION: Record<CameraView, [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  // Straight above / below would lock the orbit: a hair off the axis.
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
  persp: [0.47, 0.31, 0.83],
};

/** A camera request: a preset or « frame selected », `n` bumps on each press (same view twice). */
export interface CameraRequest {
  view: CameraView | 'frame';
  n: number;
}

/** What the studio asks of the 3D view. */
export interface StudioControls {
  tool: StudioTool;
  viewMode: ViewMode;
  camera: CameraRequest;
  selected: string | null;
  grid: boolean;
  onSelect: (piece: string | null) => void;
  /** A gizmo drag ended: the piece's new move / turn / scale (shares of the model's box). */
  onTransform: (piece: string, edit: Pick<PieceEdit, 'offset' | 'rotation' | 'scale'>) => void;
  /** The pieces the model has, in slot order (sent when the model is built). */
  onPieces: (names: string[]) => void;
}
