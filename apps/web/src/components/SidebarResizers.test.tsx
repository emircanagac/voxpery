import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import SidebarResizers from './SidebarResizers'

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1366 })
})

it('resizes using the keyboard and persists bounded widths', () => {
  const { unmount } = render(<SidebarResizers />)
  const left = screen.getByRole('separator', { name: 'Channel panel width' })
  fireEvent.keyDown(left, { key: 'ArrowRight' })
  expect(left).toHaveAttribute('aria-valuenow', '256')
  expect(JSON.parse(localStorage.getItem('voxpery-panel-widths')!)).toEqual({ left: 256, right: 240 })
  for (let i = 0; i < 30; i++) fireEvent.keyDown(left, { key: 'ArrowRight' })
  expect(left).toHaveAttribute('aria-valuenow', '360')
  fireEvent.keyDown(left, { key: 'Home' })
  expect(left).toHaveAttribute('aria-valuenow', '240')
  unmount()
  expect(document.documentElement.style.getPropertyValue('--desktop-channel-width')).toBe('')
})

it('clamps stored widths to preserve the center area without losing the preference', () => {
  localStorage.setItem('voxpery-panel-widths', JSON.stringify({ left: 360, right: 360 }))
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1021 })
  render(<SidebarResizers />)
  const total = screen.getAllByRole('separator').reduce((sum, el) => sum + Number(el.getAttribute('aria-valuenow')), 0)
  expect(1021 - 72 - total).toBeGreaterThanOrEqual(359)
  expect(JSON.parse(localStorage.getItem('voxpery-panel-widths')!).left).toBe(360)
})
