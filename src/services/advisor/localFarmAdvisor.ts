import wikiKnowledge from '../../data/wiki-kb.json'
import { Crop, FarmProfile, RecommendationResult } from '../../domain/models/models'
import { spreadsheetGrounding } from '../../data/spreadsheetData'

type KnowledgeEntry = {
  id: string
  keywords: string[]
  question: string
  answer: string
}

export type AdvisorReply = {
  answer: string
  topics: string[]
  confidence: 'high' | 'medium' | 'low'
  provider: 'gemini' | 'local'
  model?: string
  notice?: string
}

export async function askLiveFarmAdvisor(question: string, profile?: FarmProfile | null, crop?: Crop | null, top?: RecommendationResult): Promise<AdvisorReply> {
  const response = await fetch('/api/farm-advisor', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context: { profile, selectedCrop: crop, topRecommendation: top, spreadsheetGrounding } }),
  })
  const body: unknown = await response.json()
  if (!response.ok) throw new Error('Live Gemini is unavailable')
  if (
    typeof body !== 'object' || body === null ||
    !('answer' in body) || typeof body.answer !== 'string' ||
    !('topics' in body) || !Array.isArray(body.topics) ||
    !('provider' in body) || body.provider !== 'gemini'
  ) {
    throw new Error('Gemini returned an invalid response')
  }
  return {
    answer: body.answer,
    topics: body.topics.filter((topic): topic is string => typeof topic === 'string'),
    confidence: 'medium',
    provider: 'gemini',
    model: 'model' in body && typeof body.model === 'string' ? body.model : undefined,
  }
}

const knowledge = wikiKnowledge as KnowledgeEntry[]

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')

function findKnowledge(question: string): KnowledgeEntry[] {
  const words = normalize(question).split(/\s+/).filter(word => word.length > 2)
  return knowledge
    .map(entry => {
      const haystack = normalize(`${entry.question} ${entry.keywords.join(' ')}`)
      const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0)
      return { entry, score }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(item => item.entry)
}

function contextSummary(profile?: FarmProfile | null, crop?: Crop | null, top?: RecommendationResult): string {
  if (!profile) return 'No farm profile has been entered yet. Ask the farmer to complete the soil profile first.'

  const lines = [
    `Farm context: ${profile.region}, ${profile.acres} acre(s), ${profile.soilType} soil, pH ${profile.ph}.`,
    `Available nutrients: N ${profile.nitrogenKgPerAcre}, P ${profile.phosphorusKgPerAcre}, K ${profile.potassiumKgPerAcre} kg/acre.`,
  ]
  if (crop) lines.push(`Selected crop: ${crop.name}, ideal pH ${crop.idealPhMin}-${crop.idealPhMax}.`)
  if (top) lines.push(`Best current match: ${top.crop.name} (${top.score}/100, ${top.confidence} confidence).`)
  return lines.join(' ')
}

export function answerFarmQuestion(
  question: string,
  profile?: FarmProfile | null,
  crop?: Crop | null,
  topRecommendation?: RecommendationResult,
): AdvisorReply {
  const matches = findKnowledge(question)
  const context = contextSummary(profile, crop, topRecommendation)

  if (matches.length === 0) {
    return {
      confidence: 'low',
      provider: 'local',
      topics: ['Farm context'],
      answer: `I could not find a reliable answer in my verified local knowledge base. ${context} Please ask about soil pH, NPK, crop rotation, irrigation, pests, soil testing, or fertilizer options. For pesticide dosage or a severe crop problem, confirm with a KVK/agronomist.`,
    }
  }

  const personalized = profile && crop
    ? `\n\nFor this farm, compare the advice with ${crop.name}'s pH range (${crop.idealPhMin}-${crop.idealPhMax}) and your current soil readings before acting.`
    : profile
      ? `\n\nFor this farm: ${profile.soilType} soil at pH ${profile.ph} in ${profile.region}.`
      : ''

  return {
    confidence: matches.length > 1 ? 'high' : 'medium',
    provider: 'local',
    topics: matches.map(match => match.question),
    answer: `${matches.map(match => match.answer).join('\n\n')}\n\n${context}${personalized}\n\nThis is an offline, source-grounded decision aid—not a substitute for a local agricultural expert.`,
  }
}
