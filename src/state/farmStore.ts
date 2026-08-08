import { create } from 'zustand'
import { FarmProfile, AppStage, Crop, RecommendationResult, FarmTimelineEvent } from '../domain/models/models'
import { demoProfile } from '../data/sample/demoProfile'
import { getSessionStorage } from '../services/storage'
import {
  getFarmerName,
  setFarmerName as persistFarmerName,
  isOnboardingComplete,
  markOnboardingComplete,
  getDeclaredSituation,
  setDeclaredSituation as persistDeclaredSituation,
} from '../services/identity/farmerIdentity'
import { getLabReport, setLabReport as persistLabReport } from '../services/identity/labReport'
import type { SoilReportExtraction } from '../services/ai/contracts/aiSchemas'
import {
  getTimelineEvents,
  logTimelineEvent as persistTimelineEvent,
  type LogTimelineEventInput,
} from '../services/timeline/farmTimeline'

interface FarmState {
  farmerName: string | null
  onboardingComplete: boolean
  /** Whatever the farmer has volunteered in conversation ("growing groundnut near Coimbatore") — see `services/identity/farmerIdentity.ts`. Farmer-reported, never engine-verified. */
  declaredSituation: string | null
  /** Soil numbers read off a photographed lab report/Soil Health Card, independent of the wizard `profile` — see `services/identity/labReport.ts`. */
  labReport: SoilReportExtraction | null
  /** Reactive farm events (what happened), most recent first — see `services/timeline/farmTimeline.ts`. Proactive (predicted) events are computed on demand by `engine/proactiveEngine.ts`, never stored here. */
  timelineEvents: FarmTimelineEvent[]
  profile: FarmProfile | null
  stage: AppStage
  selectedCrop: Crop | null
  recommendations: RecommendationResult[]

  // Actions
  setFarmerName: (name: string) => void
  completeOnboarding: () => void
  setDeclaredSituation: (text: string) => void
  setLabReport: (extraction: SoilReportExtraction) => void
  logTimelineEvent: (event: LogTimelineEventInput) => FarmTimelineEvent
  setProfile: (profile: FarmProfile) => void
  loadDemoProfile: () => void
  setStage: (stage: AppStage) => void
  setSelectedCrop: (crop: Crop) => void
  setRecommendations: (results: RecommendationResult[]) => void
  reset: () => void
}

export const useFarmStore = create<FarmState>((set) => ({
  farmerName: getFarmerName(),
  onboardingComplete: isOnboardingComplete(),
  declaredSituation: getDeclaredSituation(),
  labReport: getLabReport(),
  timelineEvents: getTimelineEvents(),
  profile: null,
  // Audio Mode is the app's front door — a farmer opening Krishi Mitra lands in the voice
  // assistant, not the profile wizard. The wizard, Digital Twin, Crop Doctor, etc. are all still
  // one header tap away; this only changes what greets you on open.
  stage: 'audio-mode',
  selectedCrop: null,
  recommendations: [],

  setFarmerName: (name) => {
    persistFarmerName(name)
    set({ farmerName: getFarmerName() })
  },

  completeOnboarding: () => {
    markOnboardingComplete()
    set({ onboardingComplete: true })
  },

  setDeclaredSituation: (text) => {
    persistDeclaredSituation(text)
    set({ declaredSituation: getDeclaredSituation() })
  },

  setLabReport: (extraction) => {
    persistLabReport(extraction)
    set({ labReport: getLabReport() })
  },

  logTimelineEvent: (event) => {
    const stored = persistTimelineEvent(event)
    set({ timelineEvents: getTimelineEvents() })
    return stored
  },

  setProfile: (profile) => set({ profile, stage: 'recommendations' }),

  loadDemoProfile: () => set({ profile: demoProfile, stage: 'recommendations' }),

  setStage: (stage) => set({ stage }),

  setSelectedCrop: (selectedCrop) => set({ selectedCrop, stage: 'soil-corrections' }),

  setRecommendations: (recommendations) => set({ recommendations }),

  reset: () => set({
    profile: null,
    stage: 'farm-profile',
    selectedCrop: null,
    recommendations: []
  })
}))

// Best-effort auto-save: whenever the profile or selected crop changes, persist a snapshot
// (backend if deployed, localStorage otherwise — see services/storage) so a farmer who closes
// the tab can resume. Never blocks or throws into the UI; a save failure is invisible by design.
let lastSavedProfile: FarmProfile | null = null
let lastSavedCropId: string | null = null
useFarmStore.subscribe((state) => {
  if (!state.profile) return
  const cropId = state.selectedCrop?.id ?? null
  if (state.profile === lastSavedProfile && cropId === lastSavedCropId) return
  lastSavedProfile = state.profile
  lastSavedCropId = cropId
  getSessionStorage().saveSnapshot(state.profile, cropId).catch(() => {
    // Persistence is best-effort — see LocalStorageBackend/BackendSessionStorage for why this can never throw here anyway.
  })
})
