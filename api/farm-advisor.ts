import {
  AdvisorServiceError,
  DEFAULT_GEMINI_MODEL,
  generateGeminiFarmAdvice,
  type GeminiAdvisorInput,
} from '../server/geminiFarmAdvisor'

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    return res.status(200).json({
      configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      provider: 'gemini',
      model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' })

  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as GeminiAdvisorInput
    const reply = await generateGeminiFarmAdvice(body, {
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      model: process.env.GEMINI_MODEL,
    })
    return res.status(200).json(reply)
  } catch (error) {
    const status = error instanceof AdvisorServiceError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Unexpected advisor error.'
    return res.status(status).json({ error: message })
  }
}
