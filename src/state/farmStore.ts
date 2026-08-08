import { create } from 'zustand'
import { FarmProfile, AppStage, Crop, RecommendationResult } from '../domain/models/models'
import { demoProfile } from '../data/sample/demoProfile'
import { getSessionStorage } from '../services/storage'

interface FarmState {
  profile: FarmProfile | null
  stage: AppStage
  selectedCrop: Crop | null
  recommendations: RecommendationResult[]
  
  // Actions
  setProfile: (profile: FarmProfile) => void
  loadDemoProfile: () => void
  setStage: (stage: AppStage) => void
  setSelectedCrop: (crop: Crop) => void
  setRecommendations: (results: RecommendationResult[]) => void
  reset: () => void
}

export const useFarmStore = create<FarmState>((set) => ({
  profile: null,
  stage: 'farm-profile',
  selectedCrop: null,
  recommendations: [],

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
