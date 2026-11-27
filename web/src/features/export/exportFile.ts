import { ApiError } from '../../api/apiError'
import { requestFile } from '../../api/fileRequest'
import { currentUserId } from '../../api/session'
import type { Ledger } from '../me/me'
import { ledgerPath } from '../me/ledgerPath'
import type { ExportRange } from './exportRange'

/* 장부 거래를 파일로 받아 기기에 저장한다(F-701, P-228). 파일은 서버가 만든다(#57). */

export type ExportFormat = 'xlsx' | 'csv'

export interface ExportRequest extends ExportRange {
  format: ExportFormat
}

/** saved: 파일을 저장하게 했다. empty: 그 기간에 내보낼 거래가 없어 파일이 없다(204) */
export type ExportResult = { kind: 'saved'; fileName: string } | { kind: 'empty' }

/**
 * 장부의 거래를 받아 저장한다. 토큰이 Authorization 헤더로 가야 하므로 주소로 바로 내려받지 않고 받은 파일을 저장한다.
 * 이름은 서버가 정한 것(Content-Disposition의 filename*)이고, 없거나 읽을 수 없으면 같은 규칙으로 짓는다.
 * `startedBy`는 누른 사용자다. 보내기 직전의 토큰이 다른 사용자의 것이면 보내지 않는다.
 */
export async function exportLedger(
  ledger: Pick<Ledger, 'id' | 'name'>,
  { format, from, to }: ExportRequest,
  startedBy: string | undefined,
): Promise<ExportResult> {
  const query = new URLSearchParams({ format, from, to })
  const { status, file, disposition } = await requestFile(`${ledgerPath(ledger.id, 'exports')}?${query}`, {}, { startedBy })
  if (status === 204) return { kind: 'empty' }
  if (status !== 200 || file === undefined) throw ApiError.unreadable(status)
  // 받는 사이 로그아웃하거나 다른 계정으로 바뀌었으면 앞 사용자의 장부 파일을 이 기기에 남기지 않는다(api/apiError의 timeout)
  if (currentUserId() !== startedBy) throw ApiError.timeout()
  const fileName = fileNameOf(disposition) ?? defaultFileName(ledger.name, { format, from, to })
  saveFile(file, fileName)
  return { kind: 'saved', fileName }
}

/** 파일 이름에 쓸 수 없는 글자(Windows 기준, 서버 ExportFileName과 같다)와 제어 글자 */
const UNUSABLE = /[/\\:*?"<>|\p{Cc}]/gu

function usable(name: string): string {
  return name.replace(UNUSABLE, '_')
}

/** "장부 이름_시작일_종료일.확장자", 날짜는 `20260101` 꼴(K-01 (5), 작성자 판단 29) */
export function defaultFileName(ledgerName: string, { format, from, to }: ExportRequest): string {
  const day = (date: string) => date.replaceAll('-', '')
  return `${usable(ledgerName)}_${day(from)}_${day(to)}.${format}`
}

/**
 * Content-Disposition의 filename*(RFC 8187, RFC 5987의 후속)을 푼 이름. UTF-8만 읽는다. 없거나 읽을 수 없으면 없다.
 * 서버가 이미 바꿨어도 경로와 쓸 수 없는 글자는 한 번 더 `_`로 바꾼다. ASCII로 바꾼 filename은 쓰지 않는다(한글이 `_`가 된다).
 */
export function fileNameOf(disposition: string | null): string | undefined {
  const value = disposition && /(?:^|;)\s*filename\*\s*=\s*("?)([^";]*)\1\s*(?:;|$)/i.exec(disposition)?.[2]
  const parts = value && /^([^']*)'[^']*'(.+)$/.exec(value.trim())
  if (!parts || parts[1].toUpperCase() !== 'UTF-8') return undefined
  try {
    const name = usable(decodeURIComponent(parts[2])).trim()
    return name === '' ? undefined : name
  } catch {
    return undefined
  }
}

/**
 * 객체 URL을 해제하기까지의 시간. iPhone Safari는 내려받을지 물은 뒤에 주소를 읽으므로 누르게 한 바로 뒤에 해제하면 파일을 받지
 * 못할 수 있다(architect #240). 주소는 이 문서 안에서만 풀리고 그동안 다른 곳에서 읽을 수 없다.
 */
export const RELEASE_URL_AFTER_MS = 60_000

/** 받은 파일을 이름을 붙여 기기에 저장하게 한다. 임시 링크는 바로 빼고, 객체 URL은 1분 뒤에 해제한다. */
export function saveFile(file: Blob, name: string): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.hidden = true
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), RELEASE_URL_AFTER_MS)
  }
}
