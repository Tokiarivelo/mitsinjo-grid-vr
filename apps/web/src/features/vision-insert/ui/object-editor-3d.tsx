'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { TOKEN_HEX } from '@/features/microgrid-3d/utils/scene-palette';
import { defaultArchetype, kitToRecipe, type ObjectKit } from '@/lib/object-kit';
import { fitRecipe, silhouetteRings, type ObjectShape } from '@/lib/object-shape';
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
import { buildRecipeMaterials } from '../utils/recipe-materials';
import { bakeStudioEnv } from '../utils/studio-env';
import { LIGHT_SETUPS, lookdevPreset } from '../utils/lookdev';
import { BuildFocus } from './build-focus-3d';

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
    const target = bakeStudioEnv(gl);
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

/**
 * Parts shade each other (PQ-T33): N8AO (half resolution, performance quality) in the composer and one soft
 * shadow map on the key light. Both draw on demand with the rest of the frame, so nothing costs at rest. The AO
 * tint stays light and its strength moderate so the measured colours hold.
 */
export const EDITOR_AO = { radius: 0.35, intensity: 1.2, falloff: 0.5, color: '#201a18' } as const;
/** Shadow map side of the key light, and its blur radius. */
export const KEY_SHADOW = { size: 1024, radius: 4 } as const;

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
  // One material per surface (stone matte, glass shiny…), indexed by the geometry groups: the shared builder
  // gives the surfaces the model uses their relief maps or photo swatches (PQ-T32).
  const surfaces = useMemo(() => {
    const used = new Set(mesh.groups.map((g) => g.materialIndex));
    return buildRecipeMaterials(vertexColors ? { swatches, gloss } : undefined, {
      used: used as ReadonlySet<number>,
      textured: vertexColors,
      tint,
      onTexture: invalidate,
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
          <mesh geometry={mesh} material={surfaces} castShadow receiveShadow />
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
  // Look-development lighting (PQ-T40, dev shots only): `?lookdev=side|back`, the studio otherwise.
  const lights =
    LIGHT_SETUPS[lookdevPreset(typeof window === 'undefined' ? '' : window.location.search)];
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
      shadows
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
      <directionalLight
        position={lights.key.position}
        intensity={lights.key.intensity}
        castShadow
        shadow-mapSize={[KEY_SHADOW.size, KEY_SHADOW.size]}
        shadow-radius={KEY_SHADOW.radius}
        shadow-bias={-0.0005}
        shadow-camera-near={0.5}
        shadow-camera-far={8}
        shadow-camera-left={-1.2}
        shadow-camera-right={1.2}
        shadow-camera-top={1.2}
        shadow-camera-bottom={-1.2}
      />
      {/* Rim light from behind: outlines dark objects (black TV, pump) against the backdrop. */}
      <directionalLight position={lights.rim.position} intensity={lights.rim.intensity} />
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
        <N8AO
          halfRes
          aoRadius={EDITOR_AO.radius}
          intensity={EDITOR_AO.intensity}
          distanceFalloff={EDITOR_AO.falloff}
          quality="performance"
          color={EDITOR_AO.color}
        />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        <Ink strength={EDITOR_INK} />
      </EffectComposer>
    </Canvas>
  );
}
