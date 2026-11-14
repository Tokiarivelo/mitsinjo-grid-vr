'use client';

import dynamic from 'next/dynamic';

/** Placeholder while the viewer chunk loads or Spark builds the recipe. */
export function ViewerSkeleton() {
  return <div className="h-full w-full animate-pulse rounded-control bg-surface-hover/60" />;
}

/** The object 3D view without SSR (WebGL), shared by the « 3D model » block and the 3D Studio. */
export const LazyObjectEditor3d = dynamic(
  () => import('./object-editor-3d').then((m) => m.ObjectEditor3d),
  { ssr: false, loading: () => <ViewerSkeleton /> }
);
