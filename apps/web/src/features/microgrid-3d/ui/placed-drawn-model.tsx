'use client';

import { memo, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { faceMaterials, facesMesh } from '@/features/vision-insert/utils/face-projection';
import type { PlacedDrawnModel } from '../utils/placed-models-geometry';
import { TOKEN_HEX } from '../utils/scene-palette';

/** Tint of a drawn model by feeder state: as drawn, dimmed when unserved, alert when on fire. */
const STATE_TINT: Record<PlacedDrawnModel['state'], string | null> = {
  served: null,
  unserved: TOKEN_HEX.idle,
  fire: TOKEN_HEX.criticalRed,
};

/**
 * A placed model wearing its validated drawings (PQ-T71), with the operator's surface looks: the
 * same hull and materials as the 3D object view (`facesMesh`, `faceMaterials`). One draw call per
 * surface kind in use; the atlas texture is shared with the object view (cached by URL).
 */
export const PlacedDrawnModelMesh = memo(function PlacedDrawnModelMesh({
  model,
}: {
  model: PlacedDrawnModel;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => facesMesh(model.recipe), [model.recipe]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const materials = useMemo(
    () => faceMaterials(model.recipe.faces, { tint: STATE_TINT[model.state], onLoad: invalidate }),
    [model.recipe.faces, model.state, invalidate]
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  return (
    <mesh
      name={`placed-drawn-model-${model.id}`}
      geometry={geometry}
      material={materials}
      position={model.position}
      rotation={[0, model.yaw, 0]}
      scale={model.scale}
      castShadow
      receiveShadow
    />
  );
});
