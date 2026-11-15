import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { STEP_MODEL_STEPS, type StepModelStep } from '@/lib/step-models';
import { StepModelsModal } from '../ui/step-models-modal';

const data = {
  defaults: Object.fromEntries(
    STEP_MODEL_STEPS.map((s) => [
      s,
      s === 'code' || s === 'judge' ? 'muse-wonder-1.0' : 'muse-spark-1.3',
    ])
  ) as Record<StepModelStep, string>,
  models: ['muse-spark-1.3', 'muse-spark-1.2', 'muse-spark-1.1', 'muse-wonder-1.0'],
  selection: null,
};

const renderModal = (props = {}) =>
  render(
    <I18nProvider>
      <StepModelsModal
        data={data}
        loadError={false}
        saving={false}
        saveError={false}
        onClose={() => undefined}
        onSave={() => undefined}
        {...props}
      />
    </I18nProvider>
  );

describe('StepModelsModal (PQ-T67)', () => {
  it('lists one select per step, defaulting to the server setting', () => {
    renderModal();
    expect(screen.getAllByRole('combobox')).toHaveLength(STEP_MODEL_STEPS.length);
    const code = screen.getByLabelText('Write the 3D code') as HTMLSelectElement;
    expect(code.value).toBe('');
    expect(code.options[0]?.text).toBe('Default (muse-wonder-1.0)');
    const kit = screen.getByLabelText('Describe the object (kit)') as HTMLSelectElement;
    expect(kit.options[0]?.text).toBe('Default (muse-spark-1.3)');
  });

  it('saves only the steps set away from Default', () => {
    const onSave = vi.fn();
    renderModal({ onSave });
    fireEvent.change(screen.getByLabelText('Write the 3D code'), {
      target: { value: 'muse-spark-1.3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ code: 'muse-spark-1.3' });
  });

  it('reset returns every step to Default', () => {
    const onSave = vi.fn();
    renderModal({ data: { ...data, selection: { code: 'muse-spark-1.3' } }, onSave });
    expect((screen.getByLabelText('Write the 3D code') as HTMLSelectElement).value).toBe(
      'muse-spark-1.3'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({});
  });

  it('a failed load says so instead of the rows', () => {
    renderModal({ data: null, loadError: true });
    expect(screen.getByText('Could not load the model choice.')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
