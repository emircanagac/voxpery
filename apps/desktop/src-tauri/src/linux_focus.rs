//! Keyboard focus for the Linux CEF webview (tauri-apps/tauri#16251).
//!
//! On Linux the CEF browser is a foreign X11 child of the GTK window. After the window is
//! shown, focused or reactivated, X11 input focus can stay on GTK's focus proxy: clicks still
//! focus page inputs, but no key events reach the page. When the window gains focus, give the
//! browser CEF focus and move X11 input focus to the browser window.
//!
//! A click inside the already focused window can hand X11 focus back to GTK without a new
//! window focus event, so the page also asks for the browser to be refocused after each click
//! (`refocus_webview_keyboard`). That path only moves focus that is still inside this window,
//! so it never pulls focus back from another application.

use cef::{ImplBrowser, ImplBrowserHost};
use std::mem::MaybeUninit;
use x11_dl::xlib;

/// Called when the window gains focus.
pub fn focus_webview_keyboard(window: &tauri::WebviewWindow) {
    focus_browser(window, false);
}

/// Called after a click in the page; does nothing unless X11 focus is still in this window.
pub fn refocus_webview_keyboard(window: &tauri::WebviewWindow) {
    focus_browser(window, true);
}

fn focus_browser(window: &tauri::WebviewWindow, only_within_window: bool) {
    // with_webview only queues the callback for CEF's UI thread, so it is safe to call from a
    // window event handler (blocking webview getters there deadlock under CEF).
    let _ = window.with_webview(move |platform| {
        let Some(webview) = platform.downcast_ref::<tauri_runtime_cef::Webview>() else {
            return;
        };
        let Some(host) = webview.browser().host() else {
            return;
        };
        let browser_window = host.window_handle() as xlib::Window;
        if !only_within_window {
            host.set_focus(1);
            focus_x11_window(browser_window, false);
        } else if focus_x11_window(browser_window, true) {
            host.set_focus(1);
        }
    });
}

/// Runs on CEF's UI thread, which owns the X display returned by `cef::get_xdisplay`.
/// Returns whether the browser window holds (or was given) X11 input focus.
fn focus_x11_window(window: xlib::Window, only_within_window: bool) -> bool {
    if window == 0 {
        return false;
    }
    let Ok(x) = xlib::Xlib::open() else {
        return false;
    };
    unsafe {
        let display = cef::get_xdisplay().cast::<xlib::Display>();
        if display.is_null() {
            return false;
        }
        let mut attributes = MaybeUninit::<xlib::XWindowAttributes>::uninit();
        // Focusing an unmapped window raises a BadMatch X error.
        if (x.XGetWindowAttributes)(display, window, attributes.as_mut_ptr()) == 0
            || attributes.assume_init().map_state != xlib::IsViewable
        {
            return false;
        }
        if only_within_window {
            let mut focused: xlib::Window = 0;
            let mut revert_to = 0;
            (x.XGetInputFocus)(display, &mut focused, &mut revert_to);
            if focused == window {
                return true;
            }
            // `None` and `PointerRoot` are not windows; anything outside this window's tree
            // belongs to another application.
            if focused <= 1 {
                return false;
            }
            match (
                top_level_window(&x, display, focused),
                top_level_window(&x, display, window),
            ) {
                (Some(focused_top), Some(own_top)) if focused_top == own_top => {}
                _ => return false,
            }
        }
        (x.XSetInputFocus)(display, window, xlib::RevertToParent, xlib::CurrentTime);
        (x.XFlush)(display);
        true
    }
}

/// The ancestor directly below the root window (the window manager frame or the toplevel).
unsafe fn top_level_window(
    x: &xlib::Xlib,
    display: *mut xlib::Display,
    mut window: xlib::Window,
) -> Option<xlib::Window> {
    // Window trees are shallow; the bound only guards against a broken server reply.
    for _ in 0..64 {
        let mut root: xlib::Window = 0;
        let mut parent: xlib::Window = 0;
        let mut children: *mut xlib::Window = std::ptr::null_mut();
        let mut count = 0;
        if (x.XQueryTree)(
            display,
            window,
            &mut root,
            &mut parent,
            &mut children,
            &mut count,
        ) == 0
        {
            return None;
        }
        if !children.is_null() {
            (x.XFree)(children.cast());
        }
        if parent == 0 || parent == root {
            return Some(window);
        }
        window = parent;
    }
    None
}
