'use client';

import { isAppliance } from '@/lib/vision';
import { useApplianceInsert, type ApplianceInsertOptions } from '../hooks/use-appliance-insert';
import { ApplianceInsertPanel } from './appliance-insert-panel';

export type ApplianceInsertProps = ApplianceInsertOptions;

/** Selected object → its load line in the store (PV-T12, PI-T1): insert, update or remove (immediate re-run). */
export function ApplianceInsert(props: ApplianceInsertProps) {
  const { draft, inSimulation, full, canConnect, insert, remove } = useApplianceInsert(props);
  return (
    <ApplianceInsertPanel
      draft={draft}
      scenery={!isAppliance(props.detection)}
      inSimulation={inSimulation}
      full={full}
      canConnect={canConnect}
      onInsert={() => void insert()}
      onRemove={remove}
    />
  );
}
