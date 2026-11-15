import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import type { ViewSlide } from '../../../utils/xr-extract';
import { useSlideText } from '../holo-views-carousel';

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;
const slide = (id: ViewSlide['id'], status: ViewSlide['status'], validated = false): ViewSlide => ({
  id,
  status,
  validated,
});

describe('useSlideText (carousel + studio generation column)', () => {
  it('names the main view and each face, and says where each one is', () => {
    const { result } = renderHook(() => useSlideText(false), { wrapper });
    const { nameOf, statusOf } = result.current;
    expect(nameOf(slide('main', 'ready'))).not.toBe(nameOf(slide('side', 'ready')));
    const texts = [
      statusOf(slide('side', 'generating')),
      statusOf(slide('side', 'error')),
      statusOf(slide('side', 'idle')),
      statusOf(slide('side', 'ready', true)),
      statusOf(slide('side', 'ready')),
    ];
    expect(new Set(texts).size).toBe(5);
  });

  it('a vehicle names its main view differently', () => {
    const car = renderHook(() => useSlideText(true), { wrapper }).result.current;
    const box = renderHook(() => useSlideText(false), { wrapper }).result.current;
    expect(car.nameOf(slide('main', 'ready'))).not.toBe(box.nameOf(slide('main', 'ready')));
  });
});
