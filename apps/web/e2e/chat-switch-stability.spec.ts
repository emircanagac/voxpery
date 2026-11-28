import { expect, test, type Page } from '@playwright/test'
import { deflateSync } from 'node:zlib'
import { buildCoreChannels, buildCoreMembers, buildCoreServer, buildServerMessage, createMockCoreState, installMockCoreApi, type MockCoreState } from './mock-core-api'

test.use({ viewport: { width: 1280, height: 800 } })

type Frame = { id: string | null; gap: number; top: number; overlap: number }

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  let crc = 0xffffffff
  for (const byte of body) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, body, checksum])
}

/** A photo-sized PNG of noise: large enough that the browser decodes it after the first frame. */
function noisePng(width: number, height: number) {
  const stride = width * 3 + 1
  const pixels = Buffer.alloc(stride * height)
  let seed = 7
  for (let y = 0; y < height; y += 1) {
    for (let x = 1; x < stride; x += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      pixels[y * stride + x] = (seed >> 16) & 0xff
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const PHOTO = noisePng(1080, 1080)

/** A day of text, then a new day of photos, as in a real channel. */
function channelRows(channelId: string, label: string) {
  const rows = Array.from({ length: 25 }, (_, index) => buildServerMessage(channelId, `${label} line ${index}`, {
    id: `${channelId}-${index}`,
    created_at: new Date(Date.UTC(2026, 8, 24, 10, index)).toISOString(),
  }))
  for (let photo = 0; photo < 3; photo += 1) {
    rows.push(buildServerMessage(channelId, '', {
      id: `${channelId}-photo-${photo}`,
      created_at: new Date(Date.UTC(2026, 8, 25, 11, 20 + photo * 7)).toISOString(),
      attachments: [{
        id: `${channelId}-image-${photo}`,
        sha256: `${channelId}-sha-${photo}`,
        url: `/api/attachments/content/${channelId}-image-${photo}?exp=1&sig=0`,
        name: `photo-${photo}.png`,
        type: 'image/png',
      }],
    }))
  }
  return rows
}

/** Like the real server: message lists arrive after a moment with freshly signed image URLs. */
async function serveLikeProduction(page: Page, state: MockCoreState) {
  let signature = 0
  await page.route(/\/api\/messages\/[^/?]+\?/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200))
    signature += 1
    for (const messages of Object.values(state.messagesByChannelId)) {
      for (const message of messages) {
        for (const attachment of message.attachments ?? []) {
          attachment.url = attachment.url.replace(/sig=\d+/, `sig=${signature}`)
        }
      }
    }
    await route.fallback()
  })
  await page.route('**/api/attachments/content/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150))
    await route.fulfill({ contentType: 'image/png', body: PHOTO })
  })
}

const FRAMES_AFTER_SHOWN = 40
const MAX_FRAMES = 400

/**
 * Samples every frame after `open` until the conversation's last message has been on screen for
 * FRAMES_AFTER_SHOWN frames. Each frame's sample runs in a resize observer created in that frame,
 * the newest one, so it runs after the page's own observers (the list may create its observer
 * again when a conversation opens) and sees the frame as it is painted.
 */
async function recordFrames(page: Page, lastId: string, open: () => Promise<void>): Promise<Frame[]> {
  await page.evaluate(({ lastId, framesAfterShown, maxFrames }) => {
    const frames: Frame[] = []
    const state = { frames, done: false }
    ;(window as unknown as { __chatFrames: typeof state }).__chatFrames = state
    let shownAt = -1
    const sample = () => {
      const scroller = Array.from(document.querySelectorAll<HTMLElement>('.chat-messages'))
        .find((element) => element.offsetParent !== null)
      const rows = scroller
        ? Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]'))
          .map((row) => ({ id: row.dataset.messageId ?? '', rect: row.getBoundingClientRect() }))
          .sort((a, b) => a.rect.top - b.rect.top)
        : []
      const last = rows[rows.length - 1]
      let overlap = 0
      for (let index = 1; index < rows.length; index += 1) {
        overlap = Math.max(overlap, rows[index - 1].rect.bottom - rows[index].rect.top)
      }
      const bounds = scroller?.getBoundingClientRect()
      frames.push({
        id: last && bounds ? last.id : null,
        gap: last && bounds ? Math.round(bounds.bottom - last.rect.bottom) : 0,
        // On the screen, not in the list: a bar above the list may still appear without moving it.
        top: last ? Math.round(last.rect.top) : 0,
        overlap: Math.round(overlap),
      })
      if (shownAt < 0 && last?.id === lastId) shownAt = frames.length - 1
      state.done = frames.length >= maxFrames || (shownAt >= 0 && frames.length - shownAt >= framesAfterShown)
    }
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
    document.body.appendChild(probe)
    let observer: ResizeObserver | null = null
    const nextFrame = () => {
      observer?.disconnect()
      if (state.done) {
        probe.remove()
        return
      }
      // A new observation is reported once, in this frame's resize observer step.
      observer = new ResizeObserver(() => {
        if (!state.done) sample()
      })
      observer.observe(probe)
      requestAnimationFrame(nextFrame)
    }
    requestAnimationFrame(nextFrame)
  }, { lastId, framesAfterShown: FRAMES_AFTER_SHOWN, maxFrames: MAX_FRAMES })
  await open()
  type Recording = { frames: Frame[]; done: boolean }
  await expect.poll(() => page.evaluate(() => (window as unknown as { __chatFrames: Recording }).__chatFrames.done)).toBe(true)
  return page.evaluate(() => (window as unknown as { __chatFrames: Recording }).__chatFrames.frames)
}

/** From the first frame that shows the conversation, its last message stays where it ends up. */
function expectSettledFromFirstFrame(frames: Frame[], lastId: string, { stableTop }: { stableTop: boolean }) {
  const shown = frames.slice(frames.findIndex((frame) => frame.id === lastId))
  const report = JSON.stringify(shown)
  expect(shown.length, JSON.stringify(frames)).toBeGreaterThanOrEqual(FRAMES_AFTER_SHOWN)
  const final = shown[shown.length - 1]
  for (const frame of shown) {
    expect(frame.id, report).toBe(lastId)
    expect(Math.abs(frame.gap - final.gap), report).toBeLessThanOrEqual(2)
    expect(frame.overlap, report).toBeLessThanOrEqual(1)
    if (stableTop) expect(Math.abs(frame.top - final.top), report).toBeLessThanOrEqual(2)
  }
  expect(final.gap).toBeGreaterThanOrEqual(0)
  expect(final.gap).toBeLessThanOrEqual(8)
}

async function expectSwitchHolds(page: Page, open: () => Promise<void>, lastId: string, options: { stableTop: boolean }) {
  expectSettledFromFirstFrame(await recordFrames(page, lastId, open), lastId, options)
}

test('keeps the last message in place when switching channels and servers @core', async ({ page }) => {
  const first = buildCoreServer()
  const second = buildCoreServer({ id: 'server-b', name: 'Second Guild' })
  const firstChannels = buildCoreChannels(first.id)
  const secondChannels = buildCoreChannels(second.id)
  const [general, announcements] = firstChannels
  const state = createMockCoreState({
    servers: [first, second],
    channelsByServerId: { [first.id]: firstChannels, [second.id]: secondChannels },
    membersByServerId: { [first.id]: buildCoreMembers(), [second.id]: buildCoreMembers() },
    messagesByChannelId: {
      [general.id]: channelRows(general.id, 'General'),
      [announcements.id]: channelRows(announcements.id, 'Announce'),
      [secondChannels[0].id]: channelRows(secondChannels[0].id, 'Second'),
    },
  })
  await installMockCoreApi(page, state)
  await serveLikeProduction(page, state)
  await page.goto('/servers')
  await expect(page.getByRole('button', { name: 'Preview photo-2.png' })).toBeVisible()

  const lastOf = (channelId: string) => `${channelId}-photo-2`
  const openGeneral = () => page.getByRole('button', { name: 'Text channel general', exact: true }).click()
  const openAnnouncements = () => page.getByRole('button', { name: 'Text channel announcements', exact: true }).click()
  const openSecond = () => page.getByRole('button', { name: 'Second Guild' }).click()
  const openFirst = () => page.getByRole('button', { name: 'Core Guild' }).click()

  // First visits: the photos' size is not known yet, so they may grow, but the bottom holds.
  await expectSwitchHolds(page, openAnnouncements, lastOf(announcements.id), { stableTop: false })
  await expectSwitchHolds(page, openSecond, lastOf(secondChannels[0].id), { stableTop: false })
  // Later visits draw every row at its final place from the first frame.
  for (let repeat = 0; repeat < 3; repeat += 1) {
    // The first server opens on the channel it was left on.
    await expectSwitchHolds(page, openFirst, lastOf(announcements.id), { stableTop: true })
    await expectSwitchHolds(page, openGeneral, lastOf(general.id), { stableTop: true })
    await expectSwitchHolds(page, openAnnouncements, lastOf(announcements.id), { stableTop: true })
    await expectSwitchHolds(page, openSecond, lastOf(secondChannels[0].id), { stableTop: true })
  }

  // After a reload the photos are fetched again; their remembered size holds their place.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Preview photo-2.png' })).toBeVisible()
  await expectSwitchHolds(page, openSecond, lastOf(secondChannels[0].id), { stableTop: true })
})
