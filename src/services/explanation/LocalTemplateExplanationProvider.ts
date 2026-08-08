import { ExplanationProvider, RecommendationResult, FarmProfile } from '../../domain/models/models'

export class LocalTemplateExplanationProvider implements ExplanationProvider {
  public async explainRecommendation(result: RecommendationResult, profile: FarmProfile): Promise<string> {
    const lines: string[] = []

    lines.push(`**Why ${result.crop.name}?**`)
    if (result.positiveReasons.length > 0) {
      result.positiveReasons.forEach(r => lines.push(`✅ ${r}`))
    } else {
      lines.push(`It is a viable option for this season.`)
    }

    if (result.riskReasons.length > 0) {
      lines.push(`\n**What are the risks?**`)
      result.riskReasons.forEach(r => lines.push(`⚠️ ${r}`))
    }

    if (result.blockingWarnings.length > 0) {
      lines.push(`\n**Critical Blockers:**`)
      result.blockingWarnings.forEach(r => lines.push(`❌ ${r}`))
    }

    if (result.deficits.nitrogenKgPerAcre > 0 || result.deficits.phosphorusKgPerAcre > 0 || result.deficits.potassiumKgPerAcre > 0) {
      lines.push(`\n**Nutrient Gaps to Fix:**`)
      if (result.deficits.nitrogenKgPerAcre > 0) lines.push(`- Nitrogen deficit: ${result.deficits.nitrogenKgPerAcre.toFixed(1)} kg/acre`)
      if (result.deficits.phosphorusKgPerAcre > 0) lines.push(`- Phosphorus deficit: ${result.deficits.phosphorusKgPerAcre.toFixed(1)} kg/acre`)
      if (result.deficits.potassiumKgPerAcre > 0) lines.push(`- Potassium deficit: ${result.deficits.potassiumKgPerAcre.toFixed(1)} kg/acre`)
    }

    return lines.join('\n')
  }
}
