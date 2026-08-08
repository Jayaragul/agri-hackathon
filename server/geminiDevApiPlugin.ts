import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  AdvisorServiceError,
  DEFAULT_GEMINI_MODEL,
  generateGeminiFarmAdvice,
  type GeminiAdvisorInput,
} from './geminiFarmAdvisor'

type Options = { apiKey?: string; model?: string }

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<GeminiAdvisorInput> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 64_000) throw new AdvisorServiceError(413, 'Request body is too large.')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as GeminiAdvisorInput
  } catch {
    throw new AdvisorServiceError(400, 'Request body must be valid JSON.')
  }
}

export function geminiDevApiPlugin(options: Options): Plugin {
  const model = options.model?.trim() || DEFAULT_GEMINI_MODEL
  return {
    name: 'thulir-gemini-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/farm-advisor', async (req, res) => {
        if (req.method === 'GET') {
          return sendJson(res, 200, { configured: Boolean(options.apiKey), provider: 'gemini', model })
        }
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' })

        try {
          const body = await readJson(req)
          const reply = await generateGeminiFarmAdvice(body, { apiKey: options.apiKey, model })
          return sendJson(res, 200, reply)
        } catch (error) {
          const status = error instanceof AdvisorServiceError ? error.status : 500
          const message = error instanceof Error ? error.message : 'Unexpected advisor error.'
          return sendJson(res, status, { error: message })
        }
      })
    },
  }
}
