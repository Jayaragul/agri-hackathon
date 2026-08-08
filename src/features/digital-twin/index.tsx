// Digital Twin — post-sowing field monitoring, complementing Krishi Mitra's
// existing pre-sowing crop decision support.
//
// This is the single entry point the app shell should import. It owns its
// own area/field routing internally via `useDigitalTwinStore` (no
// `location.hash` dependency), so wiring it into navigation is just
// rendering `<DigitalTwinFeature />` behind a nav item — see
// `digitalTwinNavInfo` below for the label/icon to build that nav item with.
//
// Everything this screen shows — growth stage, Excellence score, sensor
// readings — is computed by the deterministic engine in
// `src/engine/digitalTwin/*`. This feature and its pixel-art renderer only
// visualize that decision; no AI/LLM call is ever made here.

import { useDigitalTwinStore } from '../../state/digitalTwinStore'
import { AreaSelect } from './AreaSelect'
import { Dashboard } from './Dashboard'
import './digitalTwin.css'

/** Nav descriptor for whoever wires this feature into the app shell's
 *  navigation. `icon` names a lucide-react icon already used elsewhere in
 *  this project's convention (see other features' imports from
 *  'lucide-react'). */
export const digitalTwinNavInfo = {
  id: 'digital-twin',
  label: 'Digital Twin',
  icon: 'Sprout',
} as const

export function DigitalTwinFeature() {
  const selectedAreaId = useDigitalTwinStore((s) => s.selectedAreaId)
  const selectArea = useDigitalTwinStore((s) => s.selectArea)
  const clearSelection = useDigitalTwinStore((s) => s.clearSelection)

  if (!selectedAreaId) {
    return <AreaSelect onPick={selectArea} />
  }

  return <Dashboard onBack={clearSelection} />
}

export default DigitalTwinFeature
