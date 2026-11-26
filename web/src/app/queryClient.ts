import { onlineManager, QueryCache, QueryClient, type QueryKey, type QueryMeta } from '@tanstack/react-query'
import { ApiError } from '../api/apiError'
import { connection, onConnectionChange } from '../api/connection'

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
    // networkMode 'always'이면 TanStack이 refetchOnReconnect를 끄므로 조회에만 다시 켠다. 연결이 돌아오면 보이는 화면의 오래됐거나
    // 실패한 조회를 다시 받는다(F-908, refetchOnReconnect 함수 참고). 동작(mutation)은 다시 하지 않는다
    defaultOptions: { queries: { ...requestOnce, refetchOnReconnect: true }, mutations: requestOnce },
  })
}

function goneLedgerOf(error: unknown, queryKey: QueryKey, meta: QueryMeta | undefined): string | undefined {
  const [scope, ledgerId] = queryKey
  if (scope !== 'ledgers' || typeof ledgerId !== 'string' || !(error instanceof ApiError)) return undefined
  if (error.status === 403 && error.code === 'NO_LONGER_MEMBER') return ledgerId
  if (error.status === 404 && meta?.ledgerList === true) return ledgerId
  return undefined
}

/**
 * 연결이 돌아오면(api/connection의 판단) 보이는 화면의 조회를 다시 받는다(F-908, 00-common 4.3, architect #235 G). 브라우저 신호만이
 * 아니라 확인 요청이나 X-Request-Id 응답으로 돌아온 연결에도 다시 받는다. 실패한 동작(mutation)은 저절로 다시 하지 않는다(retry false).
 * 앱이 열려 있는 동안 한 번 부른다. 돌려받은 함수로 멈춘다.
 */
export function refetchOnReconnect(): () => void {
  onlineManager.setEventListener((setOnline) => {
    setOnline(connection() === 'online')
    return onConnectionChange((next) => setOnline(next === 'online'))
  })
  return () => onlineManager.setEventListener(() => undefined)
}
