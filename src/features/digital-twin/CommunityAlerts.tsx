// "Someone near you has this" — surfaces `engine/communityPestAlerts.ts` output on the area-select
// screen. Explicitly labeled as a simulation: the 30 nearby farmer profiles it draws from
// (`services/community/communityClient.ts`) are fake demo data, never real people or real
// reports — see the module doc comment on `server/src/services/communityNetworkService.ts` for
// why, and [[krishi-mitra-ai-boundary]] for why this only ever shows distance/crop/pest, never a
// simulated farmer's identity.

import { AlertTriangle, ShieldCheck } from 'lucide-react'
import type { CommunityAlert } from '../../engine/communityPestAlerts'
import { describeCommunityAlert } from '../../engine/communityPestAlerts'

export interface CommunityAlertsProps {
  alerts: CommunityAlert[]
  loading: boolean
}

const SEVERITY_LABEL: Record<CommunityAlert['severity'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export function CommunityAlerts({ alerts, loading }: CommunityAlertsProps) {
  if (loading) return null

  return (
    <div className="dt-community-panel">
      <div className="dt-community-head">
        <span className="dt-community-title">
          {alerts.length > 0 ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
          Community Pest Watch
        </span>
        <span className="dt-community-badge">Simulated nearby farmer network — demo data, no real identities</span>
      </div>

      {alerts.length === 0 ? (
        <p className="dt-community-empty">✓ No active pest reports from simulated nearby farmers on any of your crops right now.</p>
      ) : (
        <ul className="dt-community-list">
          {alerts.map((alert) => (
            <li key={`${alert.areaId}-${alert.cropId}-${alert.pestName}`} className={`dt-community-item dt-severity-${alert.severity}`}>
              <span className="dt-community-item-badge">{SEVERITY_LABEL[alert.severity]}</span>
              <span className="dt-community-item-text">{describeCommunityAlert(alert)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default CommunityAlerts
