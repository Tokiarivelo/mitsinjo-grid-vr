'use client';

import { memo } from 'react';
import type { LibraryModel } from '@/lib/model-library';
import { GltfModel3D } from '../gltf-model-3d';

/**
 * A library model (VS-T51) in the lab: its own glTF, fitted so its largest side is `size` and centred
 * on the origin (the lab's model anchor). Shown only when the viewer asks for it, with its credit.
 */
export const LibraryModel3D = memo(function LibraryModel3D({
  entry,
  size,
}: {
  entry: LibraryModel;
  size: number;
}) {
  return <GltfModel3D url={entry.url} size={size} name={`xr-library-model-${entry.id}`} />;
});
