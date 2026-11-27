import { useQueryClient, type Query, type QueryCache, type QueryKey } from '@tanstack/react-query'
import { now } from '../../lib/clock'

/*
 * 조회마다 서버에서 마지막으로 받은 시각(lib/clock의 밀리초). 연결이 없거나 다시 받지 못했을 때 보던 내용에 붙이는
 * "{시각} 기준"(F-908, N-03 (5))이 쓴다. TanStack의 dataUpdatedAt은 Date.now()라 기기 시계(lib/clock)와 어긋나 쓰지 않는다
 * (architect #238). 받아서 바뀐 것만 적고, 화면이 캐시를 직접 고친 것(setQueryData)은 받은 시각이 아니라 적지 않는다(architect #238 C).
 */

const received = new WeakMap<Query, number>()

/** 그 캐시가 서버에서 받을 때마다 받은 시각을 적는다. 캐시를 만들 때 한 번 부른다(app/queryClient). */
export function recordReceivedAt(cache: QueryCache): void {
  cache.subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success' && !event.action.manual) received.set(event.query, now())
  })
}

/** 그 조회의 값을 서버에서 받은 시각. 받은 적이 없거나 캐시를 직접 고친 값뿐이면 없다. 그 조회를 보는 화면에서 부른다. */
export function useReceivedAt(queryKey: QueryKey): number | undefined {
  const query = useQueryClient().getQueryCache().find({ queryKey, exact: true })
  return query && received.get(query)
}
