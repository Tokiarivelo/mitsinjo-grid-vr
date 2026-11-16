import { describe, expect, it } from 'vitest';
import { layoutChat } from '../holo-chat-texture';

const measure = (s: string) => s.length * 20;

describe('layoutChat (VS-T27)', () => {
  it('puts the operator on the right, the bot on the left, newest at the bottom', () => {
    const bubbles = layoutChat(
      measure,
      [
        { role: 'user', text: 'red roof' },
        { role: 'bot', text: 'Redrawing…', pending: true },
      ],
      1024,
      600
    );
    expect(bubbles).toHaveLength(2);
    const [user, bot] = bubbles;
    expect(user!.x + user!.width).toBeGreaterThan(900);
    expect(bot!.x).toBeLessThan(50);
    expect(bot!.y).toBeGreaterThan(user!.y);
  });

  it('drops the oldest bubbles that no longer fit', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 ? ('bot' as const) : ('user' as const),
      text: `message ${i}`,
    }));
    const bubbles = layoutChat(measure, items, 1024, 400);
    expect(bubbles.length).toBeLessThan(30);
    expect(bubbles.at(-1)!.item.text).toBe('message 29');
    expect(bubbles[0]!.y).toBeGreaterThanOrEqual(0);
  });
});
