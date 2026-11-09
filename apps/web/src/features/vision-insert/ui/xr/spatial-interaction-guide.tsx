'use client';

import { memo, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useTranslations } from '@/lib/i18n';

export interface SpatialInteractionGuideProps {
  position?: [number, number, number];
}

/**
 * Diegetic In-Air Interaction Guide for WebXR & Desktop 3D.
 * Floats comfortably below the Air Button, providing clear, real-time command guidance:
 * - Quest VR: 🎮 Pull Trigger · ✋ Pinch Fingers
 * - Desktop Screen: 🖱️ Aim & Click directly with Mouse
 */
export const SpatialInteractionGuide = memo(function SpatialInteractionGuide({
  position = [0, 1.08, -1.2],
}: SpatialInteractionGuideProps) {
  const t = useTranslations('features.visionInsert');
  const { gl } = useThree();
  const isPresenting = Boolean(gl?.xr?.isPresenting);

  const guideText = isPresenting ? t('vrInteractionGuideVR') : t('vrInteractionGuideDesktop');

  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Background pill
      ctx.fillStyle = 'rgba(8, 16, 32, 0.92)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(4, 4, 504, 82, 18) : ctx.rect(4, 4, 504, 82);
      ctx.fill();

      // Border glow
      ctx.lineWidth = 2;
      ctx.strokeStyle = isPresenting ? '#38bdf8' : '#7dd3fc';
      ctx.stroke();

      // Text
      ctx.font = 'bold 22px "Inter", -apple-system, sans-serif';
      ctx.fillStyle = isPresenting ? '#e0f2fe' : '#f0f9ff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(guideText, 256, 45);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    setTexture((prev) => {
      prev?.dispose();
      return tex;
    });

    return () => {
      tex.dispose();
    };
  }, [guideText, isPresenting]);

  return (
    <group position={position} name="spatial-interaction-guide">
      {texture && (
        <mesh position={[0, 0, 0]}>
          <planeGeometry args={[0.54, 0.1]} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={0.96}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
});
