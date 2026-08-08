# Theme System

Voxpery ships with four local appearance themes: Voxpery Blue, Dark, Rose, and Light. Users can also choose a custom accent color. Preferences are stored on the current device and are shared by the web app and the Tauri webview through browser storage.

## Startup

`apps/web/public/theme-init.js` runs synchronously from `index.html` before the React entry point. It validates the stored theme and accent, applies them to the root element, and updates the browser chrome color. Keep this file dependency-free and compatible with the production Content Security Policy so a saved theme does not flash back to the default palette during startup.

`apps/web/src/theme.ts` is the typed runtime API used after startup. The two implementations intentionally share the same storage keys and validation rules.

## Styling Rules

- Build core surfaces from the semantic variables in `apps/web/src/index.css`, such as `--bg-chat`, `--bg-surface`, `--bg-input`, `--text-primary`, and `--border-subtle`.
- Build selected and focus states from `--accent-primary` instead of fixed blue, pink, or purple values.
- Use `rgba(var(--ui-contrast-rgb), alpha)` for neutral overlays that must work on both dark and light surfaces.
- Keep status, warning, and destructive colors semantic; they are not user accent colors.
- Do not add a light theme by filtering or inverting the rendered application. Each surface must retain intentional contrast.

Custom accents update the primary accent and button tokens. Button text is selected from dark or white text using the higher WCAG contrast ratio.

## Validation

Run the normal frontend checks:

```bash
cd apps/web
npm run lint
npm run test:run
npm run test:e2e:ui-smoke
npm run test:e2e:mobile-smoke
npm run build
```

Theme unit tests enforce valid storage fallback and WCAG AA contrast. Playwright coverage verifies persistence and horizontal layout stability on desktop and mobile viewports.
