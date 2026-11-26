import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import type { Backend } from './backend'
import { problem } from './problem'

type Kind = 'EXPENSE' | 'INCOME'

/** 서버가 주는 최상위 카테고리 하나(#34의 응답 계약) */
export function categoryOf(kind: Kind, name: string, system = false) {
  return { id: `${kind}-${name}`, kind, name, system, children: [] }
}

/** 가입할 때 서버가 넣는 기본 카테고리(P-223). 서버가 주는 순서다. */
export const defaultExpenses = [
  '식비',
  '카페·간식',
  '교통',
  '주거·통신',
  '생활용품',
  '의료·건강',
  '문화·여가',
  '쇼핑',
  '경조사·선물',
  '교육',
  '기타',
  '미분류',
]
export const defaultIncomes = ['급여', '부수입', '용돈', '기타', '미분류']

const itemsOf = (kind: Kind, names: string[]) => names.map((name) => categoryOf(kind, name, name === '미분류'))

export const defaultCategories = [...itemsOf('EXPENSE', defaultExpenses), ...itemsOf('INCOME', defaultIncomes)]

/** 카테고리 목록이 되는 가짜 서버. 가입할 때 넣은 기본 카테고리에서 시작한다. */
export function startCategories(server: SetupServer, backend: Backend) {
  const categories = {
    items: defaultCategories as object[],
    /** 정해 두면 그 응답을 준다. */
    response: undefined as (() => Response | Promise<Response>) | undefined,
    /** 요청받은 장부 id */
    requests: [] as string[],
  }
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/categories', ({ request, params }) => {
      categories.requests.push(String(params.ledgerId))
      if (!backend.userOf(request)) return problem(401, 'UNAUTHENTICATED')
      return categories.response ? categories.response() : HttpResponse.json({ items: categories.items })
    }),
  )
  return categories
}

export type Categories = ReturnType<typeof startCategories>
