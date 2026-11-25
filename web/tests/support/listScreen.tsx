import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import { useState } from 'react'
import type { RouteObject } from 'react-router'
import type { Backend } from './backend'
import { problem } from './problem'

export const itemOf = (user: string) => `${user}의 거래`
export const listOf = (user: string) => HttpResponse.json({ items: [itemOf(user)] })

/** 사용자마다 다른 목록을 주는 가짜 자원 /api/v1/list */
export function startList(server: SetupServer, backend: Backend) {
  const list = {
    /** 다음 응답. 없으면 토큰의 사용자 것을 바로 준다. */
    response: undefined as ((user: string) => Response | Promise<Response>) | undefined,
    /** 받은 요청을 보낸 사용자. 토큰이 없거나 만료됐으면 '만료'다. */
    requests: [] as string[],
    /** 화면이 쓴 캐시 */
    caches: [] as QueryClient[],
  }
  server.use(
    http.all('/api/v1/list', ({ request }) => {
      const user = backend.userOf(request)
      list.requests.push(user ?? '만료')
      if (!user) return problem(401, 'UNAUTHENTICATED')
      return list.response ? list.response(user) : listOf(user)
    }),
  )
  return list
}

export type List = ReturnType<typeof startList>

/** 목록을 받아 보이고, 저장하면 응답을 캐시에 넣는 화면(/list). 앱의 화면이 쓰는 방식이다. */
export async function listScreen(list: List): Promise<RouteObject> {
  const { request } = await import('../../src/api/request')
  type Body = { items: string[] }

  function ListScreen() {
    const queryClient = useQueryClient()
    const [typed, setTyped] = useState('')
    const query = useQuery({ queryKey: ['list'], queryFn: () => request<Body>('/list') })
    const save = useMutation({
      mutationFn: () => request<Body>('/list', { method: 'POST' }),
      onSuccess: (saved) => queryClient.setQueryData(['list'], saved),
    })
    if (!list.caches.includes(queryClient)) list.caches.push(queryClient)
    return (
      <main>
        <p>{query.data?.items.join()}</p>
        {query.isError && <p>목록을 받지 못함</p>}
        <input aria-label="메모" value={typed} onChange={(event) => setTyped(event.target.value)} />
        <button type="button" onClick={() => void query.refetch()}>
          새로 받기
        </button>
        <button type="button" onClick={() => save.mutate()}>
          저장
        </button>
      </main>
    )
  }
  return { path: '/list', element: <ListScreen /> }
}
