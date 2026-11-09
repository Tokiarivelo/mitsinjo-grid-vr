'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';
import { CameraUtils, XRCameraSource, type CameraState } from './xr-camera-source';

export interface LiveWebcamBackdropProps {
  /** Optional callback to register the frame capture function with the parent scene. */
  onRegisterCapture?: (captureFn: () => string | null) => void;
  /** Radius of curvature in meters. Default: 11.5m for gentle planar central focus (eliminates spherical vertigo). */
  radius?: number;
  /** Height of the screen in meters. Default: 6.8m for comfortable vertical view without overhead wrap. */
  height?: number;
  /** Distance in meters in front of the viewer for the center of the planar screen. Default: 4.2m. */
  distance?: number;
}

const SAMPLE_ROOM_SRC = '/samples/vision-room.jpg';

/**
 * Meta IWSDK-aligned Live Camera & Studio Surroundings (Chapter 13: Camera Access).
 * Displays studio background across an expansive planar panoramic screen:
 * - Planar Central Focus: Flat, natural perspective in front of the operator (zero spherical distortion or vertigo).
 * - Wide Horizontal Angle: Spans 150° left-to-right, allowing natural head turns with full peripheral context.
 * - Flat Architectural Horizon: Eliminates disorienting 360° domes to prevent vestibular mismatch.
 * - Zero GPU texture flood: Static HD studio panorama loaded once; webcam frames captured on-demand for AI.
 */
export const LiveWebcamBackdrop = memo(function LiveWebcamBackdrop({
  onRegisterCapture,
  radius = 11.5,
  height = 6.8,
  distance = 4.2,
}: LiveWebcamBackdropProps) {
  const t = useTranslations('features.visionInsert');

  const [cameraState, setCameraState] = useState<CameraState>('inactive');
  const [isStreamingLive, setIsStreamingLive] = useState(false);

  const cameraSourceRef = useRef<XRCameraSource | null>(null);

  // Preload HD sample room texture immediately so operator never sees a black screen.
  // Using panoramic studio room for 3D curved cylinder backdrop:
  // 1. Eliminates circular/barrel distortion seen when stretching a 2D webcam onto a cylinder.
  // 2. Eliminates 220-330 MB/s PCIe bus video texture upload flood that triggers driver context loss.
  // 3. Live camera feed remains active for picture-in-picture preview & on-demand AI snapshot capture.
  const roomTexture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(SAMPLE_ROOM_SRC);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }, []);

  useEffect(() => {
    return () => {
      roomTexture.dispose();
    };
  }, [roomTexture]);

  // Initialize Camera Source aligned with Meta IWSDK Chapter 13
  useEffect(() => {
    let isMounted = true;

    const cameraSource = new XRCameraSource(
      {
        facing: 'unknown',
        width: 1280,
        height: 720,
        frameRate: 30,
      },
      (state) => {
        if (!isMounted) return;
        setCameraState(state);
        if (state === 'error' || state === 'inactive') {
          setIsStreamingLive(false);
        }
      }
    );

    cameraSourceRef.current = cameraSource;

    void cameraSource.start().then((success) => {
      if (!isMounted) return;
      if (!success) {
        setCameraState('error');
      }
    });

    return () => {
      isMounted = false;
      cameraSource.stop();
      cameraSourceRef.current = null;
    };
  }, []);

  // Frame tick: detect when camera video frames actually begin playing
  useFrame(() => {
    const source = cameraSourceRef.current;
    const video = source?.videoElement;

    if (source && source.state === 'active' && video) {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime > 0) {
        if (!isStreamingLive) {
          setIsStreamingLive(true);
        }
      }
    }
  });

  // Register frame capture function with parent scene
  useEffect(() => {
    if (!onRegisterCapture) return;

    const captureCurrentFrame = (): string | null => {
      const source = cameraSourceRef.current;
      if (source?.videoElement && source.hasRealFrames) {
        return CameraUtils.captureFrame(source.videoElement);
      }
      return null;
    };

    onRegisterCapture(captureCurrentFrame);
  }, [onRegisterCapture]);

  const isLive = cameraState === 'active' && isStreamingLive;
  const activeTexture = roomTexture;

  const pillText = isLive
    ? `● ${t('vrLiveWebcam').toUpperCase()} // READY`
    : cameraState === 'starting'
      ? `⟳ STARTING CAMERA…`
      : `⟳ ${t('vrVirtualRoom').toUpperCase()}`;

  const [pillTexture, setPillTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 380;
    canvas.height = 70;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = isLive ? '#4ade80' : cameraState === 'starting' ? '#f59e0b' : '#38bdf8';
      ctx.font = 'bold 20px "Inter", -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pillText, 190, 35);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    setPillTexture((prev) => {
      prev?.dispose();
      return tex;
    });

    return () => {
      tex.dispose();
    };
  }, [isLive, cameraState, pillText]);

  // Calculate expansive planar panoramic projection arc:
  // Large curvature radius (11.5m) centered with screen front at -4.2m creates a flat,
  // natural perspective in the center (zero vertigo/fish-eye) while covering an expansive
  // 153° horizontal aperture allowing the operator to look freely from left to right.
  const thetaLength = Math.PI * 0.85;
  const thetaStart = Math.PI - thetaLength / 2;
  const cylinderCenterZ = radius - distance;

  return (
    <group name="live-webcam-backdrop-root">
      {/* 1. Wide-Angle Planar Panoramic Studio Screen (Flat central focus, wide horizontal span, unmirrored interior projection) */}
      <mesh position={[0, 1.5, cylinderCenterZ]} scale={[-1, 1, 1]} name="curved-webcam-screen">
        <cylinderGeometry
          args={[
            radius,
            radius,
            height,
            64,
            1,
            true, // open ended
            thetaStart,
            thetaLength,
          ]}
        />
        <meshBasicMaterial map={activeTexture} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      {/* 2. Flat Architectural Backdrop Wall (Eliminates vertigo-inducing 360° spherical dome) */}
      <mesh position={[0, 1.5, -distance - 0.4]} name="studio-backdrop-wall">
        <planeGeometry args={[26, 9]} />
        <meshBasicMaterial color="#081022" side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      {/* 3. Studio Floor Platform & Spatial Orienting Rings (Stable grounding plane) */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[9, 48]} />
        <meshBasicMaterial color="#0b1329" side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      <mesh position={[0, 0.01, -1.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.0, 2.05, 64]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>

      <mesh position={[0, 0.01, -1.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.8, 3.85, 64]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.25} side={THREE.DoubleSide} />
      </mesh>

      {/* 4. Ceiling Orienting Ring */}
      <mesh position={[0, 5.2, -1.5]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.8, 3.85, 64]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>

      {/* 5. Live Camera Status Pill in front of the operator */}
      {pillTexture && (
        <group position={[0, 2.8, -2.5]}>
          <mesh>
            <planeGeometry args={[0.7, 0.12]} />
            <meshBasicMaterial
              color={isLive ? '#064e3b' : cameraState === 'starting' ? '#78350f' : '#0c4a6e'}
              transparent
              opacity={0.88}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh position={[0, 0, 0.005]}>
            <planeGeometry args={[0.68, 0.11]} />
            <meshBasicMaterial
              map={pillTexture}
              transparent
              opacity={0.98}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
});
