import { useCallback, useEffect, useState } from 'react'

/**
 * Fullscreen surfaces are implemented with CSS, not the DOM Fullscreen API.
 *
 * The APK renders inside an Android WebView, and Capacitor's WebChromeClient
 * refuses every fullscreen request: `onShowCustomView` calls
 * `callback.onCustomViewHidden()` immediately instead of entering fullscreen.
 * So `requestFullscreen()` silently did nothing in the APK and the documented
 * fullscreen mode was dead there. A fixed-position overlay looks the same in the
 * browser and in the WebView, so both now share one code path.
 */

let exitActiveFullscreen: (() => void) | null = null

/**
 * Leaves the fullscreen surface, if one is open.
 * Used by the Android hardware back handler, which must close fullscreen before
 * it switches tabs or leaves the app.
 */
export function exitFullscreenIfActive(): boolean {
  if (!exitActiveFullscreen) return false
  exitActiveFullscreen()
  return true
}

export function useCssFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = useCallback(() => setIsFullscreen((current) => !current), [])

  useEffect(() => {
    if (!isFullscreen) return undefined

    const exit = () => setIsFullscreen(false)
    exitActiveFullscreen = exit
    document.body.classList.add('has-fullscreen')

    return () => {
      if (exitActiveFullscreen === exit) exitActiveFullscreen = null
      document.body.classList.remove('has-fullscreen')
    }
  }, [isFullscreen])

  return { isFullscreen, toggleFullscreen }
}
