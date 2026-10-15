import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/**
 * How a file left the app.
 * - `downloaded`: browser handed the file to the download manager.
 * - `shared`: Android wrote the file and opened the system share sheet, so the
 *   user decides where it lands (Files, mail, cloud drive...).
 * - `cancelled`: the file was written, and the user dismissed the share sheet.
 */
export type SaveOutcome = 'downloaded' | 'shared' | 'cancelled'

export interface SaveTextFileOptions {
  fileName: string
  mimeType: string
  contents: string
  title: string
}

function downloadInBrowser({ fileName, mimeType, contents }: SaveTextFileOptions) {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Saves a text file from the app.
 *
 * Android WebView ignores the anchor `download` attribute for `blob:` URLs, so
 * the browser path silently does nothing inside the APK. On a native platform we
 * therefore write the file to the app cache and hand it to the system share
 * sheet instead. The cache directory needs no storage permission, unlike the
 * public Documents folder.
 */
export async function saveTextFile(options: SaveTextFileOptions): Promise<SaveOutcome> {
  if (!Capacitor.isNativePlatform()) {
    downloadInBrowser(options)
    return 'downloaded'
  }

  const result = await Filesystem.writeFile({
    path: options.fileName,
    data: options.contents,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  })

  try {
    await Share.share({
      title: options.title,
      dialogTitle: options.title,
      url: result.uri,
    })
  } catch (error) {
    // Android's chooser reports a rejected promise when the user dismisses it.
    // Keep real write/share failures visible to the caller.
    if (error instanceof Error && /^Share cancel(?:ed|led)$/i.test(error.message)) return 'cancelled'
    throw error
  }

  return 'shared'
}
