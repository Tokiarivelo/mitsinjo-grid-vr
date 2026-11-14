'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { TOKEN_HEX } from '@/features/microgrid-3d/utils/scene-palette';
import { defaultArchetype, kitToRecipe, type ObjectKit } from '@/lib/object-kit';
import {
  fitRecipe,
  silhouetteRings,
  type ObjectRecipe,
  type ObjectShape,
  type RecipeMaterial,
} from '@/lib/object-shape';
import type { ApplianceDetection } from '@/lib/vision';
import { useReducedMotion } from '@/features/microgrid-3d/hooks/use-reduced-motion';
import { Ink } from '@/features/microgrid-3d/ui/ink';
import {
  useShaderWarmup,
  type WarmupTarget,
} from '@/features/microgrid-3d/hooks/use-shader-warmup';
import { cn } from '@/lib/utils';
import type { ShapeImprove } from '../hooks/use-object-shape';
import { HULL_SURFACES, type HullSurface } from '@/lib/face-hull';
import { faceMaterials, facesMesh } from '../utils/face-projection';
import { carGeometry, carMaterials } from '../utils/car-projection';
import { houseGeometry, houseMaterials } from '../utils/house-projection';
import { recipeMesh, silhouetteDepth, silhouetteMesh } from '../utils/object-geometry';
import { surfaceMaterial, SURFACES } from '../utils/surface-look';
import { buildStudioScene, STUDIO_SIGMA } from '../utils/studio-env';
import { BuildFocus } from './build-focus-3d';
import { PrintWipe } from './print-wipe-3d';
import { SWATCH_GAIN } from '../utils/surface-maps';
import { surfaceTextures, swatchTexture } from '../utils/surface-textures';

export interface ObjectEditor3dProps {
  /** Final shape (ready). Absent while loading — the viewer then shows `preview` or the silhouette. */
  shape?: ObjectShape;
  /** Live model streamed while loading (seed, then each kept stage): painted like a 3D print. */
  preview?: ObjectRecipe | null;
  detection: Pick<ApplianceDetection, 'box' | 'outline' | 'category' | 'scenery'> & {
    label?: string;
  };
  /** The photo the object was found on: only its size is read (the photo is never pasted on the model). */
  imageUrl: string;
  /** Display size multiplier (PV-T11b, visual only, 0.5–2). */
  scale?: number;
  /** Tint multiplied over the measured colours (PV-T11b, visual only); null = as measured. */
  tint?: string | null;
  /** Staged build in progress: the camera orbits and frames the parts each stage works on. */
  improve?: ShapeImprove;
  /** Surface selected in the surface editor (PQ-T71, drawn models only): it glows. */
  selectedSurface?: HullSurface | null;
  /** A click on the model names the surface under the pointer. */
  onPickSurface?: (surface: HullSurface) => void;
}

/** Strength of the studio reflections and fill (image-based light). */
const ENV_INTENSITY = 0.9;

/**
 * Studio light (PR-1.1, PT-2): the softbox studio (`buildStudioScene`) pre-filtered once per canvas
 * (PMREM) as `scene.environment`, so every surface gets fill light and reflections by its roughness;
 * the studio scene is freed right after the bake, the target on unmount.
 */
function StudioEnvironment() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const { gl, scene, invalidate } = get();
    const pmrem = new THREE.PMREMGenerator(gl);
    const studio = buildStudioScene();
    const target = pmrem.fromScene(studio.scene, STUDIO_SIGMA);
    studio.dispose();
    pmrem.dispose();
    scene.environment = target.texture;
    scene.environmentIntensity = ENV_INTENSITY;
    invalidate(); // frameloop="demand"
    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [get]);
  return null;
}

/** Ink strength in the editor (PT-5): a clear drawn edge on the single object. */
export const EDITOR_INK = 0.6;
/** Ink on a model that wears its drawings (PQ-T70): the drawn lines are already there. */
export const PROJECTED_INK = 0.2;

/** Pointer travel (px) past which a click on the model was an orbit drag. */
const PICK_MAX_DRAG = 4;

/** Camera on a ¾ view, far enough for a 1 × 1 × 1 object. */
const CAMERA_POSITION: [number, number, number] = [1.3, 0.85, 2.35];
const CAMERA_DISTANCE = Math.hypot(...CAMERA_POSITION);

function ObjectModel({
  shape,
  preview,
  detection,
  imageUrl,
  scale = 1,
  tint = null,
  improve,
  selectedSurface = null,
  onPickSurface,
}: ObjectEditor3dProps) {
  const reducedMotion = useReducedMotion();
  // Photo size only (silhouette proportions); cached image, no GPU upload.
  const image = useLoader(THREE.ImageLoader, imageUrl);
  const photoAspect = image.width && image.height ? image.width / image.height : 1;

  const shapeRecipe = shape?.mode === 'recipe' ? (shape.recipe ?? null) : null;
  /** A streamed preview actually on screen (the final recipe always wins over it). */
  const livePreview = shapeRecipe === null ? (preview ?? null) : null;

  const fallbackRecipe = useMemo(() => {
    if (shapeRecipe ?? preview) return null;
    if (detection.outline) return null;
    const archetype = defaultArchetype(detection.category, detection.scenery, detection.label);
    const fallbackKit: ObjectKit = {
      archetype,
      proportions: { w: 1, h: 0.6, d: 0.5 },
      colors: { main: '#6a6c72', secondary: '#333538', accent: '#1a1b1e' },
      materials: { main: 'metal', secondary: 'glass', accent: 'rubber' },
    };
    return fitRecipe(kitToRecipe(fallbackKit), photoAspect);
  }, [shapeRecipe, preview, detection, photoAspect]);

  const activeRecipe = shapeRecipe ?? livePreview ?? fallbackRecipe;

  // Model from its drawn views (PQ-T70): the drawings are projected on it (never the photo).
  const faces = activeRecipe?.faces && !activeRecipe.yaw ? activeRecipe.faces : null;
  // A house read by its specialist (PQ-T72): built volume by volume, its walls wearing the drawings.
  const house = activeRecipe?.house && !activeRecipe.yaw ? activeRecipe : null;
  // A car fitted on its drawings (PQ-T76): lofted body, real wheels, glass, wearing the drawings.
  const carPlan = !house && activeRecipe?.car?.body && !activeRecipe.yaw ? activeRecipe.car : null;
  const car = useMemo(
    () => (carPlan && activeRecipe ? { ...activeRecipe, car: carPlan } : null),
    [carPlan, activeRecipe]
  );
  const pickable = Boolean(faces || house || car);
  const mesh = useMemo(() => {
    if (house?.house) return houseGeometry({ ...house, house: house.house });
    const carMesh = car ? carGeometry(car) : null;
    if (carMesh) return carMesh;
    return faces && activeRecipe
      ? facesMesh({ proportions: activeRecipe.proportions, faces })
      : activeRecipe
        ? recipeMesh(activeRecipe)
        : silhouetteMesh(
            silhouetteRings(detection),
            detection.box,
            photoAspect,
            silhouetteDepth(detection)
          );
  }, [activeRecipe, faces, house, car, detection, photoAspect]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  const invalidate = useThree((s) => s.invalidate);
  const vertexColors = Boolean(activeRecipe);
  const swatches = activeRecipe?.swatches;
  // One material per surface (stone matte, glass shiny…), indexed by the geometry groups. Surfaces the
  // model uses get their relief maps (PR-1.4: stone blocks, slate rows…) or photo swatches (PR-1.5),
  // tinted by the measured colours and compensated with a brightness gain so surfaces do not darken.
  const surfaces = useMemo(() => {
    if (house?.house)
      return houseMaterials(
        { ...house, house: house.house },
        {
          tint,
          selected: selectedSurface
            ? { surface: selectedSurface, color: TOKEN_HEX.energyCyan }
            : null,
          onLoad: invalidate,
        }
      );
    if (car)
      return carMaterials(car, {
        tint,
        selected: selectedSurface
          ? { surface: selectedSurface, color: TOKEN_HEX.energyCyan }
          : null,
        onLoad: invalidate,
      });
    if (faces)
      return faceMaterials(faces, {
        tint,
        selected: selectedSurface
          ? { surface: selectedSurface, color: TOKEN_HEX.energyCyan }
          : null,
        onLoad: invalidate,
      });
    const used = new Set(mesh.groups.map((g) => g.materialIndex));
    return SURFACES.map((s, i) => {
      const maps = vertexColors && used.has(i) ? surfaceTextures(s) : null;
      const swatch = vertexColors && swatches?.[s as RecipeMaterial];
      const swatchTex = swatch ? swatchTexture(swatch, invalidate) : null;
      const map = swatchTex ?? maps?.map;
      const gain = swatchTex ? SWATCH_GAIN : (maps?.gain ?? 1);
      return surfaceMaterial(s, {
        vertexColors: true,
        color: new THREE.Color(tint ?? '#ffffff').multiplyScalar(gain),
        ...(maps ? { normalMap: maps.normalMap, roughnessMap: maps.roughnessMap } : {}),
        ...(map ? { map } : {}),
      });
    });
  }, [mesh, vertexColors, swatches, tint, invalidate, faces, house, car, selectedSurface]);
  useEffect(() => () => surfaces.forEach((m) => m.dispose()), [surfaces]);
  // Plain silhouette material, memo'd like the surfaces (so the print wipe can clip it too).
  const silhouetteMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: tint ?? TOKEN_HEX.idle,
        roughness: 0.6,
        metalness: 0.05,
      }),
    [tint]
  );
  useEffect(() => () => silhouetteMaterial.dispose(), [silhouetteMaterial]);
  /** Every material of the model, clipped together while it prints (stable identity). */
  const modelMaterials = useMemo<ReadonlyArray<THREE.Material>>(
    () => (vertexColors ? surfaces : [silhouetteMaterial]),
    [vertexColors, surfaces, silhouetteMaterial]
  );
  /** The model is still being streamed: fresh geometry wipes in like print layers. */
  const building = livePreview !== null || improve?.status === 'running';
  // Ground under the object (shadow sits on it), from the real geometry.
  const floorY = useMemo(() => {
    mesh.computeBoundingBox();
    return (mesh.boundingBox?.min.y ?? -0.5) - 0.002;
  }, [mesh]);
  // frameloop="demand": a display tweak must request its frame.
  useEffect(() => {
    invalidate();
  }, [scale, tint, surfaces, invalidate]);

  return (
    <group>
      <ContactShadows
        position={[0, floorY * scale, 0]}
        scale={2.4 * scale}
        blur={2.2}
        far={1.2}
        opacity={0.45}
        frames={1}
      />
      <group scale={scale}>
        {vertexColors ? (
          <mesh
            geometry={mesh}
            material={surfaces}
            {...(pickable && onPickSurface
              ? {
                  onClick: (e: ThreeEvent<MouseEvent>) => {
                    // A drag that orbits the camera is not a pick.
                    if (e.delta > PICK_MAX_DRAG) return;
                    const surface = HULL_SURFACES[e.face?.materialIndex ?? -1];
                    if (!surface) return;
                    e.stopPropagation();
                    onPickSurface(surface);
                  },
                }
              : {})}
          />
        ) : (
          <mesh geometry={mesh} material={silhouetteMaterial} />
        )}
      </group>
      <PrintWipe
        mesh={mesh}
        materials={modelMaterials}
        scale={scale}
        building={building}
        reducedMotion={reducedMotion}
      />
      <BuildFocus
        recipe={activeRecipe}
        {...(improve ? { improve } : {})}
        scale={scale}
        homeDistance={CAMERA_DISTANCE}
        reducedMotion={reducedMotion}
      />
    </group>
  );
}

/**
 * 3D view of one detected object (PV-T10): Spark recipe (measured colours) or silhouette fallback, no photo on it.
 * Orbit (drag) and zoom (pinch / wheel), no pan. `frameloop="demand"`: renders only on change.
 * Transparent canvas over the `.viewer-studio` backdrop. Studio light (PR-1.1): image-based room light,
 * Khronos PBR Neutral tone mapping (keeps the measured colours; ACES shifted them), one soft key, a rim light (a dark object never melts into the background) and one
 * baked contact shadow. Ink outline (PT-5) in one post pass, rendered on demand only.
 * Load with `LazyObjectEditor3d` (no SSR) behind a WebGL check.
 */
export function ObjectEditor3d(props: ObjectEditor3dProps) {
  // Shader warm-up (PT-7): fade in once the materials are compiled (≤ 1 s).
  const [warmTarget, setWarmTarget] = useState<WarmupTarget | null>(null);
  const warm = useShaderWarmup(warmTarget);
  const shown = props.shape?.mode === 'recipe' ? props.shape.recipe : props.preview;
  const projected = Boolean((shown?.faces || shown?.house) && !shown.yaw);
  return (
    <Canvas
      onCreated={({ gl, scene, camera }) => setWarmTarget({ gl, scene, camera })}
      className={cn(
        'transition-opacity duration-300 motion-reduce:transition-none',
        warm ? 'opacity-100' : 'opacity-0'
      )}
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ position: CAMERA_POSITION, fov: 35, near: 0.05, far: 20 }}
      gl={{
        alpha: true,
        antialias: true,
        toneMapping: THREE.NeutralToneMapping,
        toneMappingExposure: 1,
      }}
    >
      <StudioEnvironment />
      {/* Soft key from the upper right front. */}
      <directionalLight position={[2, 3, 2.5]} intensity={1.2} />
      {/* Rim light from behind: outlines dark objects (black TV, pump) against the backdrop. */}
      <directionalLight position={[-0.5, 1.6, -3]} intensity={1.1} />
      <Suspense fallback={null}>
        <ObjectModel {...props} />
      </Suspense>
      <OrbitControls makeDefault enablePan={false} minDistance={1.2} maxDistance={5} />
      {/* Ink outline (PT-5): the composer renders off-screen, so tone mapping moves into it; ink after
          it keeps its theme colour exact. Alpha kept: the `.viewer-studio` backdrop shows through. */}
      <EffectComposer
        multisampling={4}
        frameBufferType={THREE.HalfFloatType}
        enableNormalPass={false}
      >
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        <Ink strength={projected ? PROJECTED_INK : EDITOR_INK} />
      </EffectComposer>
    </Canvas>
  );
}
