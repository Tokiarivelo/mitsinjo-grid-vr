'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';
import { CameraUtils, XRCameraSource, type CameraState } from './xr-camera-source';
import { LIVE_PILL_POSITION } from './xr-layout';
import { screenArc, WEBCAM_SCREEN, type WebcamScreenGeometry } from './webcam-screen';

export interface LiveWebcamBackdropProps {
  /** Optional callback to register the frame capture function with the parent scene. */
  onRegisterCapture?: (captureFn: () => string | null) => void;
  /** Screen geometry; shared with target projection and blaster raycast. */
  screen?: WebcamScreenGeometry;
}

const SAMPLE_ROOM_SRC = '/samples/vision-room.jpg';

/**
 * Meta IWSDK-aligned Live Camera & Studio Surroundings (Chapter 13: Camera Access).
 * Displays studio background across an expansive planar panoramic screen:
 * - Planar Central Focus: Flat, natural perspective in front of the operator (zero spherical distortion or vertigo).
 * - Wide Horizontal Angle: ~125° seen from the viewer, bottom edge on the floor (WEBCAM_SCREEN).
 * - Flat Architectural Horizon: Eliminates disorienting 360° domes to prevent vestibular mismatch.
 * - Zero GPU texture flood: Static HD studio panorama loaded once; webcam frames captured on-demand for AI.
 */
export const LiveWebcamBackdrop = memo(function LiveWebcamBackdrop({
  onRegisterCapture,
  screen = WEBCAM_SCREEN,
}: LiveWebcamBackdropProps) {
  const t = useTranslations('features.visionInsert');

  const [cameraState, setCameraState] = useState<CameraState>('inactive');
  const [isStreamingLive, setIsStreamingLive] = useState(false);
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null);

  const cameraSourceRef = useRef<XRCameraSource | null>(null);
  const screenMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);

  // Preload HD sample room texture immediately as initial / fallback studio view
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
          setVideoTexture(null);
        }
      }
    );

    cameraSourceRef.current = cameraSource;

    void cameraSource.start().then((success) => {
      if (!isMounted) return;
      if (!success) {
        setCameraState('error');
      } else if (cameraSource.texture) {
        setVideoTexture(cameraSource.texture);
      }
    });

    return () => {
      isMounted = false;
      cameraSource.stop();
      cameraSourceRef.current = null;
      setVideoTexture(null);
    };
  }, []);

  // Frame tick: update hardware video texture on each new video frame
  useFrame(() => {
    const source = cameraSourceRef.current;
    const video = source?.videoElement;

    if (source && source.state === 'active' && video) {
      source.updateTexture();

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime > 0) {
        if (!isStreamingLive) {
          setIsStreamingLive(true);
        }
        if (!videoTexture && source.texture) {
          setVideoTexture(source.texture);
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

  const isLive = cameraState === 'active' && isStreamingLive && !!videoTexture;
  const activeTexture = isLive && videoTexture ? videoTexture : roomTexture;

  // Ensure material binds the active texture immediately upon state transition
  useEffect(() => {
    if (screenMaterialRef.current) {
      screenMaterialRef.current.map = activeTexture;
      screenMaterialRef.current.needsUpdate = true;
    }
  }, [activeTexture]);

  const pillText = isLive
    ? `● ${t('vrLiveWebcam').toUpperCase()} // 720p LIVE`
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

  // Curved 16:9 screen, bottom edge on the floor: detections map back to it 1:1
  // (webcam-screen.ts), so a shot at an object in the video lands on that object.
  const { radius, height, distance, centerY } = screen;
  const { thetaStart, thetaLength, centerZ: cylinderCenterZ } = screenArc(screen);

  return (
    <group name="live-webcam-backdrop-root">
      {/* 1. Zoomed-In Planar Panoramic Cinema Screen (Flat central focus, wide horizontal span, unmirrored interior projection) */}
      <mesh position={[0, centerY, cylinderCenterZ]} scale={[-1, 1, 1]} name="curved-webcam-screen">
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
        <meshBasicMaterial
          ref={screenMaterialRef}
          map={activeTexture}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {/* 2. Flat Architectural Backdrop Wall (Eliminates vertigo-inducing 360° spherical dome) */}
      <mesh position={[0, centerY, -distance - 0.3]} name="studio-backdrop-wall">
        <planeGeometry args={[26, 12]} />
        <meshBasicMaterial color="#081022" side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      {/* 3. Studio Floor Platform & Spatial Orienting Rings (Stable grounding plane) */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[9, 48]} />
        <meshBasicMaterial color="#0b1329" side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      <mesh position={[0, 0.01, -1.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.6, 1.65, 64]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>

      <mesh position={[0, 0.01, -1.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.8, 2.85, 64]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.25} side={THREE.DoubleSide} />
      </mesh>

      {/* 4. Ceiling Orienting Ring */}
      <mesh position={[0, 4.6, -1.2]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.8, 2.85, 64]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>

      {/* 5. Live Camera Status Pill, beside the scan button so it never covers the video */}
      {pillTexture && (
        <group position={LIVE_PILL_POSITION} rotation={[0, -0.45, 0]}>
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
