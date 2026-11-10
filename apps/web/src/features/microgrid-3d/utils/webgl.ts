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

/**
 * Installs a safety wrapper on WebGLRenderingContext and WebGL2RenderingContext getParameter.
 * When a WebGL context is lost (e.g. driver reset, Optimus GPU switch, or memory pressure),
 * standard WebGL returns `null` for parameters like COLOR_CLEAR_VALUE.
 * Certain third-party extensions/emulators (e.g., Meta Immersive Web Emulator iwe.min.js onDeviceFrame)
 * assume COLOR_CLEAR_VALUE is always a non-null 4-element array and crash in an infinite RAF loop with
 * `TypeError: Cannot read properties of null (reading '0')`.
 * This polyfill safely returns non-null fallback values when the context is lost.
 */
let safetyInstalled = false;
export function installWebGLContextSafetyPolyfill(targetProto?: unknown) {
  const patchContext = (proto: unknown) => {
    if (!proto || typeof proto !== 'object') return;
    const ctx = proto as Record<string, unknown>;
    const originalGetParameter = ctx.getParameter;
    if (typeof originalGetParameter !== 'function') return;
    ctx.getParameter = function (this: { isContextLost?: () => boolean }, pname: number) {
      if (typeof this.isContextLost === 'function' && this.isContextLost()) {
        if (pname === 0x0c22) return new Float32Array([0, 0, 0, 0]);
        if (pname === 0x0b73) return 1.0;
        if (pname === 0x0b93) return 0;
        return null;
      }
      let res: unknown = null;
      try {
        res = originalGetParameter.call(this, pname);
      } catch {
        res = null;
      }
      if (res === null) {
        if (pname === 0x0c22) return new Float32Array([0, 0, 0, 0]);
        if (pname === 0x0b73) return 1.0;
        if (pname === 0x0b93) return 0;
      }
      return res;
    };

    const originalClearColor = ctx.clearColor;
    if (typeof originalClearColor === 'function') {
      ctx.clearColor = function (
        this: { isContextLost?: () => boolean },
        r: number,
        g: number,
        b: number,
        a: number
      ) {
        if (typeof this.isContextLost === 'function' && this.isContextLost()) return;
        try {
          return originalClearColor.call(this, r ?? 0, g ?? 0, b ?? 0, a ?? 0);
        } catch {
          // Swallow clear errors on lost WebGL context to prevent infinite RAF crash loops
        }
      };
    }
  };

  if (targetProto) {
    patchContext(targetProto);
    return;
  }

  if (safetyInstalled || typeof window === 'undefined') return;
  safetyInstalled = true;

  if (typeof WebGLRenderingContext !== 'undefined') {
    patchContext(WebGLRenderingContext.prototype);
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    patchContext(WebGL2RenderingContext.prototype);
  }
}

// Auto-install immediately on client load
if (typeof window !== 'undefined') {
  installWebGLContextSafetyPolyfill();
}
