import { describe, expect, it } from 'vitest'
import { getAllEmojiOptions } from './emoji'

describe('emoji catalog layout contract', () => {
  it('keeps the complete catalog aligned to the ten-column desktop grid', () => {
    const emoji = getAllEmojiOptions()
    expect(emoji.length).toBeGreaterThan(0)
    expect(emoji.length % 10).toBe(0)
    expect(new Set(emoji.map((entry) => entry.emoji)).size).toBe(emoji.length)
  })
})
