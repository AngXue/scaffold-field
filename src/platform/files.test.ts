import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ writeFile: vi.fn(), share: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: native.writeFile }, Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' } }))
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }))
import { saveTextFile } from './files'

const options = { fileName: '材料清单.csv', mimeType: 'text/csv', contents: '规格,数量\n4.5m,1', title: '导出材料清单' }

describe('native file export', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    native.writeFile.mockResolvedValue({ uri: 'file:///cache/materials.csv' })
    native.share.mockResolvedValue({})
  })

  it('writes the CSV before opening the Android share sheet', async () => {
    await expect(saveTextFile(options)).resolves.toBe('shared')
    expect(native.writeFile).toHaveBeenCalledWith({ path: options.fileName, data: options.contents, directory: 'CACHE', encoding: 'utf8' })
    expect(native.share).toHaveBeenCalledWith({ title: options.title, dialogTitle: options.title, url: 'file:///cache/materials.csv' })
  })

  it('treats a dismissed Android share sheet as a normal cancellation', async () => {
    native.share.mockRejectedValue(new Error('Share canceled'))
    await expect(saveTextFile(options)).resolves.toBe('cancelled')
  })

  it('still reports a real share failure', async () => {
    native.share.mockRejectedValue(new Error('No Activity found to handle Intent'))
    await expect(saveTextFile(options)).rejects.toThrow('No Activity found')
  })

  it('still reports a write failure without opening a share sheet', async () => {
    native.writeFile.mockRejectedValue(new Error('No space left on device'))
    await expect(saveTextFile(options)).rejects.toThrow('No space left')
    expect(native.share).not.toHaveBeenCalled()
  })
})
