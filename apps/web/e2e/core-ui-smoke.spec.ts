import { expect, test, type Locator, type Page } from '@playwright/test'
import { enableNotificationsFromSettings, installMockNotificationPermission } from './notification-prompt-fixture'
import {
  buildCoreChannels,
  buildCoreMembers,
  buildCoreOnboardingGuide,
  buildCoreServer,
  buildFriends,
  buildRequests,
  buildServerMessage,
  createMockCoreState,
  installMockCoreApi,
} from './mock-core-api'

test.describe('mocked core UI smoke', () => {
  for (const scenario of [{ width: 1920, theme: 'dark' }, { width: 1100, theme: 'light' }, { width: 390, theme: 'dark' }, { width: 320, theme: 'light' }]) {
    test(`prepares voice without capture and retains preferences across views at ${scenario.width}px`, { tag: [1920, 320].includes(scenario.width) ? '@core' : [] }, async ({ page }, testInfo) => {
      const server = buildCoreServer()
      await installMockCoreApi(page, createMockCoreState({
        servers: [server], channelsByServerId: { [server.id]: buildCoreChannels(server.id) },
        dmChannels: [{ id: 'dm-ready', peer_id: 'friend-01', peer_username: 'Friend 01', peer_avatar_url: null, peer_status: 'online', unread_count: 0, last_message_at: null, pinned_at: null, is_pinned: false }],
      }))
      await page.addInitScript(theme => {
        localStorage.setItem('voxpery-settings-theme', theme)
        localStorage.setItem('voxpery-settings-global-mute-shortcut', 'F9')
        const activity = { captures: 0, voiceCommands: 0 }
        Reflect.set(window, '__voiceReadyActivity', activity)
        const queryPermission = navigator.permissions.query.bind(navigator.permissions)
        navigator.permissions.query = descriptor => descriptor.name === ('microphone' as PermissionName)
          ? Promise.resolve(Object.assign(new EventTarget(), { state: 'prompt', onchange: null }) as PermissionStatus)
          : queryPermission(descriptor)
        const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = (...args) => { activity.captures++; return capture(...args) }
        const send = WebSocket.prototype.send
        WebSocket.prototype.send = function (data) {
          if (typeof data === 'string' && /SetVoiceControl|JoinVoice/.test(data)) activity.voiceCommands++
          return send.call(this, data)
        }
      }, scenario.theme)
      await page.setViewportSize({ width: scenario.width, height: 844 })
      await page.goto('/servers')
      const dock = page.getByRole('group', { name: 'Voice preferences' })
      await expect(dock).toContainText('Not in voice')
      await expect(dock).toHaveClass(/callbar-frame/)
      await expect(dock).toHaveCSS('border-top-width', '1px')
      await expect(dock).toHaveCSS('border-top-style', 'solid')
      await expect(dock.locator('.callbar-controls-center')).toBeVisible()
      const micBox = (await dock.getByRole('button', { name: 'Mute microphone', exact: true }).boundingBox())!
      const controlsBox = (await dock.locator('.callbar-controls-center').boundingBox())!
      expect(micBox.height).toBe(scenario.width < 1024 ? 44 : 36)
      expect(micBox.width).toBe(micBox.height)
      await expect(dock.locator('.audio-control svg').first()).toHaveCSS('width', scenario.width < 1024 ? '13px' : '16px')
      if (scenario.width === 1920) {
        const frameBox = (await dock.boundingBox())!
        expect(frameBox.width).toBe(600)
        expect(Math.abs(controlsBox.x + controlsBox.width / 2 - frameBox.x - frameBox.width / 2)).toBeLessThan(1)
      }
      const originalHeight = await page.locator('.callbar-overlay').evaluate(el => el.getBoundingClientRect().height)
      await page.keyboard.press('F9')
      await expect(dock.getByRole('button', { name: 'Unmute microphone', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.keyboard.press('F9')
      await dock.getByRole('button', { name: 'Mute microphone', exact: true }).click({ position: { x: 4, y: 4 } })
      await dock.getByRole('button', { name: 'Deafen', exact: true }).click()
      await expect(dock.getByRole('button', { name: 'Unmute microphone', exact: true })).toBeDisabled()
      await expect(dock.getByRole('button', { name: 'Undeafen', exact: true })).toHaveClass(/is-off/)
      await expect(dock.getByRole('button', { name: 'Unmute microphone', exact: true })).toHaveCSS('opacity', '1')
      await dock.getByRole('button', { name: 'Undeafen', exact: true }).hover()
      await expect.poll(() => dock.evaluate(el => {
        const buttons = Array.from(el.querySelectorAll('button'))
        return buttons.every(button => button.getAnimations().every(animation => animation.playState !== 'running'))
          && new Set(buttons.map(button => getComputedStyle(button).color)).size === 1
      })).toBe(true)
      await dock.getByRole('button', { name: 'Undeafen', exact: true }).click()
      await expect(dock.getByRole('button', { name: 'Unmute microphone', exact: true })).toBeEnabled()
      await page.getByRole('link', { name: 'Social', exact: true }).click()
      await expect(dock.getByRole('button', { name: 'Unmute microphone', exact: true })).toHaveClass(/is-off/)
      await page.getByRole('button', { name: 'Open DM with Friend 01', exact: true }).click()
      await expect(page).toHaveURL(/\/social\/dm/)
      await expect(dock.getByRole('button', { name: 'Unmute microphone', exact: true })).toHaveClass(/is-off/)
      await page.locator('.message-input:visible').focus()
      await page.keyboard.press('F9')
      await expect(dock.getByRole('button', { name: 'Unmute microphone', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await dock.getByRole('button', { name: 'Unmute microphone', exact: true }).click()
      await dock.getByRole('button', { name: 'Deafen', exact: true }).click()
      await dock.getByRole('button', { name: 'Undeafen', exact: true }).click()
      await expect(dock.getByRole('button', { name: 'Mute microphone', exact: true })).toHaveAttribute('aria-pressed', 'false')
      await dock.getByRole('button', { name: 'Mute microphone', exact: true }).press('Tab')
      await expect(dock.getByRole('button', { name: 'Deafen', exact: true })).toBeFocused()
      await expect(dock.getByRole('button', { name: 'Deafen', exact: true })).toHaveCSS('outline-style', 'solid')
      expect(await page.evaluate(() => Reflect.get(window, '__voiceReadyActivity'))).toEqual({ captures: 0, voiceCommands: 0 })
      expect(await page.locator('.callbar-overlay').evaluate(el => el.getBoundingClientRect().height)).toBe(originalHeight)
      expect(await dock.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect(await dock.evaluate(el => {
        const bounds = el.getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= window.innerWidth
      })).toBe(true)
      await page.locator('.callbar-overlay').screenshot({ path: testInfo.outputPath('idle-voice-dock.png') })
    })
  }

  test('keeps connected audio touch targets inside the existing footer with every control visible', async ({ page }, testInfo) => {
    await installMockCoreApi(page, createMockCoreState())
    await page.goto('/social')
    await expect(page.getByRole('group', { name: 'Voice preferences' })).toBeVisible()
    // This layout fixture checks the connected chrome, not a real media session.
    await page.evaluate(() => {
      const idle = document.querySelector<HTMLElement>('.callbar-frame')!
      const frame = idle.cloneNode(true) as HTMLElement
      frame.className = 'callbar-frame active-call-bar'
      frame.setAttribute('aria-label', 'Connected voice layout fixture')
      const status = frame.querySelector<HTMLElement>('.callbar-status')!
      status.className = 'callbar-status'
      status.textContent = 'Test voice'
      const controls = frame.querySelector<HTMLElement>('.callbar-controls-center')!
      for (const label of ['Camera', 'Share screen']) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'callbar-control-btn media-control'
        button.setAttribute('aria-label', label)
        button.textContent = label[0]
        controls.append(button)
      }
      const right = document.createElement('div')
      right.className = 'callbar-controls-right'
      right.innerHTML = '<span class="callbar-connection-inline"><span class="callbar-ping-chip is-good" role="status" aria-label="Voice ping: 92ms." title="Voice ping: 92ms."><span class="callbar-ping-inline-icon" aria-hidden="true">~</span><span class="callbar-ping-value">92ms</span></span></span><button type="button" class="callbar-control-btn danger" aria-label="Leave voice channel">X</button>'
      frame.append(right)
      idle.style.display = 'none'
      idle.after(frame)
    })
    const frame = page.getByRole('group', { name: 'Connected voice layout fixture' })
    for (const width of [320, 360, 390, 800, 1920]) {
      await page.setViewportSize({ width, height: 844 })
      const footerBox = (await page.locator('.callbar-overlay').boundingBox())!
      const frameBox = (await frame.boundingBox())!
      expect(frameBox.height).toBeLessThanOrEqual(footerBox.height)
      expect(frameBox.x).toBeGreaterThanOrEqual(footerBox.x)
      expect(frameBox.x + frameBox.width).toBeLessThanOrEqual(footerBox.x + footerBox.width)
      const buttons = await frame.getByRole('button').all()
      let previousRight = frameBox.x
      for (const button of buttons) {
        const box = (await button.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(previousRight)
        expect(box.x + box.width).toBeLessThanOrEqual(frameBox.x + frameBox.width)
        expect(box.y).toBeGreaterThanOrEqual(footerBox.y)
        expect(box.y + box.height).toBeLessThanOrEqual(footerBox.y + footerBox.height)
        previousRight = box.x + box.width
      }
      await expect(frame.getByRole('button', { name: 'Mute microphone' })).toHaveCSS('width', width < 1024 ? '44px' : '36px')
      await expect(frame.getByRole('status')).toHaveAttribute('aria-label', 'Voice ping: 92ms.')
      if (width <= 360) await expect(frame.locator('.callbar-ping-value')).toBeHidden()
      else await expect(frame.locator('.callbar-ping-value')).toBeVisible()
      await frame.screenshot({ path: testInfo.outputPath(`connected-layout-fixture-${width}.png`) })
    }
  })

  for (const width of [1920, 1100, 390, 320]) {
    test(`keeps the welcome introduction inline and compact at ${width}px`, async ({ page }, testInfo) => {
      const server = buildCoreServer()
      await installMockCoreApi(page, createMockCoreState({
        servers: [server], channelsByServerId: { [server.id]: buildCoreChannels(server.id) },
      }))
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/servers')
      const guide = page.locator('.server-welcome-guide')
      const action = guide.getByRole('button', { name: 'Open channel general' })
      await expect(action).toHaveText('Introduce yourself in general')
      await expect(guide.locator('.server-welcome-guide__task')).toHaveCount(0)
      await expect(guide.locator('.server-welcome-guide__eyebrow')).toHaveCount(0)
      expect(await guide.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      const bounds = (await guide.boundingBox())!
      const dismissBounds = (await guide.getByRole('button', { name: 'Dismiss welcome guide' }).boundingBox())!
      expect(Math.abs(dismissBounds.y + dismissBounds.height / 2 - bounds.y - bounds.height / 2)).toBeLessThan(1)
      expect(bounds.height).toBeLessThan(160)
      if (width === 1920) {
        expect(bounds.height).toBeLessThan(60)
        const heading = (await guide.getByRole('heading').boundingBox())!
        const button = (await action.boundingBox())!
        expect(Math.abs(heading.y + heading.height / 2 - button.y - button.height / 2)).toBeLessThan(2)
      }
      await action.click()
      await expect(page.locator('.chat-header .channel-title')).toHaveText('general')
      await expect(page.getByRole('textbox', { name: /^Message/ })).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`compact-welcome-${width}.png`) })
      await guide.getByRole('button', { name: 'Dismiss welcome guide' }).click()
      await expect(guide).toBeHidden()
      await page.reload()
      await expect(guide).toBeHidden()
    })
  }

  for (const width of [1100, 390]) {
    test(`opens text and joins voice from the welcome guide at ${width}px`, async ({ page }, testInfo) => {
      const server = buildCoreServer()
      const channels = buildCoreChannels(server.id)
      const textChannel = channels.find(channel => channel.channel_type === 'text')!
      const voiceChannel = channels.find(channel => channel.channel_type === 'voice')!
      const guide = buildCoreOnboardingGuide(server.id)
      guide.recommended_channel_ids = [textChannel.id, voiceChannel.id]
      guide.starter_tasks = [
        `Send your first message in #${textChannel.name}`,
        `Join the ${voiceChannel.name} voice channel`,
        'Explore the open-source project on GitHub',
      ]
      await installMockCoreApi(page, createMockCoreState({
        servers: [server], channelsByServerId: { [server.id]: channels },
        onboardingGuideByServerId: { [server.id]: guide },
      }))
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/servers')
      const card = page.locator('.server-welcome-guide')
      await expect(card.getByRole('button', { name: `Open channel ${textChannel.name}` })).toHaveCount(1)
      await expect(card.getByRole('button', { name: `Join voice channel ${voiceChannel.name}` })).toHaveCount(1)
      await expect(card.getByRole('link', { name: 'View on GitHub' })).toHaveCount(0)
      await expect(card.locator('.server-welcome-guide__task')).toHaveCount(0)
      expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await card.screenshot({ path: testInfo.outputPath(`welcome-actions-${width}.png`) })
      await card.getByRole('button', { name: `Open channel ${textChannel.name}` }).click()
      await expect(page.locator('.chat-header .channel-title')).toHaveText(textChannel.name)
      await expect(page.getByRole('textbox', { name: /^Message/ })).toBeVisible()
      await page.evaluate(() => {
        const voiceWindow = window as Window & {
          __voxperyJoinVoice?: (channelId: string) => Promise<void>
          __welcomeJoinCalls?: string[]
        }
        voiceWindow.__welcomeJoinCalls = []
        voiceWindow.__voxperyJoinVoice = async (channelId) => { voiceWindow.__welcomeJoinCalls?.push(channelId) }
      })
      await card.getByRole('button', { name: `Join voice channel ${voiceChannel.name}` }).click()
      await expect.poll(() => page.evaluate(() => (window as Window & { __welcomeJoinCalls?: string[] }).__welcomeJoinCalls))
        .toEqual([voiceChannel.id])
    })
  }

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1100, height: 600 }]) {
    test(`keeps chat layout stable without automatic notification prompts at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      const server = buildCoreServer()
      const channels = buildCoreChannels(server.id)
      const general = channels.find((channel) => channel.name === 'general')!
      await installMockCoreApi(page, createMockCoreState({
        servers: [server], channelsByServerId: { [server.id]: channels },
        membersByServerId: { [server.id]: buildCoreMembers() },
      }))
      await installMockNotificationPermission(page)
      await page.setViewportSize(viewport)
      await page.goto('/servers')
      const composer = page.getByPlaceholder(`Message #${general.name}`)
      await expect(composer).toBeVisible()
      const headerBefore = await page.locator('.chat-header').boundingBox()
      await expect(page.getByRole('region', { name: 'Enable notifications' })).toHaveCount(0)
      await page.clock.fastForward(120_001)
      await expect(page.getByRole('region', { name: 'Enable notifications' })).toHaveCount(0)
      expect(await page.locator('.chat-header').boundingBox()).toEqual(headerBefore)
      expect(await page.evaluate(() => Reflect.get(window, '__notificationRequests'))).toBe(0)
      await page.getByRole('button', { name: 'Search in conversation' }).click()
      await expect(page.getByRole('region', { name: 'Enable notifications' })).toHaveCount(0)
      await page.getByText('Filters', { exact: true }).click()
      await expect(page.getByRole('button', { name: 'Filter messages by author' })).toBeVisible()
      await page.getByText('Filters', { exact: true }).click()
      await page.getByRole('button', { name: 'Close search' }).click()
      await composer.fill('Composer remains usable')
      await expect(composer).toBeInViewport()
      await page.screenshot({ path: `test-results/notification-prompt-${viewport.width}.png` })
      await enableNotificationsFromSettings(page)
      await page.reload()
      await expect(composer).toBeVisible()
      await page.clock.fastForward(120_001)
      await expect(page.getByRole('region', { name: 'Enable notifications' })).toHaveCount(0)
    })
  }

  test('keeps Social resource links compact and keyboard accessible without leaving the app', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState())
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.addInitScript(() => {
      const openedUrls: string[] = []
      Reflect.set(window, '__socialOpenedUrls', openedUrls)
      window.open = (url) => { openedUrls.push(String(url)); return null }
    })
    await page.goto('/social')

    const panel = page.getByRole('complementary', { name: 'Voxpery information' })
    const community = panel.getByRole('button', { name: 'Community' })
    const star = panel.getByRole('link', { name: 'Star on GitHub' })
    const about = panel.getByRole('link', { name: 'About Voxpery' })
    const sponsorLink = page.getByRole('link', { name: 'Support Voxpery' })
    await expect(panel).toHaveCSS('width', '240px')
    await expect(panel.getByRole('heading', { name: 'Friend Activity' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Voxpery', exact: true })).toHaveCount(0)
    await expect(panel.locator('.community-card, .community-note')).toHaveCount(0)
    await expect(page.locator('.feedback-card')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Support Voxpery/ })).toHaveCount(1)
    await expect(sponsorLink).toHaveAttribute('href', 'https://github.com/sponsors/emircanagac')
    await expect(sponsorLink).toHaveAttribute('target', '_blank')
    await community.focus()
    await page.keyboard.press('Tab')
    await expect(star).toBeFocused()
    await expect(star).toHaveCSS('outline-style', 'solid')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(about).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    const voicePreferences = page.getByRole('group', { name: 'Voice preferences' })
    await expect(voicePreferences.getByRole('button', { name: 'Mute microphone', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(voicePreferences.getByRole('button', { name: 'Deafen', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(sponsorLink).toBeFocused()
    await page.keyboard.press('Enter')
    expect(await page.evaluate(() => Reflect.get(window, '__socialOpenedUrls'))).toEqual([
      'https://github.com/emircanagac/voxpery',
      new URL('/about', page.url()).href,
      'https://github.com/sponsors/emircanagac',
    ])
    await expect(page).toHaveURL(/\/social$/)
    await page.screenshot({ path: 'test-results/social-resources-desktop.png' })

    await star.locator('span').evaluate((element) => { element.textContent = 'VeryLongResourceLabel'.repeat(8) })
    await expect.poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    const starBox = (await panel.locator('.social-resource-link--star').boundingBox())!
    const footerBox = (await sponsorLink.boundingBox())!
    expect(starBox.y + starBox.height).toBeLessThan(footerBox.y)
  })

  test('keeps Social resource contrast and flat surfaces across dark and light themes', async ({ page }) => {
    await installMockCoreApi(page, createMockCoreState())
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/social')
    for (const theme of ['Dark', 'Light']) {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Appearance', exact: true }).click()
      await page.locator('.user-settings-modal .theme-option', { hasText: theme }).click()
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase())
      const rows = await page.locator('.social-resource-link').evaluateAll((elements) => {
        const rgb = (color: string) => color.match(/[\d.]+/g)!.map(Number)
        const luminance = (color: number[]) => color.slice(0, 3).reduce((sum, value, index) => {
          const channel = value / 255
          return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
            * [0.2126, 0.7152, 0.0722][index]
        }, 0)
        return elements.map((element) => {
          const style = getComputedStyle(element)
          const surface = rgb(getComputedStyle(element.closest('.home-side, .support-dock')!).backgroundColor)
          // Resolve color-mix through a canvas before compositing a translucent row.
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 1
          const context = canvas.getContext('2d')!
          context.fillStyle = style.backgroundColor
          context.fillRect(0, 0, 1, 1)
          const pixel = context.getImageData(0, 0, 1, 1).data
          const alpha = pixel[3] / 255
          const background = surface.map((value, index) => pixel[index] * alpha + value * (1 - alpha))
          const text = luminance(rgb(style.color))
          const bg = luminance(background)
          return {
            contrast: (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05),
            backgroundImage: style.backgroundImage,
            backdropFilter: style.backdropFilter,
          }
        })
      })
      expect(rows).toHaveLength(4)
      for (const row of rows) {
        expect(row.contrast).toBeGreaterThanOrEqual(4.5)
        expect(row.backgroundImage).toBe('none')
        expect(row.backdropFilter).toBe('none')
      }
      await page.screenshot({ path: `test-results/social-resources-${theme.toLowerCase()}.png` })
    }
  })

  for (const theme of ['Dark', 'Light', 'Custom Light']) {
    test(`unifies right panel surfaces and resource row states in ${theme}`, async ({ page }) => {
      const server = buildCoreServer()
      await installMockCoreApi(page, createMockCoreState({
        servers: [server],
        channelsByServerId: { [server.id]: buildCoreChannels(server.id) },
        membersByServerId: { [server.id]: buildCoreMembers() },
      }))
      await page.setViewportSize({ width: 1920, height: 1080 })
      await page.goto('/social')
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Appearance', exact: true }).click()
      await page.locator('.user-settings-modal .theme-option', { hasText: theme === 'Custom Light' ? 'Light' : theme }).click()
      if (theme === 'Custom Light') {
        await page.locator('.user-settings-modal .theme-option', { hasText: 'Custom' }).click()
        const color = page.getByRole('textbox', { name: 'Custom theme hex color' })
        await color.fill('#00a896')
        await color.press('Enter')
        await expect(page.locator('html')).toHaveAttribute('data-custom-theme-mode', 'light')
      }
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await page.mouse.move(320, 10)
      const panel = page.locator('.home-side')
      await expect(panel).toHaveCSS('background-image', 'none')
      const surface = await panel.evaluate((element) => getComputedStyle(element).backgroundColor)
      await expect(page.locator('.support-dock')).toHaveCSS('background-color', surface)
      await expect(panel.getByRole('heading', { name: 'Friend Activity' })).toBeVisible()
      const panelBox = (await panel.boundingBox())!
      const navBox = (await panel.locator('.social-resource-nav').boundingBox())!
      expect(navBox.y).toBeGreaterThanOrEqual(panelBox.y)
      expect(navBox.y).toBeGreaterThan(panelBox.y + 40)
      expect(navBox.y + navBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height - 80)
      const rows = page.locator('.social-resource-nav .social-resource-link')
      const rowStyles = await rows.evaluateAll((elements) => elements.map((element) => {
        const style = getComputedStyle(element)
        return {
          background: style.backgroundColor,
          padding: style.padding,
          height: style.height,
          radius: style.borderRadius,
          weight: style.fontWeight,
          color: style.color,
          borderStyle: style.borderTopStyle,
          borderWidth: style.borderTopWidth,
        }
      }))
      expect(rowStyles).toHaveLength(3)
      expect(new Set(rowStyles.map((style) => JSON.stringify(style))).size).toBe(1)
      expect(rowStyles[0].background).not.toBe('rgba(0, 0, 0, 0)')
      expect(rowStyles[0].borderStyle).toBe('solid')
      expect(rowStyles[0].borderWidth).toBe('1px')
      await expect(rows.locator('.social-resource-link-trailing')).toHaveCount(3)
      const hoverColors: string[] = []
      for (let index = 0; index < 3; index++) {
        const row = rows.nth(index)
        await row.hover()
        hoverColors.push(await row.evaluate((element) => getComputedStyle(element).backgroundColor))
        await row.focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Shift+Tab')
        await expect(row).toBeFocused()
        await expect(row).toHaveCSS('outline-style', 'solid')
      }
      expect(new Set(hoverColors).size).toBe(1)
      await page.mouse.move(320, 10)
      await page.screenshot({ path: `test-results/right-panel-social-${theme.replace(' ', '-').toLowerCase()}.png` })
      await page.goto('/servers')
      const members = page.locator('.member-sidebar:not(.member-sidebar--sheet)')
      await expect(members).toBeVisible()
      await expect(members).toHaveCSS('width', '240px')
      await expect(members).toHaveCSS('background-color', surface)
      await expect(members).toHaveCSS('background-image', 'none')
      await expect(members).toHaveCSS('box-shadow', 'none')
      await expect(page.locator('.support-dock')).toHaveCSS('background-color', surface)
      await page.screenshot({ path: `test-results/right-panel-server-${theme.replace(' ', '-').toLowerCase()}.png` })
    })
  }

  for (const viewport of [
    { width: 1024, height: 600 }, { width: 1023, height: 600 },
    { width: 800, height: 600 }, { width: 390, height: 844 }, { width: 320, height: 568 },
  ]) {
    test(`preserves Social resource responsiveness at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await installMockCoreApi(page, createMockCoreState())
      await page.setViewportSize(viewport)
      await page.goto('/social')
      const panel = page.getByRole('complementary', { name: 'Voxpery information', includeHidden: true })
      const support = page.locator('.project-support-link')
      if (viewport.width >= 1024) {
        await expect(panel).toHaveCSS('width', '240px')
        await expect(panel).toBeVisible()
        await expect(support).toBeInViewport()
        const actionBox = (await panel.getByRole('link', { name: 'About Voxpery' }).boundingBox())!
        const supportBox = (await support.boundingBox())!
        expect(actionBox.y + actionBox.height).toBeLessThan(supportBox.y)
      } else {
        await expect(panel).toBeHidden()
        await expect(support).toBeHidden()
        await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeInViewport()
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `test-results/social-resources-${viewport.width}.png` })
    })
  }

  for (const alreadyJoined of [true, false]) {
    test(`opens the existing Community flow when already joined is ${alreadyJoined}`, async ({ page }) => {
      const server = buildCoreServer({ name: 'Voxpery', invite_code: 'voxpery' })
      const state = createMockCoreState({
        servers: alreadyJoined ? [server] : [],
        inviteServersByCode: { voxpery: server },
        channelsByServerId: { [server.id]: buildCoreChannels(server.id) },
        membersByServerId: { [server.id]: buildCoreMembers() },
      })
      await installMockCoreApi(page, state)
      await page.goto('/social')
      await page.getByRole('complementary', { name: 'Voxpery information' })
        .getByRole('button', { name: 'Community' }).focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/servers$/)
      await expect(page.locator('.channel-header-title')).toHaveText('Voxpery')
      await expect(page.locator('.member-sidebar')).toHaveCSS('width', '240px')
      await expect(page.getByRole('contentinfo', { name: 'Voxpery support' })
        .getByRole('link', { name: 'Support Voxpery' })).toBeVisible()
      await expect(page.locator('.feedback-card')).toHaveCount(0)
      expect(state.serverJoinCount).toBe(alreadyJoined ? 0 : 1)
    })
  }

  test('keeps Friends tabs scrollable and friend actions reachable', { tag: '@core' }, async ({ page }) => {
    const state = createMockCoreState({
      friends: buildFriends(30),
      incomingRequests: buildRequests(36, 'incoming'),
      outgoingRequests: buildRequests(30, 'outgoing'),
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')

    await expect(page.getByRole('button', { name: /Online/ })).toBeVisible()
    await expect(page.getByText('Online Friends — 30')).toBeVisible()
    await expectScrollable(page.locator('.home-friends-scroll').first())

    await page.getByRole('button', { name: /All/ }).click()
    await expect(page.getByText('All Friends — 30')).toBeVisible()
    await expectScrollable(page.locator('.home-friends-scroll').first())
    await expect(page.getByRole('button', { name: 'More actions for Friend 01' })).toBeVisible()

    const allScroller = page.locator('.home-friends-scroll').first()
    await allScroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(page.getByText('Friend 30')).toBeVisible()

    await page.getByRole('button', { name: /^Add Friend/ }).click()
    const requestScroller = page.locator('.home-friends-scroll--requests')
    await expect(page.getByText('Incoming')).toBeVisible()
    await expect(page.getByText('Outgoing')).toBeVisible()
    await expectScrollable(requestScroller)

    await requestScroller.evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await expect(page.getByText('Request Out 30')).toBeVisible()
  })

  test('opens a DM from a Friends row and sends a message', { tag: '@core' }, async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(8) })
    await installMockCoreApi(page, state)

    await page.goto('/social')
    await page.getByRole('button', { name: /All/ }).click()
    await page.getByRole('button', { name: 'Message Friend 01' }).click()

    await expect(page).toHaveURL(/\/social\/dm/)
    const messageInput = page.getByPlaceholder('Message @Friend 01')
    await expect(messageInput).toBeVisible()

    const content = `Mocked smoke message ${Date.now()}`
    await messageInput.fill(content)
    await messageInput.press('Enter')

    await expect(page.getByText(content)).toBeVisible()
    expect(state.dmMessagesByChannelId['dm-friend-01']?.some((message) => message.content === content)).toBe(true)

    await messageInput.fill('😀'.repeat(4001))
    await expect(messageInput).toHaveValue('😀'.repeat(4000))
    await expect(page.getByLabel('Characters remaining')).toHaveText('0')
  })

  test('keeps the Friends surface usable on mobile viewport', async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(18) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 390, height: 760 })

    await page.goto('/social')

    await expect(page.getByRole('button', { name: /Online/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /All/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Add Friend/ })).toBeVisible()

    await page.getByRole('button', { name: /All/ }).click()
    await expect(page.getByRole('button', { name: 'Message Friend 01' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'More actions for Friend 01' })).toBeVisible()

    const hasHorizontalOverflow = await page.locator('.home-main').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)
  })

  test('sends a server channel message and keeps channel switching intact', { tag: '@core' }, async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    const announcements = channels.find((channel) => channel.name === 'announcements')
    if (!general || !announcements) throw new Error('Core channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {
        [general.id]: [buildServerMessage(general.id, 'Pinned release note', {
          created_at: new Date().toISOString(),
        })],
        [announcements.id]: [buildServerMessage(announcements.id, 'Announcements stay visible')],
      },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')

    await expect(page.locator('.server-icon[data-server-id="server-core"]')).toBeVisible()
    await expect(page.locator('.channel-header-title')).toHaveText('Core Guild')
    await expect(page.locator('.chat-header .channel-title')).toHaveText('general')
    await expect(page.getByText('Pinned release note')).toBeVisible()
    await expect(page.getByRole('contentinfo', { name: 'Voxpery support' })
      .getByRole('link', { name: 'Support Voxpery' })).toBeVisible()
    await expect(page.locator('.feedback-card')).toHaveCount(0)

    const content = `Server smoke message ${Date.now()}`
    const messageInput = page.getByPlaceholder('Message #general')
    await expect(messageInput).toBeVisible()
    await messageInput.fill(content)
    await messageInput.press('Enter')

    await expect(page.getByText(content)).toBeVisible()
    await expectVirtualMessageHeight(page.locator('.virtual-list-item', { hasText: content }), 53)
    expect(state.messagesByChannelId[general.id]?.some((message) => message.content === content)).toBe(true)

    const continuation = `Server smoke continuation ${Date.now()}`
    await messageInput.fill(continuation)
    await messageInput.press('Enter')

    await expect(page.getByText(continuation)).toBeVisible()
    await expectVirtualMessageHeight(page.locator('.virtual-list-item', { hasText: continuation }), 23)
    expect(state.messagesByChannelId[general.id]?.some((message) => message.content === continuation)).toBe(true)

    await page.locator('.channel-item', { hasText: 'announcements' }).click()
    await expect(page.locator('.chat-header .channel-title')).toHaveText('announcements')
    await expect(page.getByText('Announcements stay visible')).toBeVisible()

    const hasHorizontalOverflow = await page.locator('.app-layout').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)
  })

  test('keeps the expression picker wide, persistent, and free of GIF cropping', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: { [general.id]: [] },
    })
    await installMockCoreApi(page, state)
    await page.route('https://media.giphy.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
    }))
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/servers')

    await page.getByRole('button', { name: 'Emoji, GIFs and stickers' }).click()
    await page.getByRole('tab', { name: 'GIF', exact: true }).click()
    const picker = page.locator('.chat-emoji-picker')
    await expect(picker).toBeVisible()
    await expect.poll(async () => picker.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(420)
    await expect.poll(async () => page.evaluate(() => {
      const pickerRect = document.querySelector('.chat-emoji-picker')?.getBoundingClientRect()
      const chatRect = document.querySelector('.chat-area')?.getBoundingClientRect()
      const inputRect = document.querySelector('.message-input-wrapper')?.getBoundingClientRect()
      if (!pickerRect || !chatRect || !inputRect) return false
      return pickerRect.left >= chatRect.left + 7
        && pickerRect.right <= chatRect.right - 7
        && pickerRect.top >= chatRect.top + 7
        && pickerRect.bottom <= inputRect.top + 1
    })).toBe(true)
    await expect.poll(async () => page.locator('.chat-gif-grid').evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        display: style.display,
        columns: style.gridTemplateColumns.split(' ').length,
        masonryColumns: element.querySelectorAll('.chat-gif-column').length,
        overflowsHorizontally: element.scrollWidth > element.clientWidth + 1,
      }
    })).toEqual({ display: 'grid', columns: 2, masonryColumns: 2, overflowsHorizontally: false })

    await picker.locator('.chat-gif-card').filter({ has: page.getByRole('button', { name: 'Send Celebration', exact: true }) }).hover()
    await page.getByRole('button', { name: 'Add Celebration to favorites' }).click()
    await page.getByRole('button', { name: 'Favorites', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Send Celebration' })).toBeVisible()
    await page.getByRole('button', { name: 'Send Celebration' }).click()

    const sentGif = page.locator('.chat-inline-gif').last()
    await expect(sentGif).toBeVisible()
    await expect.poll(async () => sentGif.evaluate((element) => {
      const style = window.getComputedStyle(element)
      return { fit: style.objectFit, usesNaturalRatio: style.aspectRatio.startsWith('auto') }
    })).toEqual({ fit: 'contain', usesNaturalRatio: true })
    expect(state.messagesByChannelId[general.id]?.some((message) => message.content.startsWith('![gif]('))).toBe(true)

    await page.getByRole('button', { name: 'Emoji, GIFs and stickers' }).click()
    await expect(page.getByRole('tab', { name: 'GIF', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: 'Emoji', exact: true }).click()
    await expect(page.getByRole('group', { name: 'Emoji categories' }).getByRole('button')).toHaveCount(10)
    await expect.poll(async () => page.locator('.chat-emoji-grid').evaluate((element) => (
      getComputedStyle(element).gridTemplateColumns.split(' ').length
    ))).toBe(10)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Emoji, GIFs and stickers' }).click()
    await page.getByRole('tab', { name: 'GIF', exact: true }).click()
    await page.getByRole('button', { name: 'Favorites', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Remove Celebration from favorites' })).toBeVisible()

    await page.getByRole('tab', { name: 'Sticker' }).click()
    const stickerCollections = page.getByRole('group', { name: 'Sticker collections' })
    await expect(stickerCollections.getByRole('button')).toHaveCount(3)
    await expect(stickerCollections.getByRole('button').allTextContents()).resolves.toEqual(['Browse', 'Recent', 'Favorites'])
    await expect(stickerCollections.getByRole('button', { name: 'Browse' })).toHaveAttribute('aria-pressed', 'true')
    const sticker = picker.locator('.chat-sticker-card').first()
    const stickerSize = (await sticker.boundingBox())!
    await sticker.hover()
    await sticker.getByRole('button', { name: /^Add .* to favorites$/ }).click()
    await stickerCollections.getByRole('button', { name: 'Favorites', exact: true }).click()
    await expect(picker.locator('.chat-sticker-card')).toHaveCount(1)
    const favoriteSize = (await picker.locator('.chat-sticker-card').boundingBox())!
    expect(favoriteSize.width).toBeCloseTo(stickerSize.width, 1)
    expect(favoriteSize.height).toBeCloseTo(stickerSize.height, 1)
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 568 })
      const favorite = (await picker.locator('.chat-sticker-card').boundingBox())!
      expect(favorite.width).toBeLessThanOrEqual(110)
      expect(favorite.height).toBeCloseTo(favorite.width, 1)
      await expect.poll(() => picker.locator('.chat-expression-filter-tabs button').evaluateAll(elements => elements.every(element => {
        const rect = element.getBoundingClientRect()
        const content = document.querySelector('.chat-emoji-content')!.getBoundingClientRect()
        return rect.left >= content.left && rect.right <= content.right + 1 && element.scrollWidth <= element.clientWidth + 1
      }))).toBe(true)
    }
    await stickerCollections.getByRole('button', { name: 'Browse', exact: true }).click()
    const beforeScroll = await picker.getByRole('tablist').boundingBox()
    await page.locator('.chat-sticker-grid').evaluate(element => { element.scrollTop = element.scrollHeight })
    expect(await picker.getByRole('tablist').boundingBox()).toEqual(beforeScroll)
    await page.getByRole('button', { name: 'Close expression picker' }).click()
    await expect(picker).toBeHidden()
    await expect(page.getByRole('button', { name: 'Emoji, GIFs and stickers' })).toBeFocused()
  })

  test('keeps first-message text fixed while optimistic delivery is confirmed', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: { [general.id]: [] },
      serverMessageSendDelayMs: 300,
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.goto('/servers')
    await expect(page.locator('.chat-header .channel-title')).toHaveText('general')
    const content = `Delayed first message ${Date.now()}`
    await startMessageGeometrySampling(page, content)
    const messageInput = page.getByPlaceholder('Message #general')
    await messageInput.fill(content)
    await messageInput.press('Enter')

    const messageRow = page.locator('.virtual-list-item', { hasText: content })
    await expect(messageRow).toBeVisible()
    await expect(messageRow.locator('.message-inline-actions')).toBeAttached()
    await page.waitForTimeout(400)
    const samples = await readMessageGeometrySamples(page)
    expect(samples.length).toBeGreaterThan(1)
    expect(samples.some((sample) => !sample.hasActions)).toBe(true)
    expect(samples.some((sample) => sample.hasActions)).toBe(true)
    expect(geometryRange(samples, 'avatarY')).toBeLessThan(0.25)
    expect(geometryRange(samples, 'authorY')).toBeLessThan(0.25)
    expect(geometryRange(samples, 'bodyY')).toBeLessThan(0.25)
  })

  test('creates a channel from the sidebar and makes it selectable', { tag: '@core' }, async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {},
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')
    await page.getByRole('button', { name: 'Create channel in GENERAL' }).click()

    const modal = page.locator('.modal-create-channel')
    await expect(modal.getByRole('heading', { name: 'Create Channel' })).toBeVisible()
    await modal.getByPlaceholder('e.g. general').fill('raid-notes')
    await expect(modal.locator('input[list="channel-category-suggestions"]')).toHaveValue('GENERAL')
    await modal.getByPlaceholder('What is this channel for?').fill('Planning notes used by the smoke test.')
    await modal.getByRole('button', { name: 'Create Channel' }).click()

    await expect(modal).toBeHidden()
    const createdChannel = state.channelsByServerId[server.id].find((channel) => channel.name === 'raid-notes')
    expect(createdChannel).toBeTruthy()

    await page.locator('.channel-item', { hasText: 'raid-notes' }).click()
    await expect(page.locator('.chat-header .channel-title')).toHaveText('raid-notes')
    await expect(page.getByPlaceholder('Message #raid-notes')).toBeVisible()
  })

  test('keeps quick switcher navigation wired to channels and DMs', { tag: '@core' }, async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const state = createMockCoreState({
      friends: buildFriends(4),
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {},
      dmChannels: [{
        id: 'dm-friend-01',
        peer_id: 'friend-01',
        peer_username: 'Friend 01',
        peer_avatar_url: null,
        peer_status: 'online',
        last_message_at: null,
        unread_count: 0,
        pinned_at: null,
        is_pinned: false,
      }],
      dmMessagesByChannelId: { 'dm-friend-01': [] },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')
    await page.getByTitle('Search servers, channels, and direct messages').click()
    await page.getByPlaceholder('Search servers, channels, and direct messages').fill('announcements')
    await page.getByRole('dialog', { name: 'Quick switcher' }).getByRole('button', { name: /# announcements/ }).click()

    await expect(page).toHaveURL(/\/servers/)
    await expect(page.locator('.chat-header .channel-title')).toHaveText('announcements')

    await page.getByTitle('Search servers, channels, and direct messages').click()
    await page.getByPlaceholder('Search servers, channels, and direct messages').fill('Friend 01')
    await page.getByRole('dialog', { name: 'Quick switcher' }).getByRole('button', { name: /Friend 01/ }).click()

    await expect(page).toHaveURL(/\/social\/dm/)
    await expect(page.getByPlaceholder('Message @Friend 01')).toBeVisible()
  })

  test('keeps message actions wired for edit, reaction, pin, search, and delete', { tag: '@core' }, async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {
        [general.id]: [
          buildServerMessage(general.id, 'Remote searchable topic', { id: 'friend-message' }),
          buildServerMessage(general.id, 'Local editable note', {
            id: 'own-message',
            author: {
              user_id: 'user-local',
              username: 'localuser',
              avatar_url: undefined,
              role_color: '#93c5fd',
            },
          }),
        ],
      },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')
    const ownRow = page.locator('[data-message-id="own-message"]')
    const friendRow = page.locator('[data-message-id="friend-message"]')
    await expect(ownRow).toBeVisible()
    await expect(friendRow).toBeVisible()

    await ownRow.hover()
    await ownRow.getByRole('button', { name: 'Edit' }).click()
    await ownRow.getByRole('textbox', { name: 'Edit message' }).fill('Edited local note')
    await ownRow.getByTitle('Save').click()
    await expect(page.getByText('Edited local note')).toBeVisible()
    await expect.poll(() => state.messagesByChannelId[general.id].some((message) => message.content === 'Edited local note')).toBe(true)

    await friendRow.hover()
    await friendRow.getByRole('button', { name: 'Add reaction' }).click()
    await page.getByRole('button', { name: 'thumbs up' }).click()
    await expect(friendRow.locator('.message-reaction-btn')).toContainText('👍')
    await expect(friendRow.locator('.message-reaction-btn')).toContainText('1')

    await friendRow.hover()
    await friendRow.getByRole('button', { name: 'Pin' }).click()
    await page.getByRole('button', { name: 'Pinned messages' }).click()
    await expect(page.locator('.chat-header-pinned-dropdown')).toContainText('Remote searchable topic')

    await page.getByRole('button', { name: 'Pinned messages' }).click()
    await page.getByRole('button', { name: 'Search in conversation' }).click()
    await page.getByText('Filters', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Filter messages by author' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Filter messages with attachments' })).toBeVisible()
    await page.getByText('Filters', { exact: true }).click()
    await page.getByRole('textbox', { name: 'Search messages' }).fill('Remote searchable')
    // Results open beside the conversation instead of replacing it.
    const results = page.getByRole('complementary', { name: 'Search results' })
    await expect(results).toContainText('1 result')
    await expect(results).toContainText('in #general')
    await expect(results.getByText('Remote searchable topic')).toBeVisible()
    await expect(page.locator('.chat-messages').getByText('Edited local note')).toBeVisible()
    await results.getByRole('button', { name: 'Go to message' }).click()
    await expect(page.locator('.chat-messages').getByText('Remote searchable topic')).toBeInViewport()
    await page.getByRole('textbox', { name: 'Search messages' }).fill('no-such-message-in-this-channel')
    await expect(results.getByRole('status')).toContainText('No messages found')
    await expect(page.locator('.chat-messages').getByText('Edited local note')).toBeVisible()
    await page.getByRole('button', { name: 'Close search' }).click()

    await ownRow.hover()
    await ownRow.getByRole('button', { name: 'Delete' }).click()
    const confirmModal = page.locator('.confirm-modal', { hasText: 'Delete message' })
    await confirmModal.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Edited local note')).toBeHidden()
    await expect.poll(() => state.messagesByChannelId[general.id].some((message) => message.id === 'own-message')).toBe(false)
  })

  test('keeps reactions below inline media and attachments', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')

    const message = buildServerMessage(
      general.id,
      'Media order\n![gif](https://media.example.test/reaction.gif)',
      {
        id: 'media-reaction-message',
        attachments: [
          {
            url: 'https://cdn.example.test/screenshot.png',
            type: 'image/png',
            name: 'screenshot.png',
          },
        ],
        reactions: [{ emoji: '👍', count: 2, reacted: false }],
      }
    )
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: { [general.id]: [message] },
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')
    const row = page.locator('[data-message-id="media-reaction-message"]')
    await expect(row.locator('.message-reactions')).toBeVisible()
    await expect(row.locator('.dm-attachments')).toBeVisible()
    await expect(row.locator('.chat-inline-gif-link')).toBeVisible()
    await expect.poll(async () =>
      row.locator('.chat-inline-gif-link, .dm-attachments, .message-reactions').evaluateAll(
        (elements) => elements.map((element) => element.className)
      )
    ).toEqual(['chat-inline-gif-link', 'dm-attachments', 'message-reactions'])
  })

  test('keeps grouped message actions clear of text without moving the row on hover', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: { [general.id]: [
        buildServerMessage(general.id, 'First message', { id: 'group-first' }),
        buildServerMessage(general.id, 'Grouped message text extending beneath the message actions in a narrow chat area.', { id: 'group-second' }),
      ] },
    })
    await installMockCoreApi(page, state)

    for (const width of [1366, 800, 390]) {
      await page.setViewportSize({ width, height: 768 })
      await page.goto('/servers')
      const row = page.locator('[data-message-id="group-second"]')
      await expect(row.locator('.message-compact')).toBeVisible()
      const heightBefore = await row.evaluate((element) => element.getBoundingClientRect().height)
      await row.hover()
      const geometry = await row.evaluate((element) => {
        const actions = element.querySelector('.message-inline-actions')!.getBoundingClientRect()
        const text = element.querySelector('.message-text span')!.firstChild!
        const range = document.createRange()
        range.selectNodeContents(text)
        const overlaps = Array.from(range.getClientRects()).some((rect) =>
          rect.left < actions.right - 1 && rect.right > actions.left + 1
          && rect.top < actions.bottom - 1 && rect.bottom > actions.top + 1)
        return { overlaps, height: element.getBoundingClientRect().height }
      })
      expect(geometry.overlaps).toBe(false)
      expect(geometry.height).toBe(heightBefore)
    }
  })

  test('preserves portrait and wide photo frames in inline previews', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const general = channels.find((channel) => channel.name === 'general')
    if (!general) throw new Error('Core channel fixture is incomplete.')
    const images = [
      { id: 'portrait', width: 120, height: 360 },
      { id: 'wide', width: 480, height: 120 },
    ]
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: { [general.id]: images.map(({ id }) => buildServerMessage(general.id, `Photo ${id}`, {
        id: `photo-${id}`,
        attachments: [{ url: `/issue-355-${id}.svg`, type: 'image/svg+xml', name: `${id}.svg` }],
      })) },
    })
    await installMockCoreApi(page, state)
    await page.route('**/issue-355-*.svg', async (route) => {
      const image = images.find(({ id }) => route.request().url().endsWith(`issue-355-${id}.svg`))!
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}"><rect width="100%" height="100%" fill="#69b3c7"/></svg>`,
      })
    })

    for (const viewportWidth of [1366, 800, 390]) {
      await page.setViewportSize({ width: viewportWidth, height: 768 })
      await page.goto('/servers')
      for (const image of images) {
        const row = page.locator(`[data-message-id="photo-${image.id}"]`)
        const preview = row.locator('.chat-image-attachment')
        await expect(preview).toBeVisible()
        const size = await preview.evaluate((element: HTMLImageElement) => ({
          naturalRatio: element.naturalWidth / element.naturalHeight,
          renderedRatio: element.getBoundingClientRect().width / element.getBoundingClientRect().height,
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          frameWidth: element.parentElement!.clientWidth,
          frameHeight: element.parentElement!.clientHeight,
        }))
        expect(size.renderedRatio).toBeCloseTo(size.naturalRatio, 2)
        expect(size.width).toBeLessThanOrEqual(320)
        expect(size.height).toBeLessThanOrEqual(220)
        expect(size.width).toBeLessThanOrEqual(size.frameWidth + 1)
        expect(size.height).toBeLessThanOrEqual(size.frameHeight + 1)
        await row.getByRole('button', { name: `Preview ${image.id}.svg` }).click()
        await expect(page.locator('.chat-image-preview-modal')).toBeVisible()
        await page.getByRole('button', { name: 'Close image preview' }).click()
      }
    }
  })

  test('opens Voice & Audio settings without overflowing the settings modal', { tag: '@core' }, async ({ page }) => {
    const state = createMockCoreState({ friends: buildFriends(3) })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/social')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.getByRole('button', { name: 'Voice & Audio' }).click()
    const modal = page.locator('.user-settings-modal')
    await expect(modal).toHaveClass(/user-settings-modal--voice/)
    await expect(page.getByText('Audio devices')).toBeVisible()
    await expect(page.getByText('Microphone', { exact: true })).toBeVisible()
    await expect(page.getByText('Speaker')).toBeVisible()
    await expect(page.getByText('Input tuning')).toBeVisible()
    await expect(page.getByText('Noise suppression')).toBeVisible()
    const noiseToggle = page.getByRole('button', { name: 'Noise suppression' })
    const initialNoiseState = await noiseToggle.getAttribute('aria-pressed')
    expect(['true', 'false']).toContain(initialNoiseState)
    await noiseToggle.click()
    await expect(noiseToggle).toHaveAttribute('aria-pressed', initialNoiseState === 'true' ? 'false' : 'true')
    await expect(page.getByText('Activation mode')).toBeVisible()
    await expect(page.getByText('Toggle microphone mute')).toBeVisible()
    await expect(page.getByText(/Works while this Voxpery tab is focused/)).toBeVisible()
    await page.getByRole('button', { name: 'Set shortcut' }).click()
    await page.keyboard.press('Control+Shift+M')
    await expect(modal.getByText(/^Ctrl\/Cmd\+Shift\+M\./)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rebind' })).toBeVisible()
    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByText(/Not assigned/)).toBeVisible()

    const hasHorizontalOverflow = await modal.evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)

    await page.getByRole('button', { name: 'Done' }).click()
    await expect(modal).toBeHidden()
  })

  test('keeps the voice channel view usable when microphone access is unavailable', { tag: '@core' }, async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const voice = channels.find((channel) => channel.channel_type === 'voice')
    if (!voice) throw new Error('Core voice channel fixture is incomplete.')

    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {},
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 1366, height: 768 })

    await page.goto('/servers')
    await page.locator('.channel-item', { hasText: voice.name }).click()

    await expect(page.locator('.chat-header .channel-title')).toHaveText(voice.name)
    await expect(page.locator('.voice-focus-panel-stage')).toBeVisible()
    await expect(page.locator('.channel-item.active', { hasText: voice.name })).toBeVisible()
    const recovery = page.getByRole('alert', { name: 'Microphone access required' })
    await expect(recovery).toBeVisible()
    await expect(recovery.getByRole('button', { name: 'Try again' })).toBeEnabled()
    await recovery.getByRole('button', { name: 'Try again' }).click()
    await expect(recovery).toBeVisible()
    await recovery.getByRole('button', { name: 'Cancel' }).click()
    await expect(recovery).toBeHidden()

    const hasHorizontalOverflow = await page.locator('.app-layout').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)
  })

  test('keeps the mobile member sheet usable from a server channel', async ({ page }) => {
    const server = buildCoreServer()
    const channels = buildCoreChannels(server.id)
    const state = createMockCoreState({
      servers: [server],
      channelsByServerId: { [server.id]: channels },
      membersByServerId: { [server.id]: buildCoreMembers() },
      messagesByChannelId: {},
    })
    await installMockCoreApi(page, state)
    await page.setViewportSize({ width: 390, height: 760 })

    await page.goto('/servers')
    await expect(page.locator('.chat-header .channel-title')).toHaveText('general')
    await page.getByRole('button', { name: 'View members' }).click()

    const sheet = page.locator('.mobile-member-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', { name: 'Members' })).toBeVisible()
    await expect(sheet).toContainText('2 members')
    await expect(sheet).toContainText('localuser')
    await expect(sheet).toContainText('Friend 01')

    const hasHorizontalOverflow = await page.locator('.shell-layout').evaluate((element) => {
      return element.scrollWidth > element.clientWidth + 1
    })
    expect(hasHorizontalOverflow).toBe(false)

    await sheet.getByRole('button', { name: 'Close members panel' }).click()
    await expect(sheet).toBeHidden()
  })
})

async function expectScrollable(locator: Locator) {
  await expect.poll(async () => {
    return locator.evaluate((element) => element.scrollHeight > element.clientHeight)
  }).toBe(true)
}

type MessageGeometrySample = {
  avatarY: number
  authorY: number
  bodyY: number
  hasActions: boolean
}

async function startMessageGeometrySampling(page: Page, messageText: string) {
  await page.evaluate((targetMessageText) => {
    const samples: MessageGeometrySample[] = []
    Object.defineProperty(window, '__messageGeometrySamples', {
      configurable: true,
      value: samples,
    })
    let frame = 0
    const sample = () => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'))
        .find((candidate) => candidate.querySelector('.message-text')?.textContent === targetMessageText)
      const avatar = row?.querySelector<HTMLElement>('.message-avatar')
      const author = row?.querySelector<HTMLElement>('.message-author')
      const body = row?.querySelector<HTMLElement>('.message-text')
      if (avatar && author && body) {
        samples.push({
          avatarY: avatar.getBoundingClientRect().y,
          authorY: author.getBoundingClientRect().y,
          bodyY: body.getBoundingClientRect().y,
          hasActions: !!row?.querySelector('.message-inline-actions'),
        })
      }
      frame += 1
      if (frame < 60) window.requestAnimationFrame(sample)
    }
    window.requestAnimationFrame(sample)
  }, messageText)
}

async function readMessageGeometrySamples(page: Page): Promise<MessageGeometrySample[]> {
  return page.evaluate(() => {
    return (window as typeof window & {
      __messageGeometrySamples?: MessageGeometrySample[]
    }).__messageGeometrySamples ?? []
  })
}

function geometryRange(samples: MessageGeometrySample[], key: 'avatarY' | 'authorY' | 'bodyY') {
  const values = samples.map((sample) => sample[key])
  return Math.max(...values) - Math.min(...values)
}

async function expectVirtualMessageHeight(locator: Locator, expectedHeight: number) {
  await expect.poll(async () => {
    return locator.evaluate((element) => Math.round(element.getBoundingClientRect().height))
  }).toBe(expectedHeight)
}
