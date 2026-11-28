import { afterEach, vi } from 'vitest'

/*
 * 받은 파일을 기기에 저장하는 길(객체 URL과 임시 a[download])을 지켜본다. jsdom에는 URL.createObjectURL이 없고, a를 누르면
 * 주소를 옮기려 하므로(구현 없음) 누르기를 가로채 무엇을 저장하려 했는지만 남긴다.
 */

export interface SavedFile {
  /** a의 download(저장할 이름) */
  name: string
  href: string
  file: Blob | undefined
  /** 누를 때 문서 안에 있었다 */
  connected: boolean
  /** 누를 때 이미 해제된 URL이었다 */
  revokedBeforeClick: boolean
}

let installed = false

afterEach(() => {
  if (!installed) return
  installed = false
  delete (URL as { createObjectURL?: unknown }).createObjectURL
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL
})

/** 저장을 지켜보기 시작한다. 테스트가 끝나면 되돌린다(누르기 가로채기는 vi.restoreAllMocks가 푼다). */
export function watchDownloads() {
  installed = true
  const files = new Map<string, Blob>()
  const live = new Set<string>()
  const saved: SavedFile[] = []
  /** 일어난 일의 차례 */
  const steps: string[] = []
  let made = 0

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (file: Blob) => {
      made += 1
      const url = `blob:${window.location.origin}/file-${made}`
      files.set(url, file)
      live.add(url)
      steps.push(`만듦 ${url}`)
      return url
    },
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: (url: string) => {
      live.delete(url)
      steps.push(`해제 ${url}`)
    },
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({
      name: this.download,
      href: this.href,
      file: files.get(this.href),
      connected: this.isConnected,
      revokedBeforeClick: !live.has(this.href),
    })
    steps.push(`누름 ${this.href}`)
  })

  return {
    saved,
    steps,
    /** 아직 해제하지 않은 객체 URL */
    live: () => [...live],
  }
}
