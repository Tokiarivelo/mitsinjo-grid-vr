/** Pure: does a WebGL renderer string name a CPU (software) rasterizer? */
export function isSoftwareRendererName(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render driver|mesa offscreen/i.test(
    renderer
  );
}

export interface WebGLSupport {
  /** A WebGL context can be created. */
  available: boolean;
  /** WebGL runs on the CPU (no GPU, headless CI, blocked drivers). */
  software: boolean;
}

const NO_WEBGL: WebGLSupport = { available: false, software: false };

/**
 * Probes WebGL once with a throwaway context and releases it right away.
 * `createCanvas` is injectable for tests. Never throws.
 */
export function probeWebGL(
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')
): WebGLSupport {
  try {
    if (typeof window === 'undefined' || !window.WebGLRenderingContext) return NO_WEBGL;
    let canvas = createCanvas();
    let gl = canvas.getContext('webgl2') as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) {
      canvas = createCanvas();
      gl = (canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    }
    if (!gl) return NO_WEBGL;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    // Free the slot now: browsers keep ~16 live contexts and drop the oldest (the scene).
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { available: true, software: isSoftwareRendererName(name) };
  } catch {
    return NO_WEBGL;
  }
}

let cache: WebGLSupport | null = null;

/**
 * Cached WebGL support: one probe per page load, however often it is read.
 * Safe to call on every render (e.g. as a `useSyncExternalStore` snapshot).
 */
export function getWebGLSupport(): WebGLSupport {
  if (typeof document === 'undefined') return NO_WEBGL;
  cache ??= probeWebGL();
  return cache;
}

/** Detects WebGL / WebGL2 capability (cached). False on the server. */
export function isWebGLAvailable(): boolean {
  return getWebGLSupport().available;
}

/**
 * True when WebGL runs on the CPU. The high tier is unusable there: one frame can
 * take seconds and freeze the page.
 */
export function isSoftwareRenderer(): boolean {
  return getWebGLSupport().software;
}

/** Test helper: forget the cached probe. */
export function resetWebGLSupportForTests() {
  cache = null;
}
