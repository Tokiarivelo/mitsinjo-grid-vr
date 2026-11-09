'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';
import { CameraUtils, XRCameraSource, type CameraState } from './xr-camera-source';

export interface LiveWebcamBackdropProps {
  /** Optional callback to register the frame capture function with the parent scene. */
  onRegisterCapture?: (captureFn: () => string | null) => void;
  /** Radius of the panoramic projection screen in meters. Default: 4.8m. */
  radius?: number;
  /** Height of the curved screen in meters. Default: 8.5m for complete vertical immersion. */
  height?: number;
}

const SAMPLE_ROOM_SRC = '/samples/vision-room.jpg';

/**
 * Meta IWSDK-aligned Live Camera & Studio Surroundings (Chapter 13: Camera Access).
 * Displays real-time webcam video stream across a panoramic curved screen centered at eye level:
 * - Direct GPU-accelerated VideoTexture: binds hardware video stream without CPU 2D canvas blits,
 *   preventing Linux Optimus dual-GPU memory exhaustion and WebGL context loss.
 * - Zero-black-screen resilience: Instant HD sample studio room is active from frame 0
 *   while the camera permission is checked and stream initializes.
 * - StrictMode safe: texture handles remain stable across React 19 mount/remount cycles.
 * - Full-height panoramic cylindrical projection (8.5m height, 270° arc, unmirrored interior scale)
 *   and enclosing 360° studio dome covering the entire field of view.
 */
export const LiveWebcamBackdrop = memo(function LiveWebcamBackdrop({
  onRegisterCapture,
  radius = 4.8,
  height = 8.5,
}: LiveWebcamBackdropProps) {
  const t = useTranslations('features.visionInsert');

  const [cameraState, setCameraState] = useState<CameraState>('inactive');
  const [isStreamingLive, setIsStreamingLive] = useState(false);
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null);

  const cameraSourceRef = useRef<XRCameraSource | null>(null);

  // Preload HD sample room texture immediately so operator never sees a black screen
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
        } else if (state === 'active' && cameraSource.texture) {
          setVideoTexture(cameraSource.texture);
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
  const activeTexture = isLive && videoTexture ? videoTexture : roomTexture;

  const pillText = isLive
    ? `● ${t('vrLiveWebcam').toUpperCase()} // 720p`
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

  // Calculate cylindrical projection arc:
  // Spans 270° (Math.PI * 1.5) horizontally, centered straight forward at -Z.
  const thetaLength = Math.PI * 1.5;
  const thetaStart = Math.PI - thetaLength / 2;

  return (
    <group name="live-webcam-backdrop-root">
      {/* 1. Curved Panoramic Video Screen (Height: 8.5m, Centered at eye level y = 1.5m, scale.x = -1 for unmirrored interior projection) */}
      <mesh position={[0, 1.5, 0]} scale={[-1, 1, 1]} name="curved-webcam-screen">
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

      {/* 2. Soft Studio Atmosphere Dome (Wraps remaining space so no black void exists) */}
      <mesh position={[0, 1.5, 0]}>
        <sphereGeometry args={[16, 32, 32]} />
        <meshBasicMaterial color="#081022" side={THREE.BackSide} toneMapped={false} />
      </mesh>

      {/* 3. Studio Floor Platform & Spatial Orienting Rings */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius + 2.0, 48]} />
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
      <mesh position={[0, 5.8, -1.5]} rotation={[Math.PI / 2, 0, 0]}>
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
