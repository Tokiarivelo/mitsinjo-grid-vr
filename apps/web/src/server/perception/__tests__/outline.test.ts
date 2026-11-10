import { describe, expect, it, vi } from 'vitest';
import { MAX_DETECTIONS } from '../detect';
import {
  conceptOf,
  fetchOutlineForBox,
  iou,
  refineDetections,
  samBoxToNorm,
  samRetries,
} from '../outline';
import { boxUnionCoverage, parseSamOutput } from '../parse-sam';
import type { ApplianceDetection, SegmentResult } from '../schemas';

// Recorded sam-3.1 shape (masks shortened): two instances on a 1920 × 1280 photo.
const SAM_TEXT =
  '<0f>0<|box;x1=1179;y1=585;x2=1900;y2=1071;w=1920;h=1280;c=0.96|><|mask;x=0;y=0;c=0.96;data=487,722,!!!!$q@|>,' +
  '1<|box;x1=16;y1=586;x2=748;y2=1094;w=1920;h=1280;c=0.94|><|mask;x=0;y=0;c=0.94;data=509,733,!!!!4P|>';

function samResult(concept: string, text = SAM_TEXT): SegmentResult {
  const { imageWidth, imageHeight, instances } = parseSamOutput(text);
  return {
    source: 'meta',
    model: 'sam-3.1',
    concept,
    imageWidth,
    imageHeight,
    instances,
    count: instances.length,
    boxCoverage: boxUnionCoverage(
      instances.map((i) => i.box),
      imageWidth,
      imageHeight
    ),
  };
}

const det = (id: string, label: string, box: ApplianceDetection['box']): ApplianceDetection => ({
  id,
  label,
  category: 'fridge',
  box,
});

// Muse boxes near the two SAM instances (grid precision), plus a lamp elsewhere.
const left = det('det-1', 'Fridge', { x: 0.01, y: 0.45, w: 0.38, h: 0.41 });
const right = det('det-2', 'fridge', { x: 0.62, y: 0.46, w: 0.37, h: 0.38 });
const lamp = det('det-3', 'Lamp', { x: 0.45, y: 0.02, w: 0.05, h: 0.05 });

describe('box helpers', () => {
  it('iou', () => {
    const a = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(iou(a, a)).toBeCloseTo(1);
    expect(iou(a, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 })).toBe(0);
    expect(iou(a, { x: 0.25, y: 0, w: 0.5, h: 0.5 })).toBeCloseTo(1 / 3);
  });

  it('samBoxToNorm counts inclusive pixels and clamps', () => {
    expect(samBoxToNorm({ x1: 0, y1: 0, x2: 9, y2: 4 }, 10, 10)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 0.5,
    });
    expect(samBoxToNorm({ x1: 0, y1: 0, x2: 50, y2: 50 }, 10, 10)).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
    expect(samBoxToNorm({ x1: 0, y1: 0, x2: 1, y2: 1 }, 0, 10)).toBeNull();
  });
});

describe('conceptOf (PR-2.21)', () => {
  const c = (label: string) => conceptOf({ label });
  it('reduces descriptive labels to one SAM noun', () => {
    expect(c('mini vintage')).toBe('car');
    expect(c('Mini Cooper')).toBe('car');
    expect(c('cottages en pierre à droite')).toBe('house');
    expect(c('Street lamp')).toBe('street lamp');
    // before: 'lamp' — SAM found nothing on the 2D view, so the lamp post never reached its stages.
    expect(c('lamp post')).toBe('street lamp');
    expect(c('Lamppost')).toBe('street lamp');
    expect(c('street light')).toBe('street lamp');
    expect(c('table lamp')).toBe('lamp');
    expect(c('Réfrigérateur')).toBe('fridge');
    expect(c('Panneau solaire')).toBe('solar panel');
    expect(c('power plant')).toBe('building');
    expect(c('Main street')).toBe('main street');
  });
  it('takes the head noun, the last one before a complement (PQ-T1 real captures)', () => {
    // before: 'car' (« vintage » is a car word, its rule came first) → SAM found nothing; « tv » IoU 0.96.
    expect(c('vintage TV')).toBe('tv');
    expect(c('red vintage car')).toBe('car');
    expect(c("traveller's palm tree")).toBe('tree');
    expect(c('antique hand water pump')).toBe('pump');
    expect(c('row of terrace houses')).toBe('house');
    expect(c('car with solar panel on the roof')).toBe('car');
    expect(c('lamp post near the house')).toBe('street lamp');
  });
  it('keeps short labels and unknown ones untouched', () => {
    expect(c('fridge')).toBe('fridge');
    expect(c('lamp')).toBe('lamp');
    expect(c('xyz unknown thing')).toBe('xyz unknown thing');
  });
});

describe('fetchOutlineForBox (PR-2.20)', () => {
  const OUTLINE = 'M0.61 0.46L0.99 0.46L0.99 0.84L0.61 0.84Z';
  const car = { x: 0.6, y: 0.45, w: 0.4, h: 0.4 };
  const outlined = () => {
    const seg = samResult('car');
    seg.instances[0] = { ...seg.instances[0]!, outline: OUTLINE };
    return seg;
  };
  it('best-matching instance lends its outline', async () => {
    const out = await fetchOutlineForBox(async () => outlined(), 'data:x', 'car', car);
    expect(out).toBe(OUTLINE);
  });
  it('no match, mock answer or failure → null, never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const far = { x: 0, y: 0, w: 0.1, h: 0.1 };
      expect(await fetchOutlineForBox(async () => outlined(), 'data:x', 'car', far)).toBeNull();
      const mock = { ...outlined(), source: 'mock' as const };
      expect(await fetchOutlineForBox(async () => mock, 'data:x', 'car', car)).toBeNull();
      expect(
        await fetchOutlineForBox(
          async () => {
            throw new Error('boom');
          },
          'data:x',
          'car',
          car
        )
      ).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('samRetries (PQ-T9)', () => {
  it('full label first, then the lookalike SAM knows; never the noun itself', () => {
    expect(samRetries({ label: 'utility pole' })).toEqual(['utility pole']);
    expect(samRetries({ label: 'hand water pump' })).toEqual(['hand water pump', 'fire hydrant']);
    expect(samRetries({ label: 'pump' })).toEqual(['fire hydrant']);
    expect(samRetries({ label: 'tv' })).toEqual([]);
  });
  it('walks the retries in order until one hits', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const OUTLINE = 'M0.61 0.46L0.99 0.46L0.99 0.84L0.61 0.84Z';
      const asked: string[] = [];
      const seg = async (_url: string, concept: string) => {
        asked.push(concept);
        const r = samResult(concept);
        if (concept !== 'fire hydrant') return { ...r, instances: [], count: 0 };
        r.instances[0] = { ...r.instances[0]!, outline: OUTLINE };
        return r;
      };
      const box = { x: 0.6, y: 0.45, w: 0.4, h: 0.4 };
      const retries = samRetries({ label: 'hand water pump' });
      expect(await fetchOutlineForBox(seg, 'data:x', 'pump', box, { retries })).toBe(OUTLINE);
      expect(asked).toEqual(['pump', 'hand water pump', 'fire hydrant']);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('fetchOutlineForBox label fallback (PQ-T1)', () => {
  const OUTLINE = 'M0.61 0.46L0.99 0.46L0.99 0.84L0.61 0.84Z';
  const pole = { x: 0.6, y: 0.45, w: 0.4, h: 0.4 };
  it('retries once with the full label when the noun misses (« pole » → « utility pole »)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const asked: string[] = [];
      const seg = async (_url: string, concept: string) => {
        asked.push(concept);
        const r = samResult(concept);
        if (concept !== 'utility pole') return { ...r, instances: [], count: 0 };
        r.instances[0] = { ...r.instances[0]!, outline: OUTLINE };
        return r;
      };
      const out = await fetchOutlineForBox(seg, 'data:x', 'pole', pole, {
        retries: ['Utility Pole'],
      });
      expect(out).toBe(OUTLINE);
      expect(asked).toEqual(['pole', 'utility pole']);
    } finally {
      warn.mockRestore();
    }
  });
  it('no second call when the label is the concept', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let calls = 0;
      const seg = async (_url: string, concept: string) => {
        calls++;
        return { ...samResult(concept), instances: [], count: 0 };
      };
      expect(
        await fetchOutlineForBox(seg, 'data:x', 'pump', pole, { retries: ['pump'] })
      ).toBeNull();
      expect(calls).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('fetchOutlineForBox miss causes (FIX 1)', () => {
  const OUTLINE = 'M0.61 0.46L0.99 0.46L0.99 0.84L0.61 0.84Z';
  const car = { x: 0.6, y: 0.45, w: 0.4, h: 0.4 };
  const outlined = () => {
    const seg = samResult('car');
    seg.instances[0] = { ...seg.instances[0]!, outline: OUTLINE };
    return seg;
  };
  const silenced = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('timeout names the concept and the budget', async () => {
    const warn = silenced();
    try {
      const hanging = () => new Promise<SegmentResult>(() => {});
      expect(await fetchOutlineForBox(hanging, 'data:x', 'car', car, { timeoutMs: 20 })).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[vision] 3D outline missed for "car": SAM timed out after 20ms'
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('empty answer and no-match warn with the best IoU', async () => {
    const warn = silenced();
    try {
      expect(
        await fetchOutlineForBox(async () => samResult('car', ''), 'data:x', 'car', car)
      ).toBeNull();
      expect(warn).toHaveBeenCalledWith('[vision] 3D outline missed for "car": SAM found nothing');
      const far = { x: 0, y: 0, w: 0.1, h: 0.1 };
      expect(await fetchOutlineForBox(async () => outlined(), 'data:x', 'car', far)).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[vision] 3D outline missed for "car": best IoU 0.00 < 0.3 (2 instances)'
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('crop fallback (FIX 2): full miss + crop hit → outline remapped to photo space', async () => {
    const warn = silenced();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      // Photo 200×100, box (40, 20, 80×40); crop rect (20, 10, 160×80) sent at 640×320.
      const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
      const crop = {
        url: 'data:crop',
        rect: { left: 20, top: 10, width: 160, height: 80, outWidth: 640, outHeight: 320 },
        photoW: 200,
        photoH: 100,
      };
      const cropSeg = samResult('car', '<0f>0<|box;x1=80;y1=40;x2=399;y2=199;w=640;h=320;c=0.9|>');
      cropSeg.instances[0] = {
        ...cropSeg.instances[0]!,
        outline: 'M0.125 0.125L0.625 0.125L0.625 0.625L0.125 0.625Z',
      };
      const segmentImage = vi.fn(async (url: string, concept: string) => {
        expect(concept).toBe('car');
        return url === 'data:crop' ? cropSeg : samResult('car', '');
      });
      const out = await fetchOutlineForBox(segmentImage, 'data:full', 'car', box, { crop });
      expect(out).toBe('M0.2 0.2L0.6 0.2L0.6 0.6L0.2 0.6Z');
      expect(segmentImage.mock.calls.map((c) => c[0])).toEqual(['data:full', 'data:crop']);
      expect(warn).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(
        '[vision] 3D outline for "car" adopted from the crop (full photo: SAM found nothing)'
      );
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it('crop fallback: full hit skips the crop; double miss warns once with both causes', async () => {
    const warn = silenced();
    try {
      const crop = {
        url: 'data:crop',
        rect: { left: 0, top: 0, width: 100, height: 100, outWidth: 640, outHeight: 640 },
        photoW: 100,
        photoH: 100,
      };
      const hitOnce = vi.fn(async () => outlined());
      expect(await fetchOutlineForBox(hitOnce, 'data:full', 'car', car, { crop })).toBe(OUTLINE);
      expect(hitOnce).toHaveBeenCalledTimes(1);

      const doubleMiss = vi.fn(async (url: string) => {
        if (url === 'data:full') throw new Error('boom');
        return samResult('car', '');
      });
      expect(await fetchOutlineForBox(doubleMiss, 'data:full', 'car', car, { crop })).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[vision] 3D outline missed for "car": SAM call failed; crop: SAM found nothing'
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('instances without readable masks say so; a hit stays silent', async () => {
    const warn = silenced();
    try {
      // parseSamOutput never attaches outlines (meta.ts does): a match without one.
      expect(
        await fetchOutlineForBox(async () => samResult('car'), 'data:x', 'car', car)
      ).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        '[vision] 3D outline missed for "car": no instance has a readable mask (2 instances)'
      );
      warn.mockClear();
      expect(await fetchOutlineForBox(async () => outlined(), 'data:x', 'car', car)).toBe(OUTLINE);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('refineDetections (PV-T5)', () => {
  it('groups SAM calls by normalized concept (one call for two car wordings)', async () => {
    const segmentImage = vi.fn(async (_url: string, _concept: string) => samResult(_concept, ''));
    const a = det('det-1', 'mini vintage', { x: 0.01, y: 0.45, w: 0.38, h: 0.41 });
    const b = det('det-2', 'Mini Cooper', { x: 0.62, y: 0.46, w: 0.37, h: 0.38 });
    await refineDetections({ segmentImage }, 'data:x', [a, b]);
    expect(segmentImage.mock.calls.map((c) => c[1])).toEqual(['car']);
  });

  it('one SAM call per distinct label, in parallel; matched boxes take the SAM box', async () => {
    const segmentImage = vi.fn(async (_url: string, concept: string) =>
      concept === 'fridge' ? samResult(concept) : samResult(concept, '')
    );
    const out = await refineDetections({ segmentImage }, 'data:x', [left, right, lamp]);

    expect(segmentImage.mock.calls.map((c) => c[1])).toEqual(['fridge', 'lamp']);
    expect(out.refined).toBe(2);
    expect(out.skipped).toEqual([]);
    const [l, r, lp] = out.detections;
    expect(l!.box).toEqual(samBoxToNorm({ x1: 16, y1: 586, x2: 748, y2: 1094 }, 1920, 1280));
    expect(r!.box).toEqual(samBoxToNorm({ x1: 1179, y1: 585, x2: 1900, y2: 1071 }, 1920, 1280));
    expect(l!.confidence).toBe(0.94);
    expect(lp).toEqual(lamp); // no SAM instance → Muse box kept
    expect(out.detections.every((d) => d.outline === undefined)).toBe(true);
  });

  it('a matched detection takes the SAM mask outline', async () => {
    const seg = samResult('fridge');
    seg.instances[1] = { ...seg.instances[1]!, outline: 'M0.01 0.46L0.39 0.46L0.39 0.85Z' };
    const out = await refineDetections({ segmentImage: async () => seg }, 'data:x', [left, right]);
    expect(out.detections[0]!.outline).toBe('M0.01 0.46L0.39 0.46L0.39 0.85Z');
    expect(out.detections[1]!.outline).toBeUndefined(); // its instance has no readable mask
  });

  it('keeps the Muse box when SAM times out', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const segmentImage = vi.fn(
        (_u: string, _c: string, signal?: AbortSignal) =>
          new Promise<SegmentResult>((resolve) => {
            signal?.addEventListener('abort', () => {
              aborted = true;
            });
            setTimeout(() => resolve(samResult('fridge')), 60_000);
          })
      );
      const pending = refineDetections({ segmentImage }, 'data:x', [left], { timeoutMs: 8000 });
      await vi.advanceTimersByTimeAsync(8000);
      const out = await pending;
      expect(aborted).toBe(true);
      expect(out.detections).toEqual([left]);
      expect(out.refined).toBe(0);
      expect(out.skipped).toEqual(['fridge']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores mock or fallback answers and rejected calls (their boxes belong to another image)', async () => {
    const answers: Record<string, () => Promise<SegmentResult>> = {
      fridge: async () => ({ ...samResult('fridge'), source: 'mock', fallback: 'provider_error' }),
      lamp: async () => {
        throw new Error('boom');
      },
    };
    const out = await refineDetections({ segmentImage: (_u, c) => answers[c]!() }, 'data:x', [
      left,
      lamp,
    ]);
    expect(out.detections).toEqual([left, lamp]);
    expect(out.skipped.sort()).toEqual(['fridge', 'lamp']);
  });

  it('bounds the number of SAM calls; unmatched low-overlap boxes stay', async () => {
    const many = Array.from({ length: MAX_DETECTIONS }, (_, i) =>
      det(`det-${i}`, `thing ${i}`, { x: 0.4, y: 0.1, w: 0.05, h: 0.05 })
    );
    const segmentImage = vi.fn(async (_u: string, c: string) => samResult(c));
    const out = await refineDetections({ segmentImage }, 'data:x', many, { maxConcepts: 3 });
    expect(segmentImage).toHaveBeenCalledTimes(3);
    expect(out.refined).toBe(0);
    expect(out.detections).toEqual(many);
  });
});
