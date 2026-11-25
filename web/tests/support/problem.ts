import { HttpResponse } from 'msw'

/** ADR 002 4절의 오류 응답 */
export function problem(status: number, code: string, extension: object = {}) {
  return new HttpResponse(
    JSON.stringify({
      type: 'about:blank',
      title: '상태 문구',
      status,
      detail: '개발자가 읽는 한 줄',
      code,
      requestId: 'req-example-1',
      ...extension,
    }),
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  )
}
