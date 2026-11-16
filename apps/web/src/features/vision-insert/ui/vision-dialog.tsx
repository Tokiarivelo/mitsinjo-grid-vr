'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ScanSearch, X } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { useVisionSession } from '../hooks/use-vision-session';
import { DetectionCanvas } from './detection-canvas';
import { SelectedAppliance } from './selected-appliance';

export interface VisionDialogProps {
  /** Attached image (data URL) to analyse; null = closed. */
  imageUrl: string | null;
  onClose: () => void;
}

/** Modal around the detection canvas: runs detection when opened, keeps the selected appliance. */
export function VisionDialog({ imageUrl, onClose }: VisionDialogProps) {
  const t = useTranslations('features.visionInsert');
  const vision = useVisionSession(imageUrl);

  useEffect(() => {
    if (!imageUrl) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imageUrl, onClose]);

  if (!imageUrl || typeof document === 'undefined') return null;

  // Portal: a glass panel (backdrop-filter) would trap a fixed overlay.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vision-dialog-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="flex max-h-[96vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-elevated px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="rounded-lg bg-energy-cyan/15 p-1.5 text-energy-cyan">
              <ScanSearch className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 id="vision-dialog-title" className="text-sm font-semibold text-text-primary">
                {t('title')}
              </h3>
              <p className="text-[11px] text-text-secondary">{t('subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-text-muted hover:bg-surface hover:text-text-primary cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 [-webkit-overflow-scrolling:touch]">
          <DetectionCanvas
            imageUrl={imageUrl}
            status={vision.status}
            detections={vision.detections}
            selectedId={vision.selectedId}
            onSelect={vision.select}
            onRetry={vision.retry}
            onCancel={vision.cancel}
            isDemo={vision.source === 'mock'}
            onSendShapes={vision.sendShapes}
            onRemoveManual={vision.removeManual}
            manualRoom={vision.manualRoom}
            identifyingIds={vision.identifyingIds}
            identifyFailed={vision.identifyFailed}
            onAdjustBox={vision.adjustBox}
          />
        </div>

        <div
          className="border-t border-border bg-surface-elevated px-4 py-3 text-sm"
          aria-live="polite"
        >
          <SelectedAppliance selected={vision.selected} />
        </div>
      </div>
    </div>,
    document.body
  );
}
