import { useEffect, useRef } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

/**
 * Handles Android's hardware/gesture back button.
 *
 * The back button belongs to the WebView host, not the page, so without a
 * listener Android closes the app from wherever the user happens to be. The
 * handler receives a callback that decides what "back" means for the current
 * screen and returns whether it consumed the press.
 */
export function useAndroidBackButton(onBack: () => boolean) {
  const onBackRef = useRef(onBack)

  // Keep the latest handler without re-subscribing the native listener on every render.
  useEffect(() => {
    onBackRef.current = onBack
  }, [onBack])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined

    let cancelled = false
    let removeListener: (() => void) | undefined

    void CapacitorApp.addListener('backButton', () => {
      if (!onBackRef.current()) void CapacitorApp.exitApp()
    }).then((handle) => {
      if (cancelled) void handle.remove()
      else removeListener = () => void handle.remove()
    })

    return () => {
      cancelled = true
      removeListener?.()
    }
  }, [])
}
