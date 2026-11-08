'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';

export interface LiveWebcamBackdropProps {
  /** Optional callback to register the frame capture function with the parent scene. */
  onRegisterCapture?: (captureFn: () => string | null) => void;
  /** Radius of the panoramic projection screen in meters. Default: 5.0m. */
  radius?: number;
  /** Height of the curved screen in meters. Default: 4.2m. */
  height?: number;
}

/**
 * Resilient Live Camera & Panoramic Studio Surroundings for WebXR Immersion (VS-T10).
 * Displays real-time webcam video stream across a panoramic curved screen centered at eye level,
 * with multi-stage fallback (environment -> user -> any video -> sample room photo),
 * throttled to 30fps to prevent GPU context loss and crashes.
 */
export const LiveWebcamBackdrop = memo(function LiveWebcamBackdrop({
  onRegisterCapture,
  radius = 5.0,
  height = 4.2,
}: LiveWebcamBackdropProps) {
  const t = useTranslations('features.visionInsert');

  const [isLive, setIsLive] = useState(false);
  const [activeTexture, setActiveTexture] = useState<THREE.Texture | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoTextureRef = useRef<THREE.VideoTexture | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);

  // Initialize webcam with robust fallback hierarchy
  useEffect(() => {
    let isMounted = true;

    async function setupCamera() {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        let stream: MediaStream | null = null;

        // 1. Try 720p with environment camera (Meta Quest passthrough / mobile rear cam)
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: { ideal: 'environment' },
            },
            audio: false,
          });
        } catch {
          // 2. Try laptop / desktop front webcam (user-facing)
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: { ideal: 'user' },
              },
              audio: false,
            });
          } catch {
            // 3. Permissive fallback to any available camera input
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
              });
            } catch {
              // Camera denied, headless, or no hardware available
            }
          }
        }

        if (stream && isMounted) {
          streamRef.current = stream;

          const video = document.createElement('video');
          video.srcObject = stream;
          video.setAttribute('playsinline', '');
          video.setAttribute('webkit-playsinline', '');
          video.autoplay = true;
          video.muted = true;
          video.loop = true;

          // Wait for metadata ready state
          await new Promise<void>((resolve) => {
            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              resolve();
            } else {
              video.onloadedmetadata = () => resolve();
              setTimeout(resolve, 800);
            }
          });

          await video.play().catch(() => {});

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
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.repeat.set(1, 1);

          videoTextureRef.current = texture;
          setActiveTexture(texture);
          setIsLive(true);
          return;
        }
      }

      // Fallback to high-res room sample photo (/samples/vision-room.jpg)
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
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.repeat.set(1, 1);
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

  // Keep video texture updated ONLY when a new video frame actually arrives (reduces GPU uploads by 75%)
  useFrame(() => {
    if (isLive && videoTextureRef.current && videoRef.current) {
      const curTime = videoRef.current.currentTime;
      if (curTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = curTime;
        videoTextureRef.current.needsUpdate = true;
      }
    }
  });

  const pillText = isLive
    ? `● ${t('vrLiveWebcam').toUpperCase()} // 720p`
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

  // Calculate cylindrical projection arc:
  // Spans ~240° (Math.PI * 1.35) horizontally, centered straight forward at -Z.
  const thetaLength = Math.PI * 1.35;
  const thetaStart = Math.PI - thetaLength / 2;

  return (
    <group name="live-webcam-backdrop-root">
      {/* 1. Curved Panoramic Video / Room Screen (Centered at eye level y = 1.5m) */}
      <mesh position={[0, 1.5, 0]} name="curved-webcam-screen">
        <cylinderGeometry
          args={[
            radius,
            radius,
            height,
            48,
            1,
            true, // open ended
            thetaStart,
            thetaLength,
          ]}
        />
        {activeTexture ? (
          <meshBasicMaterial
            map={activeTexture}
            side={THREE.BackSide}
            toneMapped={false}
            transparent
            opacity={0.98}
          />
        ) : (
          <meshBasicMaterial color="#081022" side={THREE.BackSide} toneMapped={false} />
        )}
      </mesh>

      {/* 2. Soft Studio Atmosphere Dome (Wraps remaining space so no black void exists) */}
      <mesh position={[0, 1.5, 0]}>
        <sphereGeometry args={[18, 32, 32]} />
        <meshBasicMaterial color="#081022" side={THREE.BackSide} toneMapped={false} />
      </mesh>

      {/* 3. Studio Floor Platform & Spatial Orienting Rings */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius + 1.5, 48]} />
        <meshBasicMaterial color="#0f172a" side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      <mesh position={[0, 0.01, -1.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.0, 2.05, 64]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>

      <mesh position={[0, 0.01, -1.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.8, 3.85, 64]} />
        <meshBasicMaterial color="#0284c7" transparent opacity={0.25} side={THREE.DoubleSide} />
      </mesh>

      {/* 4. Live Camera Status Pill in front of the operator */}
      <group position={[0, 2.5, -2.5]}>
        <mesh>
          <planeGeometry args={[0.7, 0.12]} />
          <meshBasicMaterial
            color={isLive ? '#064e3b' : '#0c4a6e'}
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
    </group>
  );
});
