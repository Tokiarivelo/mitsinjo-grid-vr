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

const SAMPLE_ROOM_SRC = '/samples/vision-room.jpg';

/**
 * Resilient Live Camera & Panoramic Studio Surroundings for WebXR Immersion (VS-T10).
 * Displays real-time webcam video stream across a panoramic curved screen centered at eye level.
 * Features an instant Canvas-bridge texture preloaded with HD sample room so the operator
 * NEVER sees a pitch-black screen, transitioning seamlessly to the live camera feed
 * as soon as frames are decoded from the hardware.
 */
export const LiveWebcamBackdrop = memo(function LiveWebcamBackdrop({
  onRegisterCapture,
  radius = 5.0,
  height = 4.2,
}: LiveWebcamBackdropProps) {
  const t = useTranslations('features.visionInsert');

  const [isLive, setIsLive] = useState(false);
  const [activeTexture, setActiveTexture] = useState<THREE.Texture | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);

  // Initialize Canvas Texture with fallback sample photo immediately, then stream webcam
  useEffect(() => {
    let isMounted = true;

    // 1. Prepare 2D bridge canvas
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    canvasRef.current = canvas;

    const ctx = canvas.getContext('2d');

    // Preload sample image immediately to ensure zero black screen
    const sampleImg = new Image();
    sampleImg.crossOrigin = 'anonymous';
    sampleImg.src = SAMPLE_ROOM_SRC;
    sampleImg.onload = () => {
      if (!isMounted) return;
      if (ctx && lastVideoTimeRef.current === -1) {
        ctx.drawImage(sampleImg, 0, 0, canvas.width, canvas.height);
        if (texture) texture.needsUpdate = true;
      }
    };

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1);
    setActiveTexture(texture);

    // 2. Setup webcam and attach to DOM (hidden) so Chrome hardware decoder stays active
    async function setupCamera() {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        let stream: MediaStream | null = null;

        // Try environment camera first, then user webcam, then any camera
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
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
              });
            } catch {
              // No camera available
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

          // Crucial for Chrome on Linux: hidden DOM element keeps frame decoding running
          video.style.position = 'fixed';
          video.style.top = '-9999px';
          video.style.left = '-9999px';
          video.style.width = '640px';
          video.style.height = '360px';
          video.style.opacity = '0';
          video.style.pointerEvents = 'none';
          video.style.zIndex = '-999';
          document.body.appendChild(video);

          videoRef.current = video;

          try {
            await video.play();
          } catch {
            // Autoplay may be deferred until user interaction
          }

          if (isMounted) {
            setIsLive(true);
          }
        }
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
        if (videoRef.current.parentNode) {
          videoRef.current.parentNode.removeChild(videoRef.current);
        }
        videoRef.current = null;
      }
      if (texture) {
        texture.dispose();
      }
    };
  }, []);

  // Frame capture function for instant vision scan
  useEffect(() => {
    if (!onRegisterCapture) return;

    const captureCurrentFrame = (): string | null => {
      if (canvasRef.current) {
        return canvasRef.current.toDataURL('image/jpeg', 0.88);
      }
      return null;
    };

    onRegisterCapture(captureCurrentFrame);
  }, [onRegisterCapture]);

  // Keep 2D canvas texture updated smoothly from the video stream
  useFrame(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (isLive && video && canvas) {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const curTime = video.currentTime;
        if (curTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = curTime;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            if (activeTexture) {
              activeTexture.needsUpdate = true;
            }
          }
        }
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
      {/* 1. Curved Panoramic Video / Room Screen (Centered at eye level y = 1.5m, DoubleSide) */}
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
          <meshBasicMaterial map={activeTexture} side={THREE.DoubleSide} toneMapped={false} />
        ) : (
          <meshBasicMaterial color="#0f172a" side={THREE.DoubleSide} toneMapped={false} />
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
