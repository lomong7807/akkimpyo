import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import type { Backend } from './backend'
import { problem } from './problem'

type Kind = 'EXPENSE' | 'INCOME'

/** 서버가 주는 최상위 카테고리 하나(#34의 응답 계약) */
export function categoryOf(kind: Kind, name: string, system = false) {
  return { id: `${kind}-${name}`, kind, name, system, children: [] }
}

/** id와 하위 카테고리를 정해 둔 최상위 카테고리 하나 */
export function categoryWithChildren(
  id: string,
  kind: Kind,
  name: string,
  children: [id: string, name: string][] = [],
  system = false,
) {
  return { id, kind, name, system, children: children.map(([childId, childName]) => ({ id: childId, name: childName })) }
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

/** 가맹점을 서버처럼 맞춘다(공백류를 모두 빼고 대소문자를 무시한다, P-219) */
export const payeeKeyOf = (payee: string) => payee.replace(/\s/g, '').toLowerCase()

/**
 * 가맹점별 최근 카테고리 제안이 되는 가짜 서버(#61의 응답 계약, `{ categoryId }`). `byPayee`는 맞춘 가맹점(payeeKeyOf)마다 줄
 * 카테고리 id이고, 없으면 제안이 없다(null). 받은 가맹점은 보낸 그대로 `requests`에 남는다.
 */
export function startCategorySuggestions(server: SetupServer, backend: Backend) {
  const suggestions = {
    byPayee: new Map<string, string>(),
    /** 정해 두면 그 응답을 준다. */
    response: undefined as ((payee: string) => Response | Promise<Response>) | undefined,
    requests: [] as string[],
  }
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/category-suggestions', ({ request }) => {
      if (!backend.userOf(request)) return problem(401, 'UNAUTHENTICATED')
      const payee = new URL(request.url).searchParams.get('payee') ?? ''
      suggestions.requests.push(payee)
      if (suggestions.response) return suggestions.response(payee)
      return HttpResponse.json({ categoryId: suggestions.byPayee.get(payeeKeyOf(payee)) ?? null })
    }),
  )
  return suggestions
}

export type CategorySuggestions = ReturnType<typeof startCategorySuggestions>
