import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';

vi.mock('../utils/prepare-image', async (orig) => ({
  ...(await orig<typeof import('../utils/prepare-image')>()),
  prepareVisionImage: vi.fn(async () => new Blob([new Uint8Array(4)], { type: 'image/jpeg' })),
}));

// WebGL on (jsdom has none), viewer stubbed: the test is about when Spark is asked.
vi.mock('@/features/microgrid-3d', async (orig) => ({
  ...(await orig<typeof import('@/features/microgrid-3d')>()),
  useWebGLAvailable: () => true,
}));
vi.mock('../ui/object-editor-3d', () => ({ ObjectEditor3d: () => <div>viewer</div> }));

import { SAMPLE_ROOM_URL, VillageEditorPage } from '../index';
import { clearKeptState } from '../hooks/use-kept-state';

const detections = [
  { id: 'det-1', label: 'Fridge', category: 'fridge', box: { x: 0.1, y: 0.1, w: 0.2, h: 0.5 } },
  { id: 'det-2', label: 'Samsung TV', category: 'tv', box: { x: 0.5, y: 0.3, w: 0.2, h: 0.2 } },
  {
    id: 'det-3',
    label: 'Stone house',
    kind: 'scenery',
    scenery: 'building',
    category: 'other',
    box: { x: 0.7, y: 0.1, w: 0.2, h: 0.2 },
  },
];
const shapeReply = {
  detectionId: 'det-2',
  mode: 'recipe',
  recipe: {
    proportions: { w: 1, h: 0.6, d: 0.1 },
    parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#222222', front: true }],
  },
  source: 'mock',
  model: 'mock-perception-v1',
};
const sseBody = `event: vision_detections\ndata: ${JSON.stringify({ phase: 'boxes', detections, source: 'mock', model: 'm' })}\n\nevent: done\ndata: {}\n\n`;

const facadeReply = {
  ok: true,
  imageUrl: 'data:image/png;base64,FACADE',
  fileKey: 'vision/facades/det_1.png',
  prompt: 'p',
  archetype: 'house',
  detectionId: 'det',
  source: 'mock',
};

/** 2D facade first (imagine, then validate): that is what starts the 3D build. */
async function buildFromFacade() {
  fireEvent.click(screen.getByRole('button', { name: 'Imagine 2D facade' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Validate & Generate 3D' }));
}

const originalFetch = global.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearKeptState();
  fetchMock = vi.fn(async (url: string) =>
    url === SAMPLE_ROOM_URL
      ? // jsdom's FileReader only reads its own Blob, not Node's Response.blob().
        ({ blob: async () => new Blob([new Uint8Array(8)], { type: 'image/jpeg' }) } as Response)
      : url === '/api/vision/facade'
        ? new Response(JSON.stringify(facadeReply), {
            headers: { 'Content-Type': 'application/json' },
          })
        : url === '/api/vision/shape'
          ? new Response(
              `event: shape_result\ndata: ${JSON.stringify({ shape: shapeReply })}\n\nevent: done\ndata: {}\n\n`
            )
          : new Response(sseBody, { headers: { 'Content-Type': 'text/event-stream' } })
  );
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
});

const renderPage = () =>
  render(
    <I18nProvider>
      <VillageEditorPage />
    </I18nProvider>
  );

describe('VillageEditorPage (/village)', () => {
  it('starts with the photo picker and the simulated-data label', () => {
    renderPage();
    expect(screen.getByText('Drop a photo here')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose a photo' })).toBeTruthy();
    expect(screen.getAllByText('SIMULATED DATA').length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
    // Current village state sits next to the editor (2D plan in jsdom: no WebGL).
    expect(screen.getByText('Village Grid Digital Twin')).toBeTruthy();
  });

  it('refuses a file that is not a JPEG, PNG or WebP photo', async () => {
    renderPage();
    const input = screen.getByLabelText('Choose a photo', { selector: 'input' });
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] },
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Use a JPEG, PNG or WebP photo.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sample room → detections → select one', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Use the sample room' }));
    const tv = await screen.findByRole('button', { name: /Samsung TV/ }, { timeout: 5000 });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([SAMPLE_ROOM_URL, '/api/vision']);
    expect(screen.getByText('No appliance selected yet.')).toBeTruthy();
    fireEvent.click(tv);
    expect(screen.getByText('Selected: Samsung TV (Television)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeTruthy();
  });

  it('builds the 3D model of any selected object once, scenery included (PV-T10)', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Use the sample room' }));
    const tv = await screen.findByRole('button', { name: /Samsung TV/ }, { timeout: 5000 });
    fireEvent.click(tv);
    expect(screen.getByText('3D model')).toBeTruthy();
    const shapeCalls = () => fetchMock.mock.calls.filter((c) => c[0] === '/api/vision/shape');
    // Selecting (e.g. to adjust the box) asks nothing: the operator starts the 3D build.
    expect(screen.getByText('Not built yet')).toBeTruthy();
    expect(shapeCalls()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Generate the 3D model' })).toBeNull();
    await buildFromFacade();
    expect(await screen.findByText('AI shape')).toBeTruthy();
    expect(shapeCalls()).toHaveLength(1);
    const target = JSON.parse(
      (shapeCalls()[0]![1] as RequestInit & { body: FormData }).body.get('target') as string
    );
    expect(target).toEqual({
      id: 'det-2',
      label: 'Samsung TV',
      category: 'tv',
      box: detections[1]!.box,
      // The validated 2D facade goes with the 3D request.
      facadeUrl: facadeReply.imageUrl,
      facadeKey: facadeReply.fileKey,
    });

    // Scenery is modelled too: the scenery type goes with the request.
    fireEvent.click(screen.getByRole('button', { name: /Stone house/ }));
    expect(screen.getByText('3D model')).toBeTruthy();
    expect(shapeCalls()).toHaveLength(1);
    await buildFromFacade();
    await waitFor(() => expect(shapeCalls()).toHaveLength(2));
    const house = JSON.parse(
      (shapeCalls()[1]![1] as RequestInit & { body: FormData }).body.get('target') as string
    );
    expect(house).toMatchObject({ id: 'det-3', category: 'other', scenery: 'building' });
    // Back to the TV: kept shape, no new Spark call.
    fireEvent.click(screen.getByRole('button', { name: /Samsung TV/ }));
    expect(await screen.findByText('AI shape')).toBeTruthy();
    expect(shapeCalls()).toHaveLength(2);
  }, 15000);

  it('keeps the photo, objects, 2D facade and 3D model after leaving the page', async () => {
    const first = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Use the sample room' }));
    fireEvent.click(await screen.findByRole('button', { name: /Samsung TV/ }, { timeout: 5000 }));
    await buildFromFacade();
    expect(await screen.findByText('AI shape')).toBeTruthy();
    const calls = fetchMock.mock.calls.length;

    // Another page (e.g. /simulation), then back to /village.
    first.unmount();
    renderPage();
    expect(screen.getByText('Selected: Samsung TV (Television)')).toBeTruthy();
    expect(await screen.findByText('AI shape')).toBeTruthy();
    expect(screen.queryByText('Drop a photo here')).toBeNull();
    // Nothing is asked again: no new detection, facade or 3D call.
    expect(fetchMock.mock.calls.length).toBe(calls);
  }, 15000);

  it('shows the WebXR button when supported and toggles the immersive diorama viewport', async () => {
    vi.stubGlobal('navigator', { xr: { isSessionSupported: async () => true } });
    renderPage();
    const vrBtn = await screen.findByRole('button', { name: 'View in VR immersion' });
    expect(vrBtn).toBeTruthy();

    fireEvent.click(vrBtn);
    expect(await screen.findByTestId('village-xr-viewport')).toBeTruthy();

    const exitBtns = screen.getAllByRole('button', { name: 'Exit VR immersion' });
    expect(exitBtns.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(exitBtns[0]!);
    expect(screen.queryByTestId('village-xr-viewport')).toBeNull();
    vi.unstubAllGlobals();
  });
});
