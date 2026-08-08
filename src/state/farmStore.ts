import { create } from 'zustand'
import { FarmProfile, AppStage, Crop, RecommendationResult } from '../domain/models/models'
import { demoProfile } from '../data/sample/demoProfile'

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
