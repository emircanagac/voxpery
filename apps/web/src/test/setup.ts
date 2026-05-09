import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock @tauri-apps imports for browser tests
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}))

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock MediaStreamTrack
class MockMediaStreamTrack {
  kind = 'audio'
  id = Math.random().toString(36)
  label = 'mock-track'
  enabled = true
  muted = false
  readyState: 'live' | 'ended' = 'live'

  stop() {
    this.readyState = 'ended'
  }

  clone() {
    return new MockMediaStreamTrack()
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true }
}

// Mock MediaStream
class MockMediaStream {
  id = Math.random().toString(36)
  active = true
  private tracks: MediaStreamTrack[] = []

  constructor(tracks?: MediaStreamTrack[]) {
    if (tracks) {
      this.tracks = tracks
    }
  }

  getTracks() {
    return this.tracks
  }

  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio')
  }

  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video')
  }

  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track)
  }

  removeTrack(track: MediaStreamTrack) {
    this.tracks = this.tracks.filter((t) => t !== track)
  }

  clone() {
    return new MockMediaStream(this.tracks.map((t) => t.clone()))
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true }
}

// Assign to globalThis
Object.defineProperty(globalThis, 'MediaStreamTrack', { value: MockMediaStreamTrack })
Object.defineProperty(globalThis, 'MediaStream', { value: MockMediaStream })
