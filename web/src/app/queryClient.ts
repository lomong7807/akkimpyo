import { QueryClient } from '@tanstack/react-query'

// 다시 시도는 사용자가 누른다. 브라우저의 연결 신호를 보고 요청을 미뤄 두었다가 저절로 보내지도 않는다.
const requestOnce = { retry: false, networkMode: 'always' } as const

/** 서버에서 온 데이터의 캐시 */
export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: requestOnce, mutations: requestOnce } })
}
