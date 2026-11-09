import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  getWebGLSupport,
  installWebGLContextSafetyPolyfill,
  isSoftwareRenderer,
  isSoftwareRendererName,
  isWebGLAvailable,
  probeWebGL,
  resetWebGLSupportForTests,
} from '../webgl';

/** Fake canvas whose WebGL context reports `renderer` and records context loss. */
function fakeCanvas(renderer: string | null) {
  const loseContext = vi.fn();
  const getContext = vi.fn(() =>
    renderer === null
      ? null
      : {
          RENDERER: 0x1f01,
          getExtension: (name: string) =>
            name === 'WEBGL_lose_context'
              ? { loseContext }
              : name === 'WEBGL_debug_renderer_info'
                ? { UNMASKED_RENDERER_WEBGL: 0x9246 }
                : null,
          getParameter: () => renderer,
        }
  );
  return { canvas: { getContext } as unknown as HTMLCanvasElement, getContext, loseContext };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetWebGLSupportForTests();
});

describe('isWebGLAvailable (P7-T5)', () => {
  it('returns a boolean value without throwing in jsdom environment', () => {
    const available = isWebGLAvailable();
    expect(typeof available).toBe('boolean');
  });
});

describe('software renderer detection', () => {
  it.each([
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'Microsoft Basic Render Driver',
  ])('flags %s as software', (name) => {
    expect(isSoftwareRendererName(name)).toBe(true);
  });

  it.each(['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)', 'Apple M2', 'Mali-G78'])(
    'keeps GPU %s on the high tier',
    (name) => {
      expect(isSoftwareRendererName(name)).toBe(false);
    }
  );

  it('never throws without a WebGL context (jsdom)', () => {
    expect(isSoftwareRenderer()).toBe(false);
  });
});

describe('probeWebGL', () => {
  it('opens one context, reads the renderer and releases the context', () => {
    vi.stubGlobal('WebGLRenderingContext', function () {});
    const f = fakeCanvas('ANGLE (NVIDIA GeForce RTX 3060)');
    expect(probeWebGL(() => f.canvas)).toEqual({ available: true, software: false });
    expect(f.getContext).toHaveBeenCalledTimes(1);
    expect(f.loseContext).toHaveBeenCalledTimes(1);
  });

  it('flags software GL', () => {
    vi.stubGlobal('WebGLRenderingContext', function () {});
    const f = fakeCanvas('SwiftShader Device');
    expect(probeWebGL(() => f.canvas)).toEqual({ available: true, software: true });
  });

  it('reports no WebGL when no context can be created', () => {
    vi.stubGlobal('WebGLRenderingContext', function () {});
    const f = fakeCanvas(null);
    expect(probeWebGL(() => f.canvas)).toEqual({ available: false, software: false });
  });

  it('falls back to WebGL 1 on a fresh canvas when WebGL 2 returns null', () => {
    vi.stubGlobal('WebGLRenderingContext', function () {});
    let callCount = 0;
    const canvas1 = fakeCanvas(null);
    const canvas2 = fakeCanvas('ANGLE (NVIDIA GeForce)');
    const canvases = [canvas1.canvas, canvas2.canvas];
    const factory = () => canvases[callCount++] ?? canvas1.canvas;

    expect(probeWebGL(factory)).toEqual({ available: true, software: false });
    expect(callCount).toBe(2);
    expect(canvas2.loseContext).toHaveBeenCalledTimes(1);
  });
});

describe('getWebGLSupport (cached)', () => {
  it('creates at most one context however often it is read (PW regression)', () => {
    vi.stubGlobal('WebGLRenderingContext', function () {});
    const f = fakeCanvas('Apple M2');
    const create = vi.spyOn(document, 'createElement').mockReturnValue(f.canvas);
    // A re-render per timeline step used to open a new context each time.
    for (let i = 0; i < 50; i++) {
      isWebGLAvailable();
      isSoftwareRenderer();
    }
    expect(f.getContext).toHaveBeenCalledTimes(1);
    expect(getWebGLSupport()).toBe(getWebGLSupport());
    create.mockRestore();
  });

  describe('installWebGLContextSafetyPolyfill', () => {
    it('returns non-null fallbacks when getParameter is called on lost context', () => {
      class MockWebGLContext {
        isLost = true;
        isContextLost() {
          return this.isLost;
        }
        getParameter(_pname: number) {
          return null;
        }
        clearColor(_r: number, _g: number, _b: number, _a: number) {}
      }

      vi.stubGlobal('WebGLRenderingContext', MockWebGLContext);
      installWebGLContextSafetyPolyfill(MockWebGLContext.prototype);

      const ctx = new MockWebGLContext();
      // COLOR_CLEAR_VALUE (0x0c22) returns Float32Array
      const color = ctx.getParameter(0x0c22) as unknown as Float32Array;
      expect(color).toBeInstanceOf(Float32Array);
      expect(color[0]).toBe(0);

      // DEPTH_CLEAR_VALUE (0x0b73) returns 1.0
      expect(ctx.getParameter(0x0b73)).toBe(1.0);

      // STENCIL_CLEAR_VALUE (0x0b93) returns 0
      expect(ctx.getParameter(0x0b93)).toBe(0);

      // clearColor does not throw on lost context
      expect(() => ctx.clearColor(0, 0, 0, 0)).not.toThrow();
    });
  });
});
