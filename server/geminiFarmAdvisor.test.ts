import { describe, expect, it, vi } from 'vitest'
import { AdvisorServiceError, generateGeminiFarmAdvice } from './geminiFarmAdvisor'

describe('Gemini farm advisor service', () => {
  it('sends server-side authenticated, grounded requests and returns a normalized reply', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Check soil moisture first.\nThen review the nitrogen correction.' }] } }],
      }),
    })) as unknown as typeof fetch

    const reply = await generateGeminiFarmAdvice(
      { question: 'What should I do next?', context: { profile: { ph: 7.2 }, deterministicScore: 84 } },
      { apiKey: 'server-secret', model: 'gemini-3.6-flash' },
      fetchMock,
    )

    expect(reply.provider).toBe('gemini')
    expect(reply.model).toBe('gemini-3.6-flash')
    expect(reply.answer).toContain('Check soil moisture first.')
    expect(fetchMock).toHaveBeenCalledOnce()

    const [url, init] = vi.mocked(fetchMock).mock.calls[0]
    expect(String(url)).toContain('/models/gemini-3.6-flash:generateContent')
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('server-secret')

    const requestBody = JSON.parse(String(init?.body))
    expect(requestBody.system_instruction.parts[0].text).toContain('never change or override deterministic crop scores')
    expect(requestBody.contents[0].parts[0].text).toContain('"deterministicScore":84')
  })

  it('refuses to call Gemini without a server-side API key', async () => {
    await expect(generateGeminiFarmAdvice({ question: 'Hello' }, {})).rejects.toMatchObject({ status: 503 })
  })

  it('rejects empty provider responses', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [] }) })) as unknown as typeof fetch

    await expect(generateGeminiFarmAdvice(
      { question: 'What should I do?' },
      { apiKey: 'server-secret' },
      fetchMock,
    )).rejects.toMatchObject({ status: 502 })
  })

  it('uses typed service errors', () => {
    expect(new AdvisorServiceError(400, 'bad request')).toMatchObject({ status: 400, message: 'bad request' })
  })
})
