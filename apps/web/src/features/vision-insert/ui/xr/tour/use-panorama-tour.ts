'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { rememberExpectedDetections } from '../../../utils/expected-detections';
import { surfaceFromStrip, type ImageSurface } from '../webcam-screen';
import type { CaptureView } from './equirect';
import type { PhotoGround } from './grounded';
import { TOUR_ROOMS, TOUR_START, type TourRoomId } from './tour-data';
import {
  captureViewAt,
  tourArrows,
  tourScale,
  TOUR_EYE,
  TOUR_SURFACE_DISTANCE,
  type TourArrow,
} from './tour-nav';
import type { TourCapture } from './panorama-tour';

export interface TourScan {
  url: string;
  surface: ImageSurface;
}

export interface PanoramaTourState {
  room: TourRoomId;
  /** Image column straight ahead; null before the first frame. */
  uFront: number | null;
  /** Room being walked to (fade running). */
  pending: TourRoomId | null;
  arrows: TourArrow[];
  /** Surface of the last scan photo, while still in that room; null otherwise. */
  surface: ImageSurface | null;
  /** Wall distance of the shown photo (grounded panorama), m. */
  wall: number;
  /**
   * Live grounded photo (stable object, `offset` written every frame by `PanoramaTour`): what is
   * laid on the photo (outlines, labels) moves with it while the viewer walks.
   */
  ground: PhotoGround;
  arrive: (room: TourRoomId, uFront: number) => void;
  /** Walk to a room (ignored while a walk is running). */
  walk: (to: TourRoomId) => void;
  /** Walk through a floor arrow id (`tour-link:<room>`); false when the id is not an arrow. */
  walkThrough: (id: string) => boolean;
  registerCapture: (fn: ((view: CaptureView) => TourCapture | null) | null) => void;
  /** Photographs the 360° view centred on a heading; remembers its labelled objects. */
  scan: (yaw: number, pitch: number) => TourScan | null;
}

/** State of the walkable 360° test space (VS-T14): room, heading, arrows, last scan photo. */
export function usePanoramaTour(enabled: boolean): PanoramaTourState {
  const [room, setRoom] = useState<TourRoomId>(TOUR_START);
  const [uFront, setUFront] = useState<number | null>(null);
  const [pending, setPending] = useState<TourRoomId | null>(null);
  const [scanned, setScanned] = useState<{ room: TourRoomId; surface: ImageSurface } | null>(null);
  const captureRef = useRef<((view: CaptureView) => TourCapture | null) | null>(null);
  const [ground] = useState<PhotoGround>(() => ({
    eye: TOUR_EYE,
    wall: tourScale(TOUR_ROOMS[TOUR_START]).wall,
    floor: TOUR_EYE[1],
    offset: [0, 0, 0],
    step: 0,
  }));

  const registerCapture = useCallback((fn: ((view: CaptureView) => TourCapture | null) | null) => {
    captureRef.current = fn;
  }, []);

  const arrive = useCallback((to: TourRoomId, u: number) => {
    setRoom(to);
    setUFront(u);
    setPending(null);
  }, []);

  const walk = useCallback((to: TourRoomId) => setPending((p) => p ?? to), []);

  const walkThrough = useCallback(
    (id: string) => {
      const to = id.startsWith('tour-link:') ? (id.slice(10) as TourRoomId) : null;
      if (!to || !(to in TOUR_ROOMS)) return false;
      walk(to);
      return true;
    },
    [walk]
  );

  const scan = useCallback(
    (yaw: number, pitch: number): TourScan | null => {
      const view = captureViewAt(yaw, pitch);
      const shot = captureRef.current?.(view);
      if (!shot) return null;
      rememberExpectedDetections(shot.url, shot.expected);
      const surface = surfaceFromStrip(TOUR_EYE, view, TOUR_SURFACE_DISTANCE);
      setScanned({ room, surface });
      return { url: shot.url, surface };
    },
    [room]
  );

  const arrows = useMemo(
    () => (enabled && uFront !== null ? tourArrows(TOUR_ROOMS[room], uFront) : []),
    [enabled, room, uFront]
  );

  return {
    room,
    uFront,
    pending,
    arrows,
    surface: scanned && scanned.room === room ? scanned.surface : null,
    wall: tourScale(TOUR_ROOMS[room]).wall,
    ground,
    arrive,
    walk,
    walkThrough,
    registerCapture,
    scan,
  };
}
