'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import type { ObjectRecipe } from '@/lib/object-shape';

/**
 * « Export Blender »: downloads the model as a Blender Python script (`POST /api/vision/shape/blender`),
 * to run it in Blender and test or refine the 3D code there.
 */
export function BlenderExportButton({ recipe, label }: { recipe: ObjectRecipe; label: string }) {
  const t = useTranslations('features.visionInsert');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const onClick = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch('/api/vision/shape/blender', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe, label }),
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${label.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model'}.py`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 text-xs font-medium text-text-primary hover:bg-surface-hover disabled:opacity-60 cursor-pointer"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        {t('model3dBlenderExport')}
      </button>
      {failed && (
        <span role="alert" className="text-xs text-text-secondary">
          {t('model3dBlenderError')}
        </span>
      )}
    </>
  );
}
