'use client';

import { memo, useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { faceMaterials, facesMesh } from '@/features/vision-insert/utils/face-projection';
import { carGeometry, carMaterials } from '@/features/vision-insert/utils/car-projection';
import { plantGeometry, plantMaterials } from '@/features/vision-insert/utils/plant-projection';
import { skinGeometry, skinMaterials } from '@/features/vision-insert/utils/skin-projection';
import { houseGeometry, houseMaterials } from '@/features/vision-insert/utils/house-projection';
import { withPieceEdits } from '@/features/vision-insert/utils/model-pieces';
import { PLACED_NIGHT_DIM, type PlacedDrawnModel } from '../utils/placed-models-geometry';
import { TOKEN_HEX } from '../utils/scene-palette';

/**
 * Tint of a drawn model (VS-T35, lit like the village): as drawn when powered or by day, greyed
 * towards the idle tone as an unpowered one goes dark at night (`dim`), alert red when on fire.
 */
export function drawnTint(model: Pick<PlacedDrawnModel, 'state' | 'dim'>): string | null {
  if (model.state === 'fire') return TOKEN_HEX.criticalRed;
  if (model.state === 'served' || model.dim >= 1) return null;
  const k = Math.min(1, (1 - model.dim) / (1 - PLACED_NIGHT_DIM));
  return `#${new THREE.Color('#ffffff').lerp(new THREE.Color(TOKEN_HEX.idle), k).getHexString()}`;
}

/**
 * A placed model wearing its validated drawings (PQ-T71), or built from its house plan (PQ-T72), its car plan (PQ-T76), its plant plan (PQ-T82) or its parts wearing their faces (VS-T43), with the operator's surface looks: the
 * same hull and materials as the 3D object view (`facesMesh`, `faceMaterials`). One draw call per
 * surface kind in use; the atlas texture is shared with the object view (cached by URL).
 */
export const PlacedDrawnModelMesh = memo(function PlacedDrawnModelMesh({
  model,
}: {
  model: PlacedDrawnModel;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const { recipe } = model;
  const geometry = useMemo(
    () =>
      // The operator's piece edits from the 3D Studio (PQ-T77) are baked in.
      withPieceEdits(
        recipe.house
          ? houseGeometry({ ...recipe, house: recipe.house })
          : ((recipe.car?.body ? carGeometry({ ...recipe, car: recipe.car }) : null) ??
              (recipe.plant
                ? plantGeometry({ ...recipe, plant: recipe.plant })
                : recipe.skin
                  ? skinGeometry({ ...recipe, skin: recipe.skin })
                  : facesMesh({ proportions: recipe.proportions, faces: recipe.faces! }))),
        recipe
      ),
    [recipe]
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const materials = useMemo(() => {
    const options = { tint: drawnTint(model), onLoad: invalidate };
    return recipe.house
      ? houseMaterials({ ...recipe, house: recipe.house }, options)
      : recipe.car?.body
        ? carMaterials({ ...recipe, car: recipe.car }, options)
        : recipe.plant
          ? plantMaterials({ ...recipe, plant: recipe.plant }, options)
          : recipe.skin
            ? skinMaterials({ ...recipe, skin: recipe.skin }, options)
            : faceMaterials(recipe.faces!, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the tint reads state and dim only
  }, [recipe, model.state, model.dim, invalidate]);
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
