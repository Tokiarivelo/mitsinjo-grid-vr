'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useAppLocale, useTranslations } from '@/lib/i18n';
import { CHAT_MAX_CHARS, chatBusy, type ChatMessage } from '../../utils/face-chat';
import {
  keyAtUv,
  keyboardRows,
  keyRects,
  pressKey,
  type KeyboardState,
} from '../../utils/xr-keyboard';
import { useVoiceInput } from '../../hooks/use-voice-input';
import { systemKeyboardSupported, useSystemKeyboard } from '../../hooks/use-system-keyboard';
import { useHoloPanel, type PanelRegistry } from './holo-panel';
import { HoloButton, HoloFrame, HoloText } from './holo-ui';
import { HOLO, HOLO_TEXT_DMM, holoTextPx, type HoloCardSpec } from './holo-style';
import { HoloVoiceMeter } from './holo-voice-meter';
import { drawChatTexture, type ChatBubbleItem } from './holo-chat-texture';
import { drawKeyboardTexture } from './holo-keyboard-texture';
import { LemurBot } from './lemur-bot';
import type { AimReadout } from './xr-blaster-controller';
import { CHAT_PANEL, STUDIO_CHAT_POSITION, STUDIO_CHAT_YAW } from './xr-layout';

export const CHAT_IDS = {
  field: 'holo:chat-field',
  keyboard: 'holo:chat-keyboard',
  voice: 'holo:chat-voice',
  send: 'holo:chat-send',
  keys: 'holo:chat-keys',
} as const;

const { width: W, historyHeight: HH, distance: D } = CHAT_PANEL;
/** Field and button rows: 10 cm, room for a 24 dmm label at 1.4 m (≈ 3.4 cm). */
const ROW_H = 0.1;
const GAP = 0.02;
const HEADER_H = 0.1;
const HEADER_Y = HH / 2 + HEADER_H / 2 + 0.015;
/** Field on its own full-width row, then « Keyboard » · « Dictate » · « Send » with icons. */
const FIELD_Y = -HH / 2 - ROW_H / 2 - 0.015;
const BTN_Y = FIELD_Y - ROW_H - 0.015;
const BTN_W = { keys: 0.21, voice: 0.21, send: W - 0.42 - 2 * GAP } as const;
const HINT_H = 0.045;
const HINT_Y = BTN_Y - ROW_H / 2 - 0.012 - HINT_H / 2;
const KEYS_H = 0.29;
const KEYS_Y = HINT_Y - HINT_H / 2 - 0.02 - KEYS_H / 2;
/** Voice level meter, inside the field on the right while dictating (VS-T29). */
const METER_W = 0.17;
const METER_H = ROW_H * 0.8;
/** Frame round the chat: header top to the buttons' bottom. */
const FRAME_TOP = HEADER_Y + HEADER_H / 2 + 0.01;
const FRAME_BOTTOM = BTN_Y - ROW_H / 2 - 0.015;
/** Text sizes (canvas px) for their planes, in dmm at the chat distance. */
const px = (dmm: number, planeWidth: number) => holoTextPx(dmm, planeWidth, D);

const _local = new THREE.Vector3();

export interface HoloFaceChatProps {
  registry: PanelRegistry;
  hoveredId: string | null;
  /** Name of the view in focus (« Right side »…): the requests go to it. */
  viewName: string;
  messages: readonly ChatMessage[];
  /** A view is drawing: no request until it is done (one drawing at a time). */
  busy: boolean;
  /** The view in focus can be redrawn (drawn or failed). */
  canEdit: boolean;
  onSend: (text: string) => void;
  /** Live pointer aim: the bot looks at the cursor, the hovered key lights up. */
  aim?: AimReadout;
}

/**
 * Chat of the 2D views (VS-T27), left of the carousel, facing the viewer: the history of the view
 * in focus (operator in cyan, AI bot in violet), a field written with the holo keyboard or by
 * voice, and « Send ». Sending redraws that view with the request as its details (the 2D panel's
 * call). The maki bot sits on the top-right corner, follows the cursor and blinks.
 */
export const HoloFaceChat = memo(function HoloFaceChat({
  registry,
  hoveredId,
  viewName,
  messages,
  busy,
  canEdit,
  onSend,
  aim,
}: HoloFaceChatProps) {
  const t = useTranslations('features.visionInsert.vrChat');
  const { locale } = useAppLocale();
  const gl = useThree((s) => s.gl);
  const [kb, setKb] = useState<KeyboardState>({ draft: '', shift: false });
  const [keysOpen, setKeysOpen] = useState(false);

  const append = useCallback(
    (said: string) =>
      setKb((s) => ({
        ...s,
        draft: (s.draft ? `${s.draft.trimEnd()} ${said}` : said).slice(0, CHAT_MAX_CHARS),
      })),
    []
  );
  const voice = useVoiceInput(locale, append);
  const openSystemKeyboard = useSystemKeyboard(
    (text) => setKb((s) => ({ ...s, draft: text.slice(0, CHAT_MAX_CHARS) })),
    CHAT_MAX_CHARS
  );
  const systemKeys = systemKeyboardSupported(gl.xr.getSession());
  const voiceReady = voice.supported || systemKeys;

  const onVoice = () => {
    if (voice.listening) return voice.stop();
    if (voice.supported) return voice.start();
    // No speech API (Quest Browser): the system keyboard has its own dictation key.
    if (systemKeys) openSystemKeyboard(kb.draft);
  };

  const canSend = canEdit && !busy && kb.draft.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    onSend(kb.draft);
    setKb({ draft: '', shift: false });
    if (voice.listening) voice.stop();
  };

  // History texture: one canvas, redrawn when the history or the language changes.
  const items = useMemo<ChatBubbleItem[]>(
    () =>
      messages.map((m) =>
        m.role === 'user'
          ? { role: 'user', text: m.text ?? '' }
          : {
              role: 'bot',
              text:
                m.kind === 'working'
                  ? t('working', { view: viewName })
                  : m.kind === 'error'
                    ? t('failed')
                    : t('done'),
              ...(m.kind === 'working' ? { pending: true } : {}),
              ...(m.kind === 'error' ? { error: true } : {}),
            }
      ),
    [messages, t, viewName]
  );
  const historyTex = useRef<THREE.CanvasTexture | null>(null);
  const history = useMemo(() => {
    historyTex.current = drawChatTexture(
      items,
      t('empty', { view: viewName }),
      1024,
      Math.round((1024 * HH) / W),
      historyTex.current ?? undefined,
      px(HOLO_TEXT_DMM.body, W)
    );
    return historyTex.current;
  }, [items, t, viewName]);
  useEffect(() => () => historyTex.current?.dispose(), []);

  const header = useMemo<HoloCardSpec>(
    () => ({
      glass: false,
      align: 'left',
      accent: HOLO.violet,
      lines: [
        {
          text: t('title', { view: viewName }),
          size: px(HOLO_TEXT_DMM.title, W * 0.7),
          weight: 700,
        },
        {
          text: t('aiLabel'),
          size: px(HOLO_TEXT_DMM.caption, W * 0.7),
          weight: 600,
          color: HOLO.violet,
        },
      ],
    }),
    [t, viewName]
  );

  const listening = voice.listening;
  const shown = listening && voice.interim ? `${kb.draft} ${voice.interim}`.trim() : kb.draft;
  // While dictating the level meter takes the field's right end: the text keeps the rest.
  const fieldTextW = W * 0.97 - (listening ? METER_W + 0.02 : 0);
  const fieldSpec = useMemo<HoloCardSpec>(
    () => ({
      glass: false,
      align: 'left',
      accent: listening ? HOLO.amber : HOLO.cyan,
      lines: [
        shown
          ? { text: `${shown}▍`, size: px(HOLO_TEXT_DMM.label, fieldTextW), weight: 600 }
          : {
              text: listening ? t('listening') : t('placeholder'),
              size: px(HOLO_TEXT_DMM.label, fieldTextW),
              weight: 400,
              color: listening ? HOLO.amber : HOLO.cyan,
            },
      ],
    }),
    [shown, listening, t, fieldTextW]
  );

  // Keyboard: one plane, the key from the hit's UV.
  const rects = useMemo(() => keyRects(keyboardRows(locale)), [locale]);
  const keysTex = useMemo(
    () =>
      keysOpen
        ? drawKeyboardTexture(rects, kb.shift, {
            shift: t('keyShift'),
            space: t('keySpace'),
            back: t('keyBack'),
            clear: t('keyClear'),
          })
        : null,
    [keysOpen, rects, kb.shift, t]
  );
  useEffect(() => () => keysTex?.dispose(), [keysTex]);
  const keysRef = useHoloPanel(keysOpen ? registry : undefined, CHAT_IDS.keys, {
    onSelect: (hit) => {
      if (!hit.uv) return;
      const key = keyAtUv(rects, hit.uv.x, hit.uv.y);
      if (key) setKb((s) => pressKey(s, key, CHAT_MAX_CHARS));
    },
  });
  const fieldRef = useHoloPanel(registry, CHAT_IDS.field, {
    onSelect: () => setKeysOpen(true),
  });

  // Hovered key highlight: the pointer's beam end in keyboard space (no texture redraw).
  const keysMesh = useRef<THREE.Mesh | null>(null);
  const highlight = useRef<THREE.Mesh>(null);
  const keysHovered = hoveredId === CHAT_IDS.keys;
  useFrame(() => {
    const hl = highlight.current;
    const mesh = keysMesh.current;
    if (!hl) return;
    hl.visible = false;
    if (!keysHovered || !mesh || !aim) return;
    const p = aim.pointers.find((x) => x.visible && x.id === CHAT_IDS.keys);
    if (!p) return;
    mesh.worldToLocal(_local.copy(p.end));
    const key = keyAtUv(rects, _local.x / W + 0.5, _local.y / KEYS_H + 0.5);
    if (!key) return;
    hl.visible = true;
    hl.position.set(
      (key.x + key.width / 2 - 0.5) * W,
      (0.5 - key.y - key.height / 2) * KEYS_H,
      0.002
    );
    hl.scale.set(key.width * W, key.height * KEYS_H, 1);
  });

  const working = busy || chatBusy(messages);
  const x0 = -W / 2;
  return (
    <group position={STUDIO_CHAT_POSITION} rotation={[0, STUDIO_CHAT_YAW, 0]} name="holo-face-chat">
      <HoloFrame
        width={W + 0.03}
        height={FRAME_TOP - FRAME_BOTTOM}
        color={HOLO.violet}
        active={working}
        position={[0, (FRAME_TOP + FRAME_BOTTOM) / 2, -0.004]}
      />
      <HoloText
        spec={header}
        width={W * 0.7}
        height={HEADER_H}
        position={[-W * 0.13, HEADER_Y, 0.002]}
      />
      <mesh position={[0, 0, 0.002]} renderOrder={3}>
        <planeGeometry args={[W, HH]} />
        <meshBasicMaterial
          map={history}
          transparent
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <HoloButton
        registry={registry}
        id={CHAT_IDS.keyboard}
        label={t('keyboard')}
        icon="keyboard"
        tip={t('keyboardTip')}
        distance={D}
        width={BTN_W.keys}
        height={ROW_H}
        position={[x0 + BTN_W.keys / 2, BTN_Y, 0.004]}
        on={keysOpen}
        hovered={hoveredId === CHAT_IDS.keyboard}
        onSelect={() => setKeysOpen((o) => !o)}
      />
      <group position={[0, FIELD_Y, 0.004]}>
        <HoloFrame
          width={W}
          height={ROW_H}
          color={listening ? HOLO.amber : HOLO.cyan}
          hovered={hoveredId === CHAT_IDS.field}
          panelRef={fieldRef}
        />
        <HoloText
          spec={fieldSpec}
          width={fieldTextW}
          height={ROW_H * 0.86}
          position={[-(W * 0.97 - fieldTextW) / 2, 0, 0.002]}
        />
        {listening && (
          <HoloVoiceMeter
            analyser={voice.analyser}
            width={METER_W}
            height={METER_H}
            title={t('meterTitle')}
            distance={D}
            position={[W / 2 - METER_W / 2 - 0.008, 0, 0.003]}
          />
        )}
      </group>
      <HoloButton
        registry={registry}
        id={CHAT_IDS.voice}
        label={listening ? t('stop') : t('voice')}
        icon={listening ? 'stop' : 'mic'}
        tip={listening ? t('stopTip') : t('voiceTip')}
        distance={D}
        width={BTN_W.voice}
        height={ROW_H}
        position={[x0 + BTN_W.keys + GAP + BTN_W.voice / 2, BTN_Y, 0.004]}
        color={HOLO.amber}
        on={listening}
        disabled={!voiceReady}
        hovered={hoveredId === CHAT_IDS.voice}
        onSelect={onVoice}
      />
      <HoloButton
        registry={registry}
        id={CHAT_IDS.send}
        label={t('send')}
        icon="send"
        tip={t('sendTip')}
        distance={D}
        width={BTN_W.send}
        height={ROW_H}
        position={[W / 2 - BTN_W.send / 2, BTN_Y, 0.004]}
        color={HOLO.violet}
        disabled={!canSend}
        hovered={hoveredId === CHAT_IDS.send}
        onSelect={send}
      />
      {(busy || !canEdit || !voiceReady || voice.error) && (
        <HoloText
          spec={{
            glass: false,
            lines: [
              {
                text:
                  busy || !canEdit
                    ? t('wait')
                    : voice.error
                      ? t('voiceError')
                      : t('voiceUnavailable'),
                size: px(HOLO_TEXT_DMM.caption, W),
                weight: 600,
                color: HOLO.amber,
              },
            ],
          }}
          width={W}
          height={HINT_H}
          position={[0, HINT_Y, 0.004]}
        />
      )}

      {keysOpen && keysTex && (
        <group position={[0, KEYS_Y, 0.03]} rotation={[-0.35, 0, 0]}>
          <mesh
            ref={(o) => {
              keysMesh.current = o;
              keysRef(o);
            }}
            renderOrder={3}
          >
            <planeGeometry args={[W, KEYS_H]} />
            <meshBasicMaterial
              map={keysTex}
              transparent
              depthWrite={false}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh ref={highlight} visible={false} renderOrder={4}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              color={HOLO.cyan}
              transparent
              opacity={0.35}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}

      <LemurBot
        position={[W / 2 - 0.02, HEADER_Y + 0.02, 0.07]}
        size={0.065}
        aim={aim}
        busy={working}
      />
    </group>
  );
});
