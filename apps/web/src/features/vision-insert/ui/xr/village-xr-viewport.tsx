'use client';

import { memo, useCallback, useRef, useState, type ComponentRef, type RefObject } from 'react';
import * as THREE from 'three';
import type { WebGLRenderer } from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Box, Glasses, HelpCircle, RefreshCw, Sparkles, X, ZoomIn, ZoomOut } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ApplianceDetection } from '@/lib/vision';
import { CanvasCreationBoundary } from '@/features/microgrid-3d/ui/canvas-creation-boundary';
import {
  useWebGLAvailable,
  useContextLoss,
  installWebGLContextSafetyPolyfill,
  isDevXREmulated,
  EmulatedXRExit,
} from '@/features/microgrid-3d';
import { TOUR_EYE } from './tour/tour-nav';
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
  const tSim = useTranslations('features.simulation');

  const hasWebGL = useWebGLAvailable();
  const contextLoss = useContextLoss();
  const [canvasFailed, setCanvasFailed] = useState(false);
  const hasAutoEnteredRef = useRef(false);
  const controlsRef = useRef<ComponentRef<typeof OrbitControls> | null>(null);

  // 360° tour off a real headset (desktop preview, IWER emulator); real headset = webcam wall.
  const tourMode = !xrActive || isDevXREmulated();

  // Desktop look-around turns in place (Street View): zoom = narrower field of view, not dolly.
  const zoomBy = useCallback((factor: number) => {
    const camera = controlsRef.current?.object;
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    camera.fov = Math.max(30, Math.min(90, camera.fov * factor));
    camera.updateProjectionMatrix();
  }, []);
  const handleZoomIn = useCallback(() => zoomBy(1 / 1.2), [zoomBy]);
  const handleZoomOut = useCallback(() => zoomBy(1.2), [zoomBy]);

  // Trigger enter session once renderer is ready on initial mount
  const handleCreated = useCallback(
    ({ gl }: { gl: WebGLRenderer }) => {
      if (rendererRef) {
        (rendererRef as { current: WebGLRenderer | null }).current = gl;
      }
      contextLoss.attach(gl.domElement);
      if (!hasAutoEnteredRef.current && !xrActive && onEnterVR) {
        hasAutoEnteredRef.current = true;
        onEnterVR();
      }
    },
    [rendererRef, xrActive, onEnterVR, contextLoss]
  );

  if (!hasWebGL || canvasFailed || contextLoss.lost) {
    return (
      <div
        className="relative w-full h-[600px] md:h-[700px] xl:h-[760px] rounded-3xl overflow-hidden border border-border/80 bg-slate-950 shadow-xl flex flex-col items-center justify-center p-6 text-center"
        data-testid="village-xr-viewport"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-solar-amber/30 bg-solar-amber/10 text-solar-amber shadow-sm mb-4">
          <Box className="h-8 w-8" aria-hidden="true" />
        </div>
        <h3 className="text-base font-semibold text-text-primary">{tSim('webglUnavailable')}</h3>
        <p className="max-w-md text-xs text-text-muted mt-1 mb-6">{t('vrWebglUnavailable')}</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.reload();
              }
            }}
            className="flex items-center gap-1.5 rounded-xl border border-energy-cyan/40 bg-energy-cyan/20 hover:bg-energy-cyan/30 px-4 py-2 text-xs font-semibold text-energy-cyan transition-colors cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>{t('retry')}</span>
          </button>
          <button
            type="button"
            onClick={onExitVR}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-slate-900/80 hover:bg-slate-800 px-4 py-2 text-xs font-medium text-text-primary transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span>{t('vrExit')}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-[600px] md:h-[700px] xl:h-[760px] rounded-3xl overflow-hidden border border-border/80 bg-slate-950 shadow-xl"
      data-testid="village-xr-viewport"
    >
      <EmulatedXRExit active={xrActive} label={t('vrExit')} onExit={onExitVR} />
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

          <span
            className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-energy-cyan/30 bg-energy-cyan/10 px-2.5 py-1 text-xs font-medium text-energy-cyan backdrop-blur-md cursor-help"
            title={`${t('vrInteractionHelpWalk')}\n${t('vrInteractionHelpWrist')}\n${t('vrInteractionHelpQuest')}\n${t('vrInteractionHelpIWER')}\n${t('vrInteractionHelpDesktop')}`}
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{xrActive ? t('vrInteractionGuideVR') : t('vrInteractionGuideDesktop')}</span>
          </span>

          <StatusBadge variant="simulated" size="sm" label={tCommon('simulatedData')} />

          {/* Desktop Zoom Controls */}
          {!xrActive && (
            <div className="hidden sm:flex items-center gap-0.5 rounded-xl border border-border/80 bg-slate-900/80 p-0.5 backdrop-blur-md">
              <button
                type="button"
                onClick={handleZoomIn}
                className="p-1 rounded-lg text-text-muted hover:text-energy-cyan hover:bg-energy-cyan/15 transition-colors cursor-pointer"
                aria-label={tCommon('zoomIn')}
                title={tCommon('zoomIn')}
              >
                <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                className="p-1 rounded-lg text-text-muted hover:text-energy-cyan hover:bg-energy-cyan/15 transition-colors cursor-pointer"
                aria-label={tCommon('zoomOut')}
                title={tCommon('zoomOut')}
              >
                <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
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
      <CanvasCreationBoundary
        key={contextLoss.epoch}
        onFail={() => {
          setCanvasFailed(true);
          contextLoss.reportCreationFailed();
        }}
      >
        <Canvas
          frameloop="always"
          shadows={false}
          dpr={[1, 1.5]}
          gl={(defaults) => {
            installWebGLContextSafetyPolyfill();
            return new THREE.WebGLRenderer({
              ...defaults,
              powerPreference: 'default',
              failIfMajorPerformanceCaveat: false,
              antialias: false,
              alpha: true,
            });
          }}
          camera={{ position: [TOUR_EYE[0], TOUR_EYE[1], TOUR_EYE[2] + 0.01], fov: 70 }}
          onCreated={handleCreated}
          className="w-full h-full"
        >
          {/* Desktop preview: drag to look around from the eye (Street View), no dolly or pan */}
          {!xrActive && (
            <OrbitControls
              ref={controlsRef}
              enableDamping
              enableZoom={false}
              enablePan={false}
              rotateSpeed={-0.35}
              minPolarAngle={0.25}
              maxPolarAngle={Math.PI - 0.25}
              target={TOUR_EYE}
            />
          )}

          {/* 3D Studio Room with in-air button, blaster, and targets */}
          <VillageXRStudio
            detections={detections}
            isScanning={isScanning}
            onTriggerScan={onTriggerScan}
            onSelectAppliance={onSelectAppliance}
            photoKey={photoKey}
            tourMode={tourMode}
          />
        </Canvas>
      </CanvasCreationBoundary>
    </div>
  );
});
