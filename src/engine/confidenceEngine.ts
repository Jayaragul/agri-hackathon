import { FarmProfile, Crop } from '../domain/models/models'

export function evaluateConfidence(
  profile: FarmProfile,
  crop: Crop
): { confidence: 'high' | 'medium' | 'low'; reason: string } {
  // Check completeness of farmer input
  let missingInputs = 0
  if (!profile.soilType) missingInputs++
  if (!profile.region) missingInputs++
  if (profile.nitrogenKgPerAcre === 0 && profile.phosphorusKgPerAcre === 0) missingInputs++

  if (missingInputs >= 2) {
    return {
      confidence: 'low',
      reason: 'Incomplete soil and regional profile data.'
    }
  }

  // Check regional crop information
  const regionSupported = crop.supportedRegions.some(r => 
    r.toLowerCase() === profile.region.toLowerCase()
  )
  if (!regionSupported) {
    return {
      confidence: 'low',
      reason: 'Regional compatibility data is unavailable or unsupported.'
    }
  }

  // Check soil compatibility information
  const soilSupported = crop.compatibleSoilTypes.some(s =>
    s.toLowerCase() === profile.soilType.toLowerCase()
  )
  if (!soilSupported) {
    return {
      confidence: 'medium',
      reason: 'Crop has not been explicitly tested for this specific soil type.'
    }
  }

  if (missingInputs === 1) {
    return {
      confidence: 'medium',
      reason: 'Partial soil profile data reduces prediction certainty.'
    }
  }

  return {
    confidence: 'high',
    reason: 'Comprehensive data match with strong regional history.'
  }
}
