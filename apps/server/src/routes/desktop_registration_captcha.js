// This page has no native IPC; tokens remain in the browser form for Siteverify.
addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('registration-captcha')
  const status = document.getElementById('registration-captcha-status')
  const retry = document.getElementById('registration-captcha-retry')
  const submit = container.closest('form').querySelector('button[type=submit]')
  let attempt = 0
  let widget
  let script
  let timeout
  const fail = message => {
    attempt += 1
    clearTimeout(timeout)
    submit.disabled = true
    status.textContent = message
    status.setAttribute('role', 'alert')
    retry.hidden = false
    script?.remove()
    if (widget !== undefined) {
      try { window.turnstile.remove(widget) } catch { /* The provider may be unavailable. */ }
      widget = undefined
    }
  }
  const render = current => {
    clearTimeout(timeout)
    if (current !== attempt) return
    if (typeof window.turnstile?.render !== 'function') { fail('CAPTCHA could not be initialized. Try again.'); return }
    status.textContent = ''
    try {
      widget = window.turnstile.render(container, {
        sitekey: container.dataset.sitekey,
        size: 'flexible',
        'response-field-name': 'captcha_token',
        callback: () => { if (current === attempt) submit.disabled = false },
        'expired-callback': () => { if (current === attempt) submit.disabled = true },
        'error-callback': () => { if (current === attempt) fail('CAPTCHA verification failed. Try again.') },
        'timeout-callback': () => { if (current === attempt) fail('CAPTCHA timed out. Try again.') },
        'unsupported-callback': () => { if (current === attempt) fail('CAPTCHA is not supported in this browser.') },
      })
    } catch { fail('CAPTCHA could not be initialized. Try again.') }
  }
  const load = () => {
    const current = ++attempt
    submit.disabled = true
    retry.hidden = true
    status.setAttribute('role', 'status')
    status.textContent = 'Loading CAPTCHA...'
    if (window.turnstile) { render(current); return }
    script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => render(current)
    script.onerror = () => { if (current === attempt) fail('CAPTCHA could not be loaded. Check your connection and try again.') }
    timeout = setTimeout(() => { if (current === attempt) fail('CAPTCHA loading timed out. Check your connection and try again.') }, 15_000)
    document.head.appendChild(script)
  }
  retry.addEventListener('click', load)
  load()
}, { once: true })
