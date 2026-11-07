import { createElement, lazy, useState, type ComponentType } from 'react'

type PageModule = { default: ComponentType }

// Lazy pages that render synchronously once preloaded, so the first render does not suspend
// and swap the readable HTML of landing.html and compare.html for the loading card.
function preloadablePage(load: () => Promise<PageModule>) {
  let loaded: ComponentType | null = null
  const preload = () => load().then((module) => {
    loaded = module.default
    return module
  })
  const LazyPage = lazy(preload)
  // Pick once per mount, so a page that finishes loading later never swaps component types.
  const Page = () => {
    const [Component] = useState<ComponentType>(() => loaded ?? LazyPage)
    return createElement(Component)
  }
  return { Page, preload }
}

const about = preloadablePage(() => import('./AboutPage'))
const compare = preloadablePage(() => import('./ComparePage'))

export const AboutPage = about.Page
export const ComparePage = compare.Page

/** Loads the page code for a static public entry (/, /about, /compare) before React starts. */
export function preloadPublicPage(pathname: string): Promise<unknown> {
  if (pathname === '/' || pathname === '/about') return about.preload()
  if (pathname === '/compare') return compare.preload()
  return Promise.resolve()
}
