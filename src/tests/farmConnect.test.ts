import { describe, expect, it } from 'vitest'
import { FARM_CONNECT_URL, isMarketplaceIntent, marketplaceHandoff } from '../services/marketplace/farmConnect'

describe('FarmConnect handoff', () => {
  it('detects common selling questions', () => {
    expect(isMarketplaceIntent('Where can I sell my harvested tomatoes?')).toBe(true)
    expect(isMarketplaceIntent('விற்பனைக்கு எங்கே செல்லலாம்?')).toBe(true)
    expect(isMarketplaceIntent('Why is my soil pH low?')).toBe(false)
  })

  it('always appends the official FarmConnect URL for selling intent', () => {
    expect(marketplaceHandoff('Here is some advice.', 'I want to sell my crop')).toContain(FARM_CONNECT_URL)
    expect(marketplaceHandoff('Here is some advice.', 'How do I improve nitrogen?')).not.toContain(FARM_CONNECT_URL)
  })
})
