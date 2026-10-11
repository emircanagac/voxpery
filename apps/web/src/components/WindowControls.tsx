import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import type { Window as DesktopWindow } from '@tauri-apps/api/window'

type ResizeDirection = Parameters<DesktopWindow['startResizeDragging']>[0]

const loadDesktopWindow = () =>
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow())

function runWindowAction(action: (desktopWindow: DesktopWindow) => Promise<void>) {
    void loadDesktopWindow()
        .then(action)
        .catch(() => {
            // The window keeps its current state if the runtime rejects the request.
        })
}

function useWindowMaximized() {
    const [maximized, setMaximized] = useState(false)

    useEffect(() => {
        let cancelled = false
        let stopListening: (() => void) | undefined
        void loadDesktopWindow()
            .then(async (desktopWindow) => {
                const sync = async () => {
                    const value = await desktopWindow.isMaximized()
                    if (!cancelled) setMaximized(value)
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
            stopListening?.()
        }
    }, [])

    return maximized
}

/** Minimize, maximize and close for the frameless desktop window (same on every platform). */
export default function WindowControls() {
    const maximized = useWindowMaximized()

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
                onClick={() => runWindowAction((desktopWindow) => desktopWindow.toggleMaximize())}
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
    const maximized = useWindowMaximized()
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

const NEEDS_RESIZE_EDGES = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent)

/**
 * Window frame for the desktop app on every screen: Linux resize borders, and a draggable strip
 * with the window buttons for screens without the app header (sign-in, loading, legal pages).
 * The strip hides itself while the app header, which is the title bar there, is shown.
 */
export function DesktopWindowChrome() {
    return (
        <>
            {NEEDS_RESIZE_EDGES && <WindowResizeEdges />}
            <div className="desktop-window-strip" data-tauri-drag-region="deep">
                <WindowControls />
            </div>
        </>
    )
}
