import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import type { Window as DesktopWindow } from '@tauri-apps/api/window'

type ResizeDirection = Parameters<DesktopWindow['startResizeDragging']>[0]

const ICON_RESYNC_MS = 250
const IS_LINUX_DESKTOP = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent)

const loadDesktopWindow = () =>
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow())

function runWindowAction(action: (desktopWindow: DesktopWindow) => Promise<void>) {
    return loadDesktopWindow()
        .then(action)
        .catch(() => {
            // The window keeps its current state if the runtime rejects the request.
        })
}

function useWindowMaximized(): [boolean, () => void] {
    const [maximized, setMaximized] = useState(false)
    const syncRef = useRef<() => void>(() => {})

    useEffect(() => {
        let cancelled = false
        let stopListening: (() => void) | undefined
        void loadDesktopWindow()
            .then(async (desktopWindow) => {
                const sync = async () => {
                    const value = await desktopWindow.isMaximized()
                    if (!cancelled) setMaximized(value)
                }
                syncRef.current = () => {
                    void sync().catch(() => {})
                }
                await sync()
                const unlisten = await desktopWindow.onResized(() => {
                    void sync()
                })
                if (cancelled) unlisten()
                else stopListening = unlisten
            })
            .catch(() => {
                // Without the window API the controls still work; only the maximize icon stays static.
            })
        return () => {
            cancelled = true
            syncRef.current = () => {}
            stopListening?.()
        }
    }, [])

    // The state can change without a resize (for example a restore the window manager kept at
    // full size), so the icon is also re-read shortly after the button is used.
    const resync = useCallback(() => {
        syncRef.current()
        window.setTimeout(() => syncRef.current(), ICON_RESYNC_MS)
    }, [])

    return [maximized, resync]
}

/** Minimize, maximize and close for the frameless desktop window (same on every platform). */
export default function WindowControls() {
    const [maximized, resyncMaximized] = useWindowMaximized()

    return (
        <div className="window-controls">
            <button
                type="button"
                className="window-control"
                aria-label="Minimize"
                title="Minimize"
                onClick={() => runWindowAction((desktopWindow) => desktopWindow.minimize())}
            >
                <Minus size={16} />
            </button>
            <button
                type="button"
                className="window-control"
                aria-label={maximized ? 'Restore' : 'Maximize'}
                title={maximized ? 'Restore' : 'Maximize'}
                onClick={() => {
                    void runWindowAction((desktopWindow) => (IS_LINUX_DESKTOP
                        // Only Linux needs the restore fix-up; elsewhere the native toggle runs at once.
                        ? import('../desktopWindowMaximize').then(({ toggleDesktopWindowMaximize }) => toggleDesktopWindowMaximize(desktopWindow, true))
                        : desktopWindow.toggleMaximize()))
                        .finally(resyncMaximized)
                }}
            >
                {maximized ? <Copy size={14} /> : <Square size={14} />}
            </button>
            <button
                type="button"
                className="window-control window-control--close"
                aria-label="Close"
                title="Close"
                // Closing goes through the same close request as the system button, so
                // "Keep running in tray on close" still applies.
                onClick={() => runWindowAction((desktopWindow) => desktopWindow.close())}
            >
                <X size={16} />
            </button>
        </div>
    )
}

const RESIZE_EDGES: Array<{ direction: ResizeDirection; className: string }> = [
    { direction: 'North', className: 'window-resize-edge--n' },
    { direction: 'South', className: 'window-resize-edge--s' },
    { direction: 'East', className: 'window-resize-edge--e' },
    { direction: 'West', className: 'window-resize-edge--w' },
    { direction: 'NorthEast', className: 'window-resize-edge--ne' },
    { direction: 'NorthWest', className: 'window-resize-edge--nw' },
    { direction: 'SouthEast', className: 'window-resize-edge--se' },
    { direction: 'SouthWest', className: 'window-resize-edge--sw' },
]

/**
 * Resize borders for the frameless window on Linux. Windows and macOS keep native resize
 * borders without a title bar; the Linux runtime does not, so the page provides them.
 */
function WindowResizeEdges() {
    const [maximized] = useWindowMaximized()
    if (maximized) return null

    return (
        <>
            {RESIZE_EDGES.map(({ direction, className }) => (
                <div
                    key={direction}
                    className={`window-resize-edge ${className}`}
                    aria-hidden="true"
                    onMouseDown={(event) => {
                        if (event.button !== 0) return
                        event.preventDefault()
                        runWindowAction((desktopWindow) => desktopWindow.startResizeDragging(direction))
                    }}
                />
            ))}
        </>
    )
}

const NEEDS_RESIZE_EDGES = IS_LINUX_DESKTOP

/**
 * Window frame for the desktop app on every screen: Linux resize borders, and a draggable strip
 * with the window buttons for screens without the app header (sign-in, loading, legal pages).
 * The strip hides itself while the app header, which is the title bar there, is shown.
 */
export function DesktopWindowChrome() {
    // A saved window size from a bigger or less scaled screen would hang off this one.
    useEffect(() => {
        if (!IS_LINUX_DESKTOP) return
        void runWindowAction((desktopWindow) => import('../desktopWindowMaximize')
            .then(({ fitLinuxDesktopWindowToWorkArea }) => fitLinuxDesktopWindowToWorkArea(desktopWindow)))
    }, [])

    return (
        <>
            {NEEDS_RESIZE_EDGES && <WindowResizeEdges />}
            <div className="desktop-window-strip" data-tauri-drag-region="deep">
                <WindowControls />
            </div>
        </>
    )
}
