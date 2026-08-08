export function analyzeNutrient(
  available: number,
  required: number,
  maxPoints: number
): { score: number; deficit: number; ratio: number; severity: 'mild' | 'moderate' | 'severe' | 'none' } {
  if (required <= 0) {
    return { score: maxPoints, deficit: 0, ratio: 1, severity: 'none' }
  }

  const ratio = available / required
  const deficit = Math.max(0, required - available)
  
  let score = 0
  if (ratio >= 1) {
    score = maxPoints
  } else if (ratio >= 0.8) {
    score = maxPoints * 0.9
  } else if (ratio >= 0.5) {
    score = maxPoints * (ratio) // gradual penalty
  } else {
    // Heavy penalty for severe deficit
    score = maxPoints * (ratio * 0.5)
  }

  let severity: 'mild' | 'moderate' | 'severe' | 'none' = 'none'
  if (ratio < 0.5) severity = 'severe'
  else if (ratio < 0.8) severity = 'moderate'
  else if (ratio < 1) severity = 'mild'

  return { score, deficit, ratio, severity }
}

export function evaluatePh(
  actualPh: number,
  idealMin: number,
  idealMax: number,
  maxPoints: number
): { score: number; deviation: number } {
  if (actualPh >= idealMin && actualPh <= idealMax) {
    return { score: maxPoints, deviation: 0 }
  }

  const deviation = actualPh < idealMin 
    ? idealMin - actualPh 
    : actualPh - idealMax

  if (deviation >= 1.5) {
    return { score: 0, deviation }
  }

  // Gradual reduction
  // Max deviation allowed for partial points is 1.5
  const penaltyFactor = deviation / 1.5
  const score = Math.max(0, maxPoints * (1 - penaltyFactor))

  return { score, deviation }
}
