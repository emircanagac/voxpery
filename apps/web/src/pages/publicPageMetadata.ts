import { useEffect } from 'react'

const SITE_URL = 'https://voxpery.com'
const DEFAULT_TITLE = 'Voxpery | Free Open-Source Discord Alternative'
const DEFAULT_DESCRIPTION = 'Voxpery is a free, open-source Discord alternative with community chat, voice, desktop apps, hosted access, and full self-hosting.'
const DEFAULT_PROMO_DESCRIPTION = 'Start chatting on Voxpery for free or self-host the same open-source community chat and voice stack yourself.'
const DEFAULT_TAG_VALUES = [
  DEFAULT_DESCRIPTION,
  `${SITE_URL}/`,
  'Voxpery - Free Open-Source Discord Alternative',
  DEFAULT_PROMO_DESCRIPTION,
  `${SITE_URL}/`,
  'Voxpery - Free Open-Source Discord Alternative',
  DEFAULT_PROMO_DESCRIPTION,
]

export function usePublicPageMetadata(path: '/' | '/compare', title: string, description: string) {
  useEffect(() => {
    const tags: Array<[Element | null, string]> = [
      [document.querySelector('meta[name="description"]'), description],
      [document.querySelector('link[rel="canonical"]'), `${SITE_URL}${path}`],
      [document.querySelector('meta[property="og:title"]'), title],
      [document.querySelector('meta[property="og:description"]'), description],
      [document.querySelector('meta[property="og:url"]'), `${SITE_URL}${path}`],
      [document.querySelector('meta[name="twitter:title"]'), title],
      [document.querySelector('meta[name="twitter:description"]'), description],
    ]
    document.title = title
    tags.forEach(([tag, value]) => tag?.setAttribute(tag.tagName === 'LINK' ? 'href' : 'content', value))

    return () => {
      document.title = DEFAULT_TITLE
      tags.forEach(([tag], index) => {
        tag?.setAttribute(tag.tagName === 'LINK' ? 'href' : 'content', DEFAULT_TAG_VALUES[index])
      })
    }
  }, [path, title, description])
}
