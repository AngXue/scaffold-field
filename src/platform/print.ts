import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * Local Capacitor plugin implemented in the Android project
 * (`android/app/src/main/java/com/scaffoldfield/app/NativePrintPlugin.java`).
 * It routes the WebView through Android's print framework.
 */
interface NativePrintPlugin {
  print(options: { jobName: string }): Promise<void>
}

const NativePrint = registerPlugin<NativePrintPlugin>('NativePrint')

/**
 * Opens the print flow for the current view.
 *
 * `window.print()` is a no-op inside an Android WebView, so the print button
 * would silently do nothing in the APK. On a native platform we call the local
 * Android plugin, which hands the WebView to the system print service (where the
 * user can also choose "Save as PDF"). The existing `@media print` rules in
 * `src/index.css` still decide what ends up on the page.
 */
export async function printDocument(jobName: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await NativePrint.print({ jobName })
    return
  }

  window.print()
}
