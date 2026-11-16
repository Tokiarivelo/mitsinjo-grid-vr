import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { ApplianceDetection } from '@/lib/vision';
import { categoryHint } from '../utils/labels';
vi.mock('../utils/prepare-image', () => ({
  prepareVisionImage: vi.fn(async () => new Blob([new Uint8Array(4)], { type: 'image/jpeg' })),
}));

import { useVisionDetection, VisionDialog } from '../index';
import { analysisStopped, cancelledState, isAnalysing } from '../hooks/use-vision-detection';

const fridge: ApplianceDetection = {
  id: 'det-1',
  label: 'Fridge',
  category: 'fridge',
  box: { x: 0.1, y: 0.1, w: 0.2, h: 0.5 },
};
const sse = (...events: [string, unknown][]) =>
  new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
const boxes = (source: 'meta' | 'mock', detections = [fridge]) => ({
  phase: 'boxes',
  detections,
  source,
  model: 'm',
});

const originalFetch = global.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe('categoryHint', () => {
  it('hides a category that only repeats the label', () => {
    expect(categoryHint('Fridge', 'Fridge')).toBeNull();
    expect(categoryHint(' tv ', 'TV')).toBeNull();
    expect(categoryHint('Samsung TV', 'Television')).toBe('Television');
  });
});

describe('useVisionDetection (PV-T7)', () => {
  it('posts the photo and ends ready with the mock fixture', async () => {
    fetchMock.mockResolvedValue(sse(['vision_detections', boxes('mock')], ['done', {}]));
    const { result } = renderHook(() => useVisionDetection());
    await act(() => result.current.detect('data:image/png;base64,AA'));
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/vision');
    expect((fetchMock.mock.calls[0]![1].body as FormData).get('image')).toBeInstanceOf(Blob);
    expect(result.current.status).toBe('ready');
    expect(result.current.detections).toEqual([fridge]);
    expect(result.current.source).toBe('mock');
  });

  it('Meta: boxes then outlines replace the detections', async () => {
    const outlined = { ...fridge, outline: 'M0.1 0.1L0.3 0.1L0.3 0.6Z' };
    fetchMock.mockResolvedValue(
      sse(
        ['vision_detections', boxes('meta')],
        ['vision_detections', { ...boxes('meta', [outlined]), phase: 'outlines', refined: 1 }],
        ['done', {}]
      )
    );
    const { result } = renderHook(() => useVisionDetection());
    await act(() => result.current.detect('data:x'));
    expect(result.current.status).toBe('ready');
    expect(result.current.detections[0]!.outline).toBe(outlined.outline);
  });

  it('HTTP error or vision_error without boxes → error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 413 }));
    const { result } = renderHook(() => useVisionDetection());
    await act(() => result.current.detect('data:x'));
    expect(result.current.status).toBe('error');

    fetchMock.mockResolvedValueOnce(sse(['vision_error', { code: 'VISION_FAILED' }], ['done', {}]));
    await act(() => result.current.detect('data:x'));
    expect(result.current.status).toBe('error');
  });

  it('ignores a malformed detections event (no power value can sneak in)', async () => {
    fetchMock.mockResolvedValue(
      sse(
        [
          'vision_detections',
          { phase: 'boxes', detections: [{ id: 'x', watts: 5 }], source: 'mock', model: 'm' },
        ],
        ['done', {}]
      )
    );
    const { result } = renderHook(() => useVisionDetection());
    await act(() => result.current.detect('data:x'));
    expect(result.current.detections).toEqual([]);
    expect(result.current.status).toBe('ready');
  });
});

describe('cancel (VS-T26)', () => {
  it('stops a running analysis: cancelled without boxes, then a retry asks again', async () => {
    // A call that never answers until aborted.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        )
    );
    const { result } = renderHook(() => useVisionDetection());
    let running!: Promise<void>;
    act(() => {
      running = result.current.detect('data:image/png;base64,AA');
    });
    await waitFor(() => expect(result.current.status).toBe('loading'));
    act(() => result.current.cancel());
    await act(() => running);
    expect(result.current.status).toBe('cancelled');
    const signal = (fetchMock.mock.calls[0]![1] as RequestInit).signal!;
    expect(signal.aborted).toBe(true);

    fetchMock.mockResolvedValue(sse(['vision_detections', boxes('mock')], ['done', {}]));
    await act(() => result.current.detect('data:image/png;base64,AA'));
    expect(result.current.status).toBe('ready');
  });

  it('keeps the boxes already shown when cancelled while refining', () => {
    expect(cancelledState({ status: 'refining', detections: [fridge] })).toEqual({
      status: 'ready',
      detections: [fridge],
    });
    const ready = { status: 'ready' as const, detections: [fridge] };
    expect(cancelledState(ready)).toBe(ready);
    expect(analysisStopped('cancelled')).toBe(true);
    expect(isAnalysing('refining')).toBe(true);
  });
});

describe('VisionDialog (PV-T7)', () => {
  it('runs detection when opened, selects an appliance, closes on Escape', async () => {
    fetchMock.mockResolvedValue(sse(['vision_detections', boxes('mock')], ['done', {}]));
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <VisionDialog imageUrl="data:image/png;base64,AA" onClose={onClose} />
      </I18nProvider>
    );
    expect(screen.getByRole('dialog', { name: 'Find appliances' })).toBeTruthy();
    const item = await screen.findByRole('button', { name: /Fridge/ });
    expect(screen.getByText('No appliance selected yet.')).toBeTruthy();
    fireEvent.click(item);
    expect(screen.getByText('Selected: Fridge')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
