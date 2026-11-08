'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';

export interface LiveWebcamBackdropProps {
  /** Optional callback to register the frame capture function with the parent scene. */
  onRegisterCapture?: (captureFn: () => string | null) => void;
  /** Radius of the curved panorama projection screen in meters. Default: 4.5. */
  radius?: number;
  /** Height of the curved screen in meters. Default: 3.8. */
  height?: number;
  /** Arc angle span in radians. Default: Math.PI * 0.72 (~130° panoramic field of view). */
  arcAngle?: number;
}

/**
 * Live Camera & Ambient Studio Surroundings for WebXR Immersion (VS-T10).
 * Displays real-time webcam video stream on a curved panoramic screen in front of the operator,
 * eliminates the black void by rendering a full 360° studio horizon dome, and falls back to
 * the high-res room sample (/samples/vision-room.jpg) when camera is unavailable.
 */
export const LiveWebcamBackdrop = memo(function LiveWebcamBackdrop({
  onRegisterCapture,
  radius = 4.5,
  height = 3.8,
  arcAngle = Math.PI * 0.72,
}: LiveWebcamBackdropProps) {
  const t = useTranslations('features.visionInsert');

  const [isLive, setIsLive] = useState(false);
  const [activeTexture, setActiveTexture] = useState<THREE.Texture | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoTextureRef = useRef<THREE.VideoTexture | null>(null);

  // Initialize webcam or sample fallback
  useEffect(() => {
    let isMounted = true;

    async function setupCamera() {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1920, min: 640 },
              height: { ideal: 1080, min: 480 },
              facingMode: 'environment',
            },
            audio: false,
          });

          if (!isMounted) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

          streamRef.current = stream;

          const video = document.createElement('video');
          video.srcObject = stream;
          video.setAttribute('playsinline', '');
          video.setAttribute('webkit-playsinline', '');
          video.autoplay = true;
          video.muted = true;
          video.loop = true;

          await video.play();

          if (!isMounted) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

          videoRef.current = video;

          const texture = new THREE.VideoTexture(video);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = false;

          videoTextureRef.current = texture;
          setActiveTexture(texture);
          setIsLive(true);
          return;
        } catch {
          // Camera permission denied or not available (headless/emulator) -> fall back to sample
        }
      }

      // Fallback to high-res room photo
      if (isMounted) {
        const loader = new THREE.TextureLoader();
        loader.load(
          '/samples/vision-room.jpg',
          (texture) => {
            if (!isMounted) {
              texture.dispose();
              return;
            }
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            setActiveTexture(texture);
            setIsLive(false);
          },
          undefined,
          () => {
            // Keep procedural backdrop
          }
        );
      }
    }

    void setupCamera();

    return () => {
      isMounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
        videoRef.current = null;
      }
      if (videoTextureRef.current) {
        videoTextureRef.current.dispose();
        videoTextureRef.current = null;
      }
    };
  }, []);

  // Frame capture function for instant vision scan
  useEffect(() => {
    if (!onRegisterCapture) return;

    const captureCurrentFrame = (): string | null => {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/jpeg', 0.88);
        }
      }
      return null;
    };

    onRegisterCapture(captureCurrentFrame);
  }, [onRegisterCapture]);

  // Keep video texture updated every render frame
  useFrame(() => {
    if (isLive && videoTextureRef.current && videoRef.current) {
      if (videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        videoTextureRef.current.needsUpdate = true;
      }
    }
  });

  // Calculate cylinder parameters centered at -Z (in front of the user)
  const thetaStart = Math.PI * 0.5 - arcAngle / 2;

  const pillText = isLive
    ? `● ${t('vrLiveWebcam').toUpperCase()} // 1080p`
    : `⟳ ${t('vrVirtualRoom').toUpperCase()}`;

  const pillTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 380;
    canvas.height = 70;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = isLive ? '#4ade80' : '#38bdf8';
      ctx.font = 'bold 20px "Inter", -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pillText, 190, 35);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [isLive, pillText]);

  return (
    <group name="live-webcam-backdrop-root">
      {/* 1. Full 360° Studio Horizon Atmosphere Dome (Eliminates the Black Void) */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[24, 32, 16]} />
        <meshBasicMaterial color="#081022" side={THREE.BackSide} toneMapped={false} />
      </mesh>

      {/* Horizon ambient glowing ring */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[14, 18, 48]} />
        <meshBasicMaterial color="#0e2a47" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>

      {/* Expanded outer floor ground */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[22, 64]} />
        <meshStandardMaterial color="#0f172a" roughness={0.85} metalness={0.1} />
      </mesh>

      {/* Concentric floor distance beacons */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[4.45, 4.52, 64]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>

      {/* 2. Curved Live Video / Room Panoramic Wall */}
      <mesh position={[0, height / 2 + 0.05, -0.4]} name="curved-webcam-screen">
        <cylinderGeometry
          args={[
            radius,
            radius,
            height,
            48,
            1,
            true, // open ended
            thetaStart,
            arcAngle,
          ]}
        />
        {activeTexture ? (
          <meshBasicMaterial
            map={activeTexture}
            side={THREE.DoubleSide}
            toneMapped={false}
            transparent
            opacity={0.96}
          />
        ) : (
          <meshStandardMaterial
            color="#1e293b"
            roughness={0.6}
            metalness={0.2}
            side={THREE.DoubleSide}
          />
        )}
      </mesh>

      {/* 3. Screen Edge Glowing Neon Rails */}
      {/* Top curved neon edge */}
      <mesh position={[0, height + 0.06, -0.4]}>
        <cylinderGeometry args={[radius, radius, 0.02, 48, 1, true, thetaStart, arcAngle]} />
        <meshBasicMaterial color={isLive ? '#22c55e' : '#38bdf8'} toneMapped={false} />
      </mesh>

      {/* Bottom curved neon edge */}
      <mesh position={[0, 0.04, -0.4]}>
        <cylinderGeometry args={[radius, radius, 0.02, 48, 1, true, thetaStart, arcAngle]} />
        <meshBasicMaterial color={isLive ? '#22c55e' : '#0284c7'} toneMapped={false} />
      </mesh>

      {/* 4. Live Camera Status Pill atop the Panoramic Screen */}
      <group position={[0, height + 0.22, -radius + 0.4]}>
        <mesh>
          <planeGeometry args={[1.0, 0.18]} />
          <meshBasicMaterial
            color={isLive ? '#064e3b' : '#0c4a6e'}
            transparent
            opacity={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 0, 0.005]}>
          <planeGeometry args={[0.98, 0.17]} />
          <meshBasicMaterial
            map={pillTexture}
            transparent
            opacity={0.98}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
});
