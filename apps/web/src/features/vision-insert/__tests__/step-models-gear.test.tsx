import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { StepModelsGear } from '../ui/step-models-gear';

const payload = {
  defaults: {
    kit: 'muse-spark-1.3',
    parts: 'muse-spark-1.3',
    critic: 'muse-spark-1.3',
    stages: 'muse-spark-1.3',
    viewsCheck: 'muse-spark-1.3',
    askPart: 'muse-spark-1.3',
    refine: 'muse-wonder-1.0',
    code: 'muse-wonder-1.0',
    judge: 'muse-wonder-1.0',
  },
  models: ['muse-spark-1.3', 'muse-wonder-1.0'],
  selection: null,
};

describe('StepModelsGear (PQ-T67)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clicking the gear loads the choice: the rows replace the loading line', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => payload }));
    vi.stubGlobal('fetch', fetch);
    render(
      <I18nProvider>
        <StepModelsGear />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose the AI model of each 3D step' }));
    // The request goes out even though opening the modal queued a state update first.
    expect(fetch).toHaveBeenCalledWith('/api/vision/shape/step-models?scope=global');
    expect(await screen.findByLabelText('Write the 3D code')).toBeTruthy();
    expect(screen.queryByText('Building the 3D model…')).toBeNull();
  });
});
