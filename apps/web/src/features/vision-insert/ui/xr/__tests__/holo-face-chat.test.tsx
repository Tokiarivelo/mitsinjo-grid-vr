import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { I18nProvider } from '@/lib/i18n';
import en from '@/messages/en.json';
import type { HoloPanelHandlers } from '../holo-panel';

const session = vi.hoisted(() => ({ current: null as unknown }));
const panels = vi.hoisted(() => new Map<string, HoloPanelHandlers>());

vi.mock('@react-three/fiber', () => ({
  useThree: (sel: (s: unknown) => unknown) =>
    sel({ gl: { xr: { getSession: () => session.current } } }),
  useFrame: vi.fn(),
}));
vi.mock('../holo-panel', () => ({
  useHoloPanel: (registry: unknown, id: string, handlers: HoloPanelHandlers) => {
    if (registry) panels.set(id, handlers);
    else panels.delete(id);
    return () => {};
  },
}));
vi.mock('../holo-ui', () => ({
  HoloFrame: () => null,
  HoloText: ({ spec }: { spec: { lines: { text: string }[] } }) => (
    <p>{spec.lines.map((l) => l.text).join(' | ')}</p>
  ),
  HoloButton: (p: { label: string; disabled?: boolean; onSelect?: () => void }) => (
    <button type="button" disabled={p.disabled} onClick={p.onSelect}>
      {p.label}
    </button>
  ),
}));
vi.mock('../holo-chat-texture', () => ({ drawChatTexture: vi.fn(() => ({ dispose: vi.fn() })) }));
vi.mock('../holo-keyboard-texture', () => ({
  drawKeyboardTexture: vi.fn(() => ({ dispose: vi.fn() })),
}));
vi.mock('../lemur-bot', () => ({ LemurBot: () => <i data-testid="lemur-bot" /> }));

import { HoloFaceChat } from '../holo-face-chat';

const c = en.features.visionInsert.vrChat;
const tap = (id: string, u = 0, v = 0) =>
  act(() => panels.get(id)!.onSelect!({ uv: { x: u, y: v } } as unknown as THREE.Intersection));

function setup(props: Partial<Parameters<typeof HoloFaceChat>[0]> = {}) {
  const onSend = vi.fn();
  render(
    <I18nProvider>
      <HoloFaceChat
        registry={{ objects: [], add: vi.fn(), remove: vi.fn() }}
        hoveredId={null}
        viewName="Right side"
        messages={[]}
        busy={false}
        canEdit
        onSend={onSend}
        {...props}
      />
    </I18nProvider>
  );
  return { onSend };
}

describe('HoloFaceChat (VS-T27)', () => {
  beforeEach(() => {
    panels.clear();
    session.current = null;
  });

  it('names the view, labels the AI and shows the maki bot', () => {
    setup();
    expect(screen.getByText(/AI chat · Right side/)).toBeTruthy();
    expect(screen.getByText(/AI EDIT/)).toBeTruthy();
    expect(screen.getByTestId('lemur-bot')).toBeTruthy();
  });

  it('types on the holo keyboard, then « Send » hands the request over and empties the field', () => {
    const { onSend } = setup();
    const send = screen.getByRole('button', { name: c.send });
    expect(send).toHaveProperty('disabled', true); // nothing typed
    expect(panels.has('holo:chat-keys')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: c.keyboard }));
    // QWERTY row 2 starts with q: u ≈ 0.02, second row from the top (5 rows).
    tap('holo:chat-keys', 0.02, 1 - 1.5 / 5);
    tap('holo:chat-keys', 0.5, 0.05); // space
    tap('holo:chat-keys', 0.02, 1 - 1.5 / 5);
    expect(screen.getByText('q q▍')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: c.send }));
    expect(onSend).toHaveBeenCalledWith('q q');
    expect(screen.getByText(c.placeholder)).toBeTruthy();
  });

  it('tapping the field opens the keyboard', () => {
    setup();
    tap('holo:chat-field');
    expect(panels.has('holo:chat-keys')).toBe(true);
  });

  it('no request while a view draws, or when the view cannot be redrawn', () => {
    setup({ busy: true });
    fireEvent.click(screen.getByRole('button', { name: c.keyboard }));
    tap('holo:chat-keys', 0.02, 1 - 1.5 / 5);
    expect(screen.getByRole('button', { name: c.send })).toHaveProperty('disabled', true);
    expect(screen.getByText(c.wait)).toBeTruthy();
  });

  it('voice: unavailable without a speech API nor a system keyboard', () => {
    setup();
    expect(screen.getByRole('button', { name: c.voice })).toHaveProperty('disabled', true);
    expect(screen.getByText(c.voiceUnavailable)).toBeTruthy();
  });

  it('voice on Quest Browser: opens the system keyboard (its dictation key)', () => {
    session.current = { isSystemKeyboardSupported: true };
    setup();
    fireEvent.click(screen.getByRole('button', { name: c.voice }));
    expect((document.activeElement as HTMLElement).tagName).toBe('INPUT');
  });
});
