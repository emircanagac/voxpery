import { beforeEach, describe, expect, it } from 'vitest'
import type { GifOption, StickerOption } from './emoji'
import {
  getFavoriteGifs,
  getRecentEmojis,
  getRecentGifs,
  getRecentStickers,
  recordRecentEmoji,
  recordRecentGif,
  recordRecentSticker,
  toggleFavoriteGif,
} from './expressionPreferences'

const gif = (id: string): GifOption => ({
  id,
  label: `GIF ${id}`,
  url: `https://media.giphy.com/media/${id}/giphy.gif`,
  previewUrl: `https://media.giphy.com/media/${id}/200w.gif`,
  keywords: ['test'],
})

const sticker = (id: string): StickerOption => ({
  id,
  label: `Sticker ${id}`,
  imageUrl: `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${id}.png`,
  keywords: ['test'],
})

describe('expression preferences', () => {
  beforeEach(() => localStorage.clear())

  it('keeps recent expressions unique and newest first', () => {
    recordRecentEmoji('😀')
    recordRecentEmoji('🔥')
    recordRecentEmoji('😀')
    recordRecentGif(gif('one'))
    recordRecentGif(gif('two'))
    recordRecentGif(gif('one'))
    recordRecentSticker(sticker('1f389'))

    expect(getRecentEmojis()).toEqual(['😀', '🔥'])
    expect(getRecentGifs().map((entry) => entry.id)).toEqual(['one', 'two'])
    expect(getRecentStickers().map((entry) => entry.id)).toEqual(['1f389'])
  })

  it('toggles GIF favorites without duplicates', () => {
    toggleFavoriteGif(gif('one'))
    toggleFavoriteGif(gif('two'))
    toggleFavoriteGif(gif('one'))

    expect(getFavoriteGifs().map((entry) => entry.id)).toEqual(['two'])
  })

  it('drops malformed or non-https media loaded from storage', () => {
    localStorage.setItem('voxpery-expression-favorite-gif-v1', JSON.stringify([
      { id: 'unsafe', label: 'Unsafe', url: 'javascript:alert(1)', keywords: [] },
      gif('safe'),
    ]))

    expect(getFavoriteGifs().map((entry) => entry.id)).toEqual(['safe'])
  })
})
