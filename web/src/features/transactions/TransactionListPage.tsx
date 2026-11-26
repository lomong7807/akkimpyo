import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import Amount from '../../components/Amount'
import { ButtonLink } from '../../components/Button'
import EmptyState from '../../components/EmptyState'
import { holdKeyboard } from '../../components/keyboardBridge'
import LoadFailure from '../../components/LoadFailure'
import MonthNavigation from '../../components/MonthNavigation'
import RetryMessage from '../../components/RetryMessage'
import { MainScreen } from '../../components/Screen'
import Skeleton from '../../components/Skeleton'
import { formatMonth, isMonth, monthOf, moveMonth, selectableMonths, today } from '../../lib/calendarDate'
import { useAccounts } from '../accounts/useAccounts'
import { useCategories } from '../categories/useCategories'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { canEdit } from '../me/me'
import { DayGroup } from './DayGroup'
import { groupByDate } from './groupByDate'
import { nameBookOf, type NameBook } from './listedText'
import { useListMemory } from './listMemory'
import TransactionListSkeleton, { RowsSkeleton } from './TransactionListSkeleton'
import type { IncomeAndExpense, TransactionPage } from './transactions'
import { useTransactionList } from './useTransactionList'
import styles from './TransactionList.module.css'

/** 저장한 줄을 강조하는 시간 */
const HIGHLIGHT_MS = 1000

/** 목록 끝이 화면 아래로 한 화면 높이 안에 들어오면 다음 쪽을 요청한다(00-common 5.10). */
const NEAR_END = '0px 0px 100% 0px'

/**
 * D-01 내역(1A). 주소의 달(`?month=YYYY-MM`)을 보인다. 달이 없거나 고를 수 없는 달이면 기억한 달이나 기기의 오늘이 속한
 * 달로 바꿔 간다. 1A에는 필터 줄, 달력·검색 버튼, 넓은 화면의 상세 칸이 없다.
 */
export default function TransactionListPage() {
  const memory = useListMemory()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // 화면을 연 날의 오늘. 범위와 달 이름(올해인지)을 정한다
  const [openedOn] = useState(today)
  const range = selectableMonths(openedOn)
  const requested = searchParams.get('month')
  const month = requested !== null && isSelectable(requested, range) ? requested : undefined

  // 저장 뒤 돌아왔으면 그 거래를 한 번 강조한다. 돌아간 첫 화면이 그려진 뒤에는 잊으므로 처음 그릴 때 읽어 둔다.
  // 다른 달의 거래면 이 달 목록에 그 줄이 없어 강조 없이 끝난다(토스트만 남는다)
  const [highlight, setHighlight] = useState(memory.saved)
  const endHighlight = useCallback(() => setHighlight(undefined), [])

  useEffect(() => {
    if (month) memory.rememberMonth(month)
  }, [month, memory])

  if (!month) {
    const remembered = memory.month()
    const fallback = remembered && isSelectable(remembered, range) ? remembered : monthOf(openedOn)
    return <Navigate to={addressOf(fallback)} replace />
  }

  function move(months: -1 | 1) {
    void navigate(addressOf(moveMonth(month!, months)), { replace: true })
  }

  return (
    <MainScreen>
      <div className={styles.history}>
        <div className={styles.monthNavigation}>
          <MonthNavigation
            month={month}
            label={formatMonth(month, openedOn)}
            first={range.first}
            last={range.last}
            onMove={move}
          />
        </div>
        <MonthTransactions
          key={month}
          month={month}
          today={openedOn}
          highlight={highlight}
          onHighlightEnd={endHighlight}
        />
      </div>
    </MainScreen>
  )
}

function isSelectable(month: string, { first, last }: { first: string; last: string }): boolean {
  return isMonth(month) && month >= first && month <= last
}

function addressOf(month: string): string {
  return `/transactions?month=${month}`
}

interface MonthTransactionsProps {
  month: string
  today: string
  /** 강조할 거래 id */
  highlight: string | undefined
  onHighlightEnd: () => void
}

/** 합계와 목록 자리. 달마다 새로 그린다. 계좌와 카테고리 이름이 있어야 줄을 그릴 수 있어 함께 기다린다. */
function MonthTransactions({ month, today, highlight, onHighlightEnd }: MonthTransactionsProps) {
  const list = useTransactionList(month)
  const accounts = useAccounts()
  const categories = useCategories()
  const names = useMemo(
    () => accounts.data && categories.data && nameBookOf(accounts.data, categories.data),
    [accounts.data, categories.data],
  )

  if (list.data && names) {
    return (
      <MonthContent
        month={month}
        today={today}
        list={list}
        names={names}
        highlight={highlight}
        onHighlightEnd={onHighlightEnd}
      />
    )
  }
  // 다시 받는 동안에는 isError가 풀리므로 이 화면에서 받아 본 적이 있는지로 본다
  const queries = [list, accounts, categories]
  const failed = queries.filter((query) => !query.data && query.isFetchedAfterMount)
  if (failed.length > 0) {
    return (
      <LoadFailure
        headingLevel={2}
        busy={queries.some((query) => query.isFetching)}
        onRetry={() => failed.forEach((query) => void query.refetch())}
      />
    )
  }
  return <TransactionListSkeleton />
}

type TransactionListQuery = ReturnType<typeof useTransactionList>

interface MonthContentProps extends Omit<MonthTransactionsProps, 'today'> {
  today: string
  list: TransactionListQuery & { data: { pages: TransactionPage[] } }
  names: NameBook
}

function MonthContent({ month, today, list, names, highlight, onHighlightEnd }: MonthContentProps) {
  const pages = list.data.pages
  const items = useMemo(() => pages.flatMap((page) => page.items), [pages])
  const groups = useMemo(() => groupByDate(items), [items])
  const dayTotals = useMemo(() => new Map(pages.flatMap((page) => page.days).map((day) => [day.date, day])), [pages])
  const totals = pages[0].totals ?? { income: 0, expense: 0 }
  const rows = useRef<HTMLDivElement>(null)

  // 다시 받기가 끝난 뒤의 목록에 그 줄이 있으면 1초 동안 강조한다. 없으면 강조하지 않고 끝낸다
  const settled = !list.isFetching
  const present = highlight !== undefined && items.some(({ id }) => id === highlight)
  useEffect(() => {
    if (highlight === undefined || !settled) return
    if (!present) {
      onHighlightEnd()
      return
    }
    const timer = setTimeout(onHighlightEnd, HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlight, settled, present, onHighlightEnd])
  const highlighted = present && settled ? highlight : undefined

  if (items.length === 0 && !list.hasNextPage) {
    return (
      <>
        <Totals totals={totals} />
        <EmptyMonth month={month} today={today} />
      </>
    )
  }

  return (
    <>
      <Totals totals={totals} />
      <div ref={rows}>
        {groups.map((group) => (
          <DayGroup
            key={group.date}
            date={group.date}
            today={today}
            total={dayTotals.get(group.date)}
            items={group.items}
            names={names}
            highlighted={highlighted}
            headingLevel={2}
          />
        ))}
      </div>
      <ListEnd list={list} rows={rows} />
    </>
  )
}

/** 그 달의 수입·지출 합계(서버 값). 수입이 0원이면 부호와 강조색 없이 "0원"이다(0.2). */
function Totals({ totals }: { totals: IncomeAndExpense }) {
  return (
    <dl className={styles.totals}>
      <div className={styles.total}>
        <dt className={styles.totalName}>수입</dt>
        <dd className={styles.totalAmount}>
          <Amount kind={totals.income > 0 ? 'income' : 'balance'} value={totals.income} />
        </dd>
      </div>
      <div className={styles.total}>
        <dt className={styles.totalName}>지출</dt>
        <dd className={styles.totalAmount}>
          <Amount kind="expense" value={totals.expense} />
        </dd>
      </div>
    </dl>
  )
}

function EmptyMonth({ month, today }: { month: string; today: string }) {
  const ledger = useCurrentLedger()
  return (
    <EmptyState description={`${formatMonth(month, today)}에 입력한 거래가 없어요`}>
      {canEdit(ledger) && (
        <ButtonLink kind="primary" to="/transactions/new" onClick={holdKeyboard}>
          거래 입력
        </ButtonLink>
      )}
    </EmptyState>
  )
}

interface ListEndProps {
  list: TransactionListQuery
  /** 줄 목록. 다시 시도할 때 마지막 줄로 초점을 옮긴다. */
  rows: RefObject<HTMLDivElement | null>
}

/**
 * 목록 끝(00-common 5.10). 끝이 가까워지면 다음 쪽을 요청하고, 그동안 뼈대 줄 3개, 실패하면 "더 불러오지 못했어요"와
 * "다시 시도"를 보인다. 받으면 받은 건수를 화면 읽기에 알린다. 받는 중이거나 실패한 뒤에는 저절로 다시 요청하지 않는다.
 */
function ListEnd({ list, rows }: ListEndProps) {
  const target = useRef<HTMLDivElement>(null)
  const [nearEnd, setNearEnd] = useState(false)
  const { hasNextPage, isFetching, isFetchNextPageError, isFetchingNextPage, fetchNextPage } = list
  const pages = list.data?.pages ?? []

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNearEnd(entry.isIntersecting), { rootMargin: NEAR_END })
    observer.observe(target.current!)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (nearEnd && hasNextPage && !isFetching && !isFetchNextPageError) void fetchNextPage({ cancelRefetch: false })
  }, [nearEnd, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage])

  // 쪽이 늘면 새로 받은 건수를 알린다. 같은 글이 이어져도 다시 읽히도록 매번 새 요소로 넣는다
  const [pageCount, setPageCount] = useState(pages.length)
  const [loaded, setLoaded] = useState<{ count: number; message: string }>()
  if (pages.length !== pageCount) {
    setPageCount(pages.length)
    if (pages.length > pageCount) {
      setLoaded({ count: (loaded?.count ?? 0) + 1, message: `${pages.at(-1)!.items.length}건을 더 불러왔어요` })
    }
  }

  function retry() {
    // 누른 버튼이 사라지므로 마지막 줄로 초점을 옮겨, 받은 뒤 다음 Tab이 새 줄로 이어지게 한다
    const links = rows.current?.querySelectorAll<HTMLElement>('li > a')
    links?.item(links.length - 1)?.focus()
    if (!isFetching) void fetchNextPage({ cancelRefetch: false })
  }

  return (
    <>
      <div ref={target} />
      {isFetchingNextPage && (
        <Skeleton>
          <RowsSkeleton count={3} />
        </Skeleton>
      )}
      {isFetchNextPageError && !isFetchingNextPage && (
        <div className={styles.moreFailure}>
          <RetryMessage onRetry={retry}>더 불러오지 못했어요</RetryMessage>
        </div>
      )}
      <p className={styles.announcement} aria-live="polite">
        {loaded && <span key={loaded.count}>{loaded.message}</span>}
      </p>
    </>
  )
}
