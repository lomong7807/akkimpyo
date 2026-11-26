import { QueryCache, QueryClient, type QueryKey, type QueryMeta } from '@tanstack/react-query'
import { ApiError } from '../api/apiError'

// 다시 시도는 사용자가 누른다. 브라우저의 연결 신호를 보고 요청을 미뤄 두었다가 저절로 보내지도 않는다.
const requestOnce = { retry: false, networkMode: 'always' } as const

interface QueryClientOptions {
  /**
   * 장부를 볼 수 없게 됐다(#234). 장부 경로 목록 조회(meta.ledgerList)의 404, 장부 경로 조회의 403 NO_LONGER_MEMBER다
   * (security Q4). 그 장부의 기기 사본을 지우는 데 쓴다.
   */
  onLedgerGone?: (ledgerId: string) => void
}

/** 서버에서 온 데이터의 캐시 */
export function createQueryClient({ onLedgerGone }: QueryClientOptions = {}): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError(error, query) {
        const ledgerId = onLedgerGone && goneLedgerOf(error, query.queryKey, query.meta)
        if (ledgerId) onLedgerGone(ledgerId)
      },
    }),
    defaultOptions: { queries: requestOnce, mutations: requestOnce },
  })
}

function goneLedgerOf(error: unknown, queryKey: QueryKey, meta: QueryMeta | undefined): string | undefined {
  const [scope, ledgerId] = queryKey
  if (scope !== 'ledgers' || typeof ledgerId !== 'string' || !(error instanceof ApiError)) return undefined
  if (error.status === 403 && error.code === 'NO_LONGER_MEMBER') return ledgerId
  if (error.status === 404 && meta?.ledgerList === true) return ledgerId
  return undefined
}
