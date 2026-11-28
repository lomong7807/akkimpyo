import { useLayoutEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/apiError'
import { connection } from '../../api/connection'
import { request } from '../../api/request'
import { hasUnusableCharacter } from '../../lib/visibleText'
import { isUuid } from '../../lib/uuid'
import type { Category } from '../categories/categories'
import { isConnectionLost } from '../connection/offlineAction'
import { ledgerPath } from '../me/ledgerPath'
import { categoryKindOf, isUncategorized } from './formDefaults'
import { byLatestSaved, keptTransactions, payeeKeyOf, type KeptOwner } from './keptTransactions'
import { normalizePayee, PAYEE_MAX, payeeLength } from './transactionForm'
import type { ListedIncomeOrExpense, ListedTransaction } from './transactions'
import type { TransactionForm } from './useTransactionForm'

/*
 * 가맹점별 최근 카테고리 제안(P-219, P-502, #233). 새 지출의 가맹점/내용으로 같은 장부에서 같은 가맹점에 가장 최근에 저장된 지출의
 * 카테고리를 채운다. 같은 가맹점(공백과 대소문자 무시)과 "가장 최근"은 서버가 정한다(#61). 경로와 필드 이름은 이 파일에만 있다.
 * 연결이 없으면 기기의 최근 31일 사본(#238)에서만 같은 규칙으로 찾는다(D-05 해석 규칙 5, D-04 (4), #348).
 * 거래 입력(D-04 (4))의 새 입력과 한 줄 입력 결과 확인(D-05 (5), (6))이 쓴다.
 */

/** 제안한 카테고리 칸 아래의 도움말(D-04 (4), D-05 (6)) */
export const SUGGESTED_HELP = '지난번 같은 가맹점에 쓴 카테고리예요'

/** 제안할 카테고리 id(#61의 `{ categoryId }`). 없으면 null이다. 실패하면 ApiError를 던진다. */
export async function fetchCategorySuggestion(
  ledgerId: string,
  payee: string,
  startedBy: string | undefined,
): Promise<string | null> {
  const query = new URLSearchParams({ payee })
  const body = await request<unknown>(`${ledgerPath(ledgerId, 'category-suggestions')}?${query}`, {}, { startedBy })
  const categoryId = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).categoryId : undefined
  if (categoryId === null) return null
  if (!isUuid(categoryId)) throw ApiError.unreadable()
  return categoryId
}

/**
 * 기기 사본(최근 31일)에서 서버(#61)와 같은 조건으로 고른 카테고리 id: 같은 가맹점의 지출(휴지통 제외, 취소 포함) 가운데 저장 시각
 * (createdAt, 목록 응답 #15에 있다)이 가장 늦은 것, 같으면 id가 큰 것. 없으면 null이다. 보내지 않은 입력(#234)은 보지 않는다
 * (planner #348). 사본은 받은 때의 것이라 서버와 다른 줄을 고를 수 있다(제안일 뿐이고 바꿀 수 있어 받아들임). 읽지 못하면 던진다.
 */
export async function keptCategorySuggestion(owner: KeptOwner, payee: string): Promise<string | null> {
  const wanted = payeeKeyOf(payee)
  const sameExpense = (item: ListedTransaction): item is ListedIncomeOrExpense =>
    item.type === 'EXPENSE' && item.deletedAt === null && item.payee !== null && payeeKeyOf(item.payee) === wanted
  const [latest] = (await keptTransactions(owner)).filter(sameExpense).sort(byLatestSaved)
  return latest?.categoryId ?? null
}

/** 칸의 제안 상태. 거래 입력(D-04)을 "자세히"로 열 때 넘긴다 */
export interface SuggestionState {
  /** 지금 카테고리 칸의 값이 제안한 것이면 그 id */
  suggested?: string
  /** 사용자가 카테고리를 직접 골랐다. 그 뒤로는 가맹점을 바꿔도 덮어쓰지 않는다(P-502) */
  picked: boolean
}

interface SuggestionOptions {
  form: TransactionForm
  owner: { userId: string | undefined; ledgerId: string }
  /** 서버가 미분류 카테고리를 주면 제안이 없는 것과 같다(칸에서 미분류는 빈 값이다) */
  categories: Category[] | undefined
  /** 보내는 중이다. 보낸 값을 바꾸지 않는다 */
  frozen: boolean
  initial?: SuggestionState
}

export type CategorySuggestion = ReturnType<typeof useCategorySuggestion>

/**
 * 새 지출의 카테고리 제안. `suggest`는 가맹점/내용을 벗어날 때(D-05는 열 때도) 부르고, `pick`은 카테고리를 직접 고를 때 부른다.
 * 답이 오면 그사이 가맹점이 그대로이고 지출이며 직접 고르지 않았을 때만 채운다. 마지막으로 물은 것의 답만 쓴다.
 * 연결이 없거나 묻는 중에 끊기면 그 사용자의 기기 사본에서 찾는다. 사본이 오래되어 지금 카테고리 목록에 없는 카테고리는 제안하지
 * 않는다. 제안이 없거나 받지 못하면(서버 오류, 사본을 읽을 수 없음) 카테고리를 비워 미분류로 두고 앞서 채운 제안도 지운다
 * (D-04 (4)). 문구는 없다.
 */
export function useCategorySuggestion({ form, owner, categories, frozen, initial }: SuggestionOptions) {
  const [state, setState] = useState<SuggestionState>(() => initial ?? { picked: false })
  // 답은 그때의 칸 값으로 채운다(change는 그린 때의 값에 더한다)
  const latest = useRef({ form, categories, frozen, state })
  useLayoutEffect(() => {
    latest.current = { form, categories, frozen, state }
  })
  const asked = useRef(0)

  function settle(turn: number, payee: string, categoryId: string | null) {
    const now = latest.current
    if (turn !== asked.current || now.frozen || now.state.picked) return
    const { values, change } = now.form
    if (values.type !== 'EXPENSE' || normalizePayee(values.payee) !== payee) return
    const uncategorized = categoryId === null || (now.categories !== undefined && isUncategorized(now.categories, categoryId))
    const next = uncategorized ? '' : categoryId
    if (values.categoryId !== next) change({ categoryId: next })
    setState({ picked: false, suggested: next === '' ? undefined : next })
  }

  /** 가맹점/내용 `payee`로 제안한다. 지출이 아니거나 직접 골랐으면 하지 않는다 */
  function suggest(payee: string) {
    const { form: now, state: current } = latest.current
    if (current.picked || now.values.type !== 'EXPENSE') return
    asked.current += 1
    const turn = asked.current
    const normalized = normalizePayee(payee)
    // 서버가 거절할 가맹점(P-214)과 빈 가맹점은 묻지 않는다
    const askable = normalized !== '' && !hasUnusableCharacter(payee) && payeeLength(payee) <= PAYEE_MAX
    if (!askable) {
      settle(turn, normalized, null)
      return
    }
    const answer =
      connection() === 'offline'
        ? kept(normalized)
        : fetchCategorySuggestion(owner.ledgerId, normalized, owner.userId).catch((error: unknown) =>
            isConnectionLost(error) ? kept(normalized) : null,
          )
    void answer.then((categoryId) => settle(turn, normalized, categoryId))
  }

  /** 기기 사본에서 찾는다. 실패로 끝나지 않는다 */
  function kept(payee: string): Promise<string | null> {
    return keptCategorySuggestion(owner, payee).then(
      (categoryId) => {
        const { categories: now } = latest.current
        const known = categoryId !== null && (now === undefined || categoryKindOf(now, categoryId) !== undefined)
        return known ? categoryId : null
      },
      () => null,
    )
  }

  /** 카테고리를 직접 골랐다 */
  function pick() {
    asked.current += 1
    setState((current) => ({ ...current, picked: true }))
  }

  const { type, categoryId } = form.values
  const help = type === 'EXPENSE' && state.suggested !== undefined && categoryId === state.suggested ? SUGGESTED_HELP : undefined
  return { help, state, suggest, pick }
}
