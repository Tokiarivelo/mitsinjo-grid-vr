import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import sharp from 'sharp';
import {
  askPartQuestions,
  MAX_PART_QUESTIONS,
  parsePartAnswer,
  partQuestion,
  zoneCropUrl,
  zoneRect,
  type PartAnswer,
} from '../part-question';

describe('partQuestion', () => {
  it('names the part and the expected place', () => {
    expect(partQuestion('rear window', 'rear')).toContain('rear window');
    expect(partQuestion('rear window', 'rear')).toContain('rear');
    expect(partQuestion('grille')).not.toContain('expected');
  });
});

describe('parsePartAnswer', () => {
  it('reads present + where + colour', () => {
    expect(parsePartAnswer('{"present":true,"where":"lower left","color":"#1A1A1A"}')).toEqual({
      present: true,
      where: 'lower left',
      color: '#1a1a1a',
    });
  });
  it('drops a bad colour instead of greying it', () => {
    expect(parsePartAnswer('{"present":false,"color":"red"}')).toEqual({ present: false });
  });
  it('refuses a missing present and bad JSON', () => {
    expect(parsePartAnswer('{"where":"left"}')).toBeNull();
    expect(parsePartAnswer('not json')).toBeNull();
    expect(parsePartAnswer('{"present":"yes"}')).toBeNull();
  });
});

describe('zoneRect', () => {
  it('maps place words to overlapping halves', () => {
    expect(zoneRect('lower left')).toEqual({ x: 0, y: 0.45, w: 0.55, h: 0.55 });
    expect(zoneRect('top centre')).toEqual({ x: 0.25, y: 0, w: 0.5, h: 0.55 });
  });
  it('keeps the whole frame without a crop direction', () => {
    expect(zoneRect(undefined)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    // Rear / front place along the depth, not on the crop: no cut without the yaw.
    expect(zoneRect('rear')).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('zoneCropUrl', () => {
  const crop = async () =>
    `data:image/png;base64,${await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer()
      .then((b) => b.toString('base64'))}`;

  it('cuts the zone and caps the long side', async () => {
    const url = await zoneCropUrl(await crop(), { x: 0, y: 0.45, w: 0.55, h: 0.55 });
    const meta = await sharp(Buffer.from(url.split(',')[1]!, 'base64')).metadata();
    // A small zone is enlarged to the cap, so a little part stays readable.
    expect([meta.width, meta.height]).toEqual([512, 256]);
  });
  it('returns the crop itself for the whole frame or a bad URL', async () => {
    const url = await crop();
    await expect(zoneCropUrl(url, { x: 0, y: 0, w: 1, h: 1 })).resolves.toBe(url);
    await expect(zoneCropUrl('not-a-url', { x: 0, y: 0, w: 0.5, h: 0.5 })).resolves.toBe(
      'not-a-url'
    );
  });
});

describe('askPartQuestions', () => {
  const ask = async (imageUrl: string, question: string): Promise<PartAnswer | null> => {
    asked.push([imageUrl, question]);
    return { present: true };
  };
  let asked: Array<[string, string]>;

  it('asks every part on its own zone, in parallel', async () => {
    asked = [];
    const url = `data:image/png;base64,${await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#808080' },
    })
      .png()
      .toBuffer()
      .then((b) => b.toString('base64'))}`;
    const out = await askPartQuestions(
      ask,
      url,
      [{ part: 'wheels', where: 'lower left' }, { part: 'grille' }],
      {}
    );
    expect(out).toEqual([
      { part: 'wheels', answer: { present: true } },
      { part: 'grille', answer: { present: true } },
    ]);
    // The zoned ask carries a re-encoded crop, the whole-frame ask the crop itself
    // (completion order, not call order: the asks run in parallel).
    const byPart = new Map(asked.map(([u, q]) => [q.includes('wheels') ? 'wheels' : 'grille', u]));
    expect(byPart.get('wheels')).not.toBe(url);
    expect(byPart.get('grille')).toBe(url);
  });
  it('caps the parts and nulls a failed ask', async () => {
    asked = [];
    const failing = async (imageUrl: string, question: string) => {
      asked.push([imageUrl, question]);
      if (question.includes('boom')) throw new Error('no');
      return { present: false };
    };
    const parts = Array.from({ length: MAX_PART_QUESTIONS + 2 }, (_, i) => ({
      part: i === 0 ? 'boom' : `part${i}`,
    }));
    const out = await askPartQuestions(failing, 'not-a-url', parts, {});
    expect(out).toHaveLength(MAX_PART_QUESTIONS);
    expect(out[0]).toEqual({ part: 'boom', answer: null });
    expect(out[1]).toEqual({ part: 'part1', answer: { present: false } });
  });
});
