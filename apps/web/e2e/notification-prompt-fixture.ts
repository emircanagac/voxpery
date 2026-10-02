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

export async function enableNotificationsFromSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  const selector = settings.getByRole('combobox', { name: 'Settings section', exact: true })
  if (await selector.count()) await selector.selectOption('communication')
  else await settings.getByRole('button', { name: 'Communication', exact: true }).click()
  expect(await page.evaluate(() => Reflect.get(window, '__notificationRequests'))).toBe(0)
  const toggle = settings.getByRole('button', { name: 'Browser notifications', exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => Reflect.get(window, '__notificationRequests'))).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('voxpery-settings-push-enabled'))).toBe('1')
  expect(await page.evaluate(() => localStorage.getItem('voxpery-settings-push-explicit'))).toBe('1')
  await settings.getByRole('button', { name: 'Done', exact: true }).click()
}
