'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { TOKEN_HEX } from '@/features/microgrid-3d/utils/scene-palette';
import { defaultArchetype, kitToRecipe, type ObjectKit } from '@/lib/object-kit';
import {
  fitRecipe,
  silhouetteRings,
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
import { recipeMesh, silhouetteDepth, silhouetteMesh } from '../utils/object-geometry';
import { surfaceMaterial, SURFACES } from '../utils/surface-look';
import { buildStudioScene, STUDIO_SIGMA } from '../utils/studio-env';
import { BuildFocus } from './build-focus-3d';
import { SWATCH_GAIN } from '../utils/surface-maps';
import { surfaceTextures, swatchTexture } from '../utils/surface-textures';

export interface ObjectEditor3dProps {
  shape: ObjectShape;
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

/** Camera on a ¾ view, far enough for a 1 × 1 × 1 object. */
const CAMERA_POSITION: [number, number, number] = [1.3, 0.85, 2.35];
const CAMERA_DISTANCE = Math.hypot(...CAMERA_POSITION);

function ObjectModel({
  shape,
  detection,
  imageUrl,
  scale = 1,
  tint = null,
  improve,
}: ObjectEditor3dProps) {
  const reducedMotion = useReducedMotion();
  // Photo size only (silhouette proportions); cached image, no GPU upload.
  const image = useLoader(THREE.ImageLoader, imageUrl);
  const photoAspect = image.width && image.height ? image.width / image.height : 1;

  const fallbackRecipe = useMemo(() => {
    if (shape.mode === 'recipe' && shape.recipe) return null;
    if (detection.outline) return null;
    const archetype = defaultArchetype(detection.category, detection.scenery, detection.label);
    const fallbackKit: ObjectKit = {
      archetype,
      proportions: { w: 1, h: 0.6, d: 0.5 },
      colors: { main: '#6a6c72', secondary: '#333538', accent: '#1a1b1e' },
      materials: { main: 'metal', secondary: 'glass', accent: 'rubber' },
    };
    return fitRecipe(kitToRecipe(fallbackKit), photoAspect);
  }, [shape, detection, photoAspect]);

  const activeRecipe = shape.mode === 'recipe' && shape.recipe ? shape.recipe : fallbackRecipe;

  const mesh = useMemo(
    () =>
      activeRecipe
        ? recipeMesh(activeRecipe)
        : silhouetteMesh(
            silhouetteRings(detection),
            detection.box,
            photoAspect,
            silhouetteDepth(detection)
          ),
    [activeRecipe, detection, photoAspect]
  );
  useEffect(() => () => mesh.dispose(), [mesh]);
  const invalidate = useThree((s) => s.invalidate);
  const vertexColors = Boolean(activeRecipe);
  const swatches = activeRecipe?.swatches;
  const gloss = activeRecipe?.gloss;
  // One material per surface (stone matte, glass shiny…), indexed by the geometry groups. Surfaces the
  // model uses get their relief maps (PR-1.4: stone blocks, slate rows…) or photo swatches (PR-1.5),
  // tinted by the measured colours and compensated with a brightness gain so surfaces do not darken.
  const surfaces = useMemo(() => {
    const used = new Set(mesh.groups.map((g) => g.materialIndex));
    return SURFACES.map((s, i) => {
      const maps = vertexColors && used.has(i) ? surfaceTextures(s) : null;
      const swatch = vertexColors && swatches?.[s as RecipeMaterial];
      const swatchTex = swatch ? swatchTexture(swatch, invalidate) : null;
      const map = swatchTex ?? maps?.map;
      const gain = swatchTex ? SWATCH_GAIN : (maps?.gain ?? 1);
      return surfaceMaterial(
        s,
        {
          vertexColors: true,
          color: new THREE.Color(tint ?? '#ffffff').multiplyScalar(gain),
          ...(maps ? { normalMap: maps.normalMap, roughnessMap: maps.roughnessMap } : {}),
          ...(map ? { map } : {}),
        },
        gloss?.[s as RecipeMaterial]
      );
    });
  }, [mesh, vertexColors, swatches, gloss, tint, invalidate]);
  useEffect(() => () => surfaces.forEach((m) => m.dispose()), [surfaces]);
  // Ground under the object (shadow sits on it), from the real geometry.
  const floorY = useMemo(() => {
    mesh.computeBoundingBox();
    return (mesh.boundingBox?.min.y ?? -0.5) - 0.002;
  }, [mesh]);
  // frameloop="demand": a display tweak must request its frame.
  useEffect(() => {
    invalidate();
  }, [scale, tint, invalidate]);

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
          <mesh geometry={mesh} material={surfaces} />
        ) : (
          <mesh geometry={mesh}>
            <meshStandardMaterial color={tint ?? TOKEN_HEX.idle} roughness={0.6} metalness={0.05} />
          </mesh>
        )}
      </group>
      <BuildFocus
        recipe={shape.mode === 'recipe' && shape.recipe ? shape.recipe : null}
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
        <Ink strength={EDITOR_INK} />
      </EffectComposer>
    </Canvas>
  );
}
