import React, { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useFarmStore } from '../../state/farmStore'
import { analyzeSoilGaps } from '../../engine/soilGapAnalysis'
import { generateFinancialScenarios } from '../../engine/financialEngine'
import { buildCropCalendar } from '../../engine/cropCalendarEngine'
import { buildFarmReportData } from '../../engine/reportEngine'
import { sampleCorrections } from '../../data/sample/corrections'
import { samplePests } from '../../data/sample/pests'
import { getMarketDemand } from '../../services/marketplace/marketplaceClient'
import { exportSectionsToPdf } from '../../services/report/pdfExport'
import ReportDocument from './ReportDocument'

/**
 * Drives the Full Farm Report PDF: gathers everything the app already knows about this farm's
 * chosen crop (soil gaps, financial scenarios, pest risks, cultivation calendar, live marketplace
 * demand), mounts `ReportDocument` off-screen (real DOM layout, just outside the viewport — see
 * `services/report/pdfExport.ts`'s `html2canvas` requirement), captures it to a paginated PDF,
 * then tears the off-screen mount down. Returns UI-friendly `generating`/`error` state so any
 * screen can wire up a single "Download Full Report" button.
 */
export function useFarmReportGenerator() {
  const { profile, selectedCrop, recommendations, farmerName } = useFarmStore()
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recommendation = selectedCrop ? recommendations.find((r) => r.crop.id === selectedCrop.id) ?? null : null
  const canGenerate = Boolean(profile && selectedCrop && recommendation)

  const generate = useCallback(async () => {
    if (!profile || !selectedCrop || !recommendation) return

    setGenerating(true)
    setError(null)

    let container: HTMLDivElement | null = null
    let root: ReturnType<typeof createRoot> | null = null

    try {
      const gapAnalysis = analyzeSoilGaps(profile, selectedCrop, sampleCorrections, recommendation)
      const financials = generateFinancialScenarios(profile, selectedCrop, gapAnalysis)
      const pestRisks = samplePests.filter((p) => p.cropId === selectedCrop.id)
      const calendarPlan = buildCropCalendar({ profile, crop: selectedCrop, recommendation, gapAnalysis, pestRisks })
      const marketDemand = await getMarketDemand(selectedCrop.name)

      const data = buildFarmReportData({
        farmerName,
        profile,
        crop: selectedCrop,
        recommendation,
        allRecommendations: recommendations,
        gapAnalysis,
        financials,
        pestRisks,
        calendarPlan,
        marketDemand,
      })

      container = document.createElement('div')
      container.style.position = 'fixed'
      container.style.top = '0'
      container.style.left = '-10000px'
      container.style.zIndex = '-1'
      container.style.pointerEvents = 'none'
      document.body.appendChild(container)

      root = createRoot(container)
      // `flushSync` forces React to commit this render synchronously before returning, so the
      // off-screen DOM is fully built the moment this call returns. Deliberately not a
      // requestAnimationFrame wait: rAF is tied to the compositor, which never fires for a tab
      // that isn't actually being painted to screen (a backgrounded/inactive tab) — this must
      // work regardless of whether the tab generating the report is in the foreground.
      flushSync(() => {
        root!.render(React.createElement(ReportDocument, { data }))
      })

      const datedSuffix = new Date().toISOString().slice(0, 10)
      const filename = `Thulir-Farm-Report-${selectedCrop.name.replace(/\s+/g, '-')}-${datedSuffix}.pdf`
      await exportSectionsToPdf(container, filename)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the report. Please try again.')
    } finally {
      root?.unmount()
      container?.remove()
      setGenerating(false)
    }
  }, [profile, selectedCrop, recommendation, recommendations, farmerName])

  return { generate, generating, error, canGenerate }
}
