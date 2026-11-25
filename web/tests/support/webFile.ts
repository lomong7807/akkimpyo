import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const webRoot = resolve(import.meta.dirname, '../..')

/** `web/`를 기준으로 한 경로를 절대 경로로 바꾼다. */
export function webPath(path: string): string {
  return resolve(webRoot, path)
}

export function readWebFile(path: string): string {
  return readFileSync(webPath(path), 'utf8')
}
