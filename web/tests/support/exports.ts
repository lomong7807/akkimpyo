import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import { ledgerNameOf, type Backend } from './backend'
import { problem } from './problem'

type Respond = () => Response | Promise<Response>

export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export interface SeenExport {
  /** 토큰의 사용자. 없거나 만료됐으면 없다 */
  user: string | undefined
  authorization: string | null
  ledgerId: string
  /** 쿼리 그대로(format, from, to). 보내지 않은 이름은 없다 */
  query: Record<string, string>
}

/** 서버(#57)와 같은 Content-Disposition. filename*은 UTF-8 퍼센트 인코딩, filename은 ASCII 밖의 글자를 `_`로 바꾼 이름이다. */
export function attachment(name: string): string {
  const ascii = [...name].map((char) => (/^[\x20-\x7e]$/.test(char) ? char : '_')).join('')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** 내보낸 파일 응답 */
export function exportFile(body: string, { type = XLSX, disposition }: { type?: string; disposition?: string } = {}) {
  const headers = new Headers({ 'Content-Type': type, 'Cache-Control': 'no-store' })
  if (disposition !== undefined) headers.set('Content-Disposition', disposition)
  return new HttpResponse(body, { status: 200, headers })
}

/** 가짜 장부의 첫 거래일과 마지막 거래일. 기간을 비운 요청(장부 전체)의 파일 이름에 쓴다(PR #388) */
export const LEDGER_SPAN = { first: '2024-03-15', last: '2026-11-20' }

/**
 * 내보내기(GET /ledgers/{id}/exports, #57)가 되는 가짜 서버. 기본은 거래가 있는 장부라 엑셀 파일과 서버가 짓는 이름을 준다.
 * 토큰이 없거나 만료됐으면 401이다.
 */
export function startExports(server: SetupServer, backend: Backend) {
  const exports = {
    requests: [] as SeenExport[],
    /** 정해 두면 그 응답을 준다. 없으면 받은 기간(비웠으면 LEDGER_SPAN)으로 이름을 지은 엑셀·CSV 파일이다 */
    response: undefined as Respond | undefined,
  }
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/exports', ({ request, params }) => {
      const user = backend.userOf(request)
      const url = new URL(request.url)
      exports.requests.push({
        user,
        authorization: request.headers.get('Authorization'),
        ledgerId: String(params.ledgerId),
        query: Object.fromEntries(url.searchParams),
      })
      if (!user) return problem(401, 'UNAUTHENTICATED')
      if (exports.response) return exports.response()
      const format = url.searchParams.get('format') ?? 'xlsx'
      const from = url.searchParams.get('from') ?? ''
      const to = url.searchParams.get('to') ?? ''
      // 하나만 비우면(빠지거나 빈 값) 비운 쪽의 REQUIRED, 둘 다 비우면 장부 전체다(PR #388)
      if ((from === '') !== (to === '')) {
        const field = from === '' ? 'from' : 'to'
        return problem(400, 'VALIDATION_FAILED', { fieldErrors: [{ field, code: 'REQUIRED', message: '개발자가 읽는 글' }] })
      }
      const [first, last] = from === '' ? [LEDGER_SPAN.first, LEDGER_SPAN.last] : [from, to]
      const day = (date: string) => date.replaceAll('-', '')
      const name = `${ledgerNameOf(user)}_${day(first)}_${day(last)}.${format}`
      return exportFile(`${format} 파일`, {
        type: format === 'csv' ? 'text/csv;charset=UTF-8' : XLSX,
        disposition: attachment(name),
      })
    }),
  )
  return exports
}

/** 거래가 없는 기간(204, 본문 없음) */
export function noTransactions() {
  return new HttpResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
