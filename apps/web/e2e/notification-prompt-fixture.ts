import { expect, type Page } from '@playwright/test'

export async function installMockNotificationPermission(page: Page) {
  await page.clock.install()
  await page.addInitScript(() => {
    let permission: NotificationPermission = 'default'
    Reflect.set(window, '__notificationRequests', 0)
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        get permission() { return permission },
        requestPermission: async () => {
          Reflect.set(window, '__notificationRequests', Reflect.get(window, '__notificationRequests') + 1)
          permission = 'granted'
          return permission
        },
      },
    })
  })
}

export async function expectNotificationPromptLayout(page: Page) {
  const prompt = page.getByRole('region', { name: 'Enable notifications' })
  await expect(prompt).toBeVisible()
  const promptBox = await prompt.boundingBox()
  const topbarBox = await page.locator('.shell-topbar').boundingBox()
  const headerBox = await page.locator('.chat-header').boundingBox()
  expect(promptBox).not.toBeNull()
  expect(topbarBox).not.toBeNull()
  expect(headerBox).not.toBeNull()
  expect(promptBox!.y).toBeGreaterThanOrEqual(topbarBox!.y + topbarBox!.height - 1)
  expect(promptBox!.y + promptBox!.height).toBeLessThanOrEqual(headerBox!.y + 1)
  expect(await prompt.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await expect(prompt.getByRole('button', { name: 'Not now' })).toBeInViewport()
  await expect(prompt.getByRole('button', { name: 'Enable', exact: true })).toBeInViewport()
}
