'use client';

import { memo, useCallback, useRef, type RefObject } from 'react';
import type { WebGLRenderer } from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Glasses, Sparkles, X } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ApplianceDetection } from '@/lib/vision';
import { CanvasCreationBoundary } from '@/features/microgrid-3d/ui/canvas-creation-boundary';
import { VillageXRStudio } from './village-xr-studio';

export interface VillageXRViewportProps {
  detections: ApplianceDetection[];
  isScanning: boolean;
  onTriggerScan: (capturedUrl?: string) => void;
  onSelectAppliance?: (id: string) => void;
  rendererRef: RefObject<WebGLRenderer | null>;
  xrActive: boolean;
  onEnterVR?: () => void;
  onExitVR: () => void;
  photoKey?: string;
}

/**
 * Fullscreen WebXR Immersive Viewport for Village Studio (/village).
 * Renders the interactive 3D studio, in-air spatial scan button, holographic targets,
 * laser blaster, and procedural 3D model spawns.
 * Automatically activates the WebXR session and Meta IWER emulator upon mounting.
 */
export const VillageXRViewport = memo(function VillageXRViewport({
  detections,
  isScanning,
  onTriggerScan,
  onSelectAppliance,
  rendererRef,
  xrActive,
  onEnterVR,
  onExitVR,
  photoKey,
}: VillageXRViewportProps) {
  const t = useTranslations('features.visionInsert');
  const tCommon = useTranslations('common');

  const hasAutoEnteredRef = useRef(false);

  // Trigger enter session once renderer is ready on initial mount
  const handleCreated = useCallback(
    ({ gl }: { gl: WebGLRenderer }) => {
      if (rendererRef) {
        (rendererRef as { current: WebGLRenderer | null }).current = gl;
      }
      if (!hasAutoEnteredRef.current && !xrActive && onEnterVR) {
        hasAutoEnteredRef.current = true;
        onEnterVR();
      }
    },
    [rendererRef, xrActive, onEnterVR]
  );

  return (
    <div
      className="relative w-full h-[600px] md:h-[700px] xl:h-[760px] rounded-3xl overflow-hidden border border-border/80 bg-slate-950 shadow-xl"
      data-testid="village-xr-viewport"
    >
      {/* 2D Overlay HUD (Visible on Desktop Screen / Mirror) */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Interactive Start / Status WebXR Button */}
          <button
            type="button"
            onClick={onEnterVR}
            className={cn(
              'flex items-center gap-1.5 rounded-xl border px-3 py-1.5 backdrop-blur-md text-xs font-semibold transition-all cursor-pointer',
              xrActive
                ? 'border-battery-green/50 bg-battery-green/15 text-battery-green shadow-xs'
                : 'border-energy-cyan/50 bg-energy-cyan/20 text-energy-cyan hover:bg-energy-cyan/30 shadow-xs'
            )}
            aria-label={t('vrEnter')}
          >
            <Glasses
              className={cn('h-4 w-4', xrActive ? 'text-battery-green' : 'animate-pulse')}
              aria-hidden="true"
            />
            <span>{xrActive ? t('vrEnter') : t('vrEnter')}</span>
          </button>

          <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-ai-violet/30 bg-ai-violet/10 px-2.5 py-1 text-xs font-medium text-ai-violet backdrop-blur-md">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            {t('studioBadge')}
          </span>

          <StatusBadge variant="simulated" size="sm" label={tCommon('simulatedData')} />
        </div>

        {/* Exit VR Button */}
        <button
          type="button"
          onClick={onExitVR}
          className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-border bg-slate-900/80 hover:bg-slate-800 px-3 py-1.5 backdrop-blur-md text-xs font-medium text-text-primary transition-colors cursor-pointer"
          aria-label={t('vrExit')}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t('vrExit')}</span>
        </button>
      </div>

      {/* WebXR Canvas */}
      <CanvasCreationBoundary onFail={() => undefined}>
        <Canvas
          frameloop={xrActive ? 'always' : 'demand'}
          shadows={false}
          dpr={[1, 1.5]}
          gl={{
            powerPreference: 'high-performance',
            antialias: false,
            alpha: true,
          }}
          camera={{ position: [0, 1.5, 1.6], fov: 60 }}
          onCreated={handleCreated}
          className="w-full h-full"
        >
          {/* Orbit controls for desktop preview when not presenting in headset */}
          {!xrActive && (
            <OrbitControls
              enableDamping
              maxPolarAngle={Math.PI / 2 + 0.1}
              minDistance={0.8}
              maxDistance={5.0}
              target={[0, 1.2, -1.2]}
            />
          )}

          {/* 3D Studio Room with in-air button, blaster, and targets */}
          <VillageXRStudio
            detections={detections}
            isScanning={isScanning}
            onTriggerScan={onTriggerScan}
            onSelectAppliance={onSelectAppliance}
            photoKey={photoKey}
          />
        </Canvas>
      </CanvasCreationBoundary>
    </div>
  );
});
