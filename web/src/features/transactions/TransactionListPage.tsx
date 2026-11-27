import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import Amount from '../../components/Amount'
import { ButtonLink } from '../../components/Button'
import EmptyState from '../../components/EmptyState'
import { holdKeyboard } from '../../components/keyboardBridge'
import MonthNavigation from '../../components/MonthNavigation'
import RetryMessage from '../../components/RetryMessage'
import { MainScreen } from '../../components/Screen'
import Skeleton from '../../components/Skeleton'
import { formatMonth, isMonth, monthOf, moveMonth, selectableMonths, today } from '../../lib/calendarDate'
import { parseAccounts } from '../accounts/accounts'
import { accountsKey, useAccounts } from '../accounts/useAccounts'
import { parseCategories } from '../categories/categories'
import { categoriesKey, useCategories } from '../categories/useCategories'
import BasisTime from '../connection/BasisTime'
import { useShown } from '../connection/deviceFirst'
import LoadFailureHere from '../connection/LoadFailureHere'
import { useReceivedAt } from '../connection/receivedAt'
import { useConnection } from '../connection/useConnection'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { useKeptCopy } from '../me/ledgerCopy'
import { canEdit } from '../me/me'
import { DayGroup } from './DayGroup'
import { groupByDate } from './groupByDate'
import { keptMonthOf, useKeptLastMonth } from './lastMonth'
import { nameBookOf, type NameBook } from './listedText'
import { useListMemory } from './listMemory'
import { mergeMonth, pendingRow, pendingSums, usePendingTransactions, withPendingDays } from './pendingTransactions'
import TransactionListSkeleton, { RowsSkeleton } from './TransactionListSkeleton'
import type { Category } from '../categories/categories'
import type { DayTotal, IncomeAndExpense, ListedTransaction } from './transactions'
import { transactionListKey, useTransactionList } from './useTransactionList'
import styles from './TransactionList.module.css'

/** 저장한 줄을 강조하는 시간 */
const HIGHLIGHT_MS = 1000

/** 목록 끝이 화면 아래로 한 화면 높이 안에 들어오면 다음 쪽을 요청한다(00-common 5.10). */
const NEAR_END = '0px 0px 100% 0px'

/**
 * D-01 내역(1A). 주소의 달(`?month=YYYY-MM`)을 보인다. 달이 없거나 고를 수 없는 달이면 기억한 달이나 기기의 오늘이 속한
 * 달로 바꿔 간다. 1A에는 필터 줄, 달력·검색 버튼, 넓은 화면의 상세 칸이 없다.
 * 연결이 없거나 받지 못하면 기기에 남긴 최근 한 달(P-902)로 읽기 전용으로 보인다(F-908, #238).
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

/** 연결이 없을 때 저장 범위(최근 31일) 밖(F-908, 00-common 3.4) */
const OUT_OF_RANGE = '연결되면 볼 수 있어요'

/**
 * 합계와 목록 자리. 달마다 새로 그린다. 계좌와 카테고리 이름이 있어야 줄을 그릴 수 있어 함께 기다린다.
 * 보일 것은 이 순서로 고른다(00-common 4.3, 4.5, F-908).
 * - 서버의 그 달. 연결이 없거나 다시 받지 못했으면 기준 시각을 붙인다. 다음 쪽이 남았는데 연결이 없으면 기기의 최근 한 달이
 *   그 달에 걸칠 때 그것을 보이고, 아니면 목록 끝에 "연결되면 볼 수 있어요".
 * - 기기의 최근 한 달. 연결이 있고 받는 중이면 그 달을 다 덮을 때만 뼈대 대신 먼저 보인다. 연결이 없으면 앞쪽 일부가 저장
 *   범위 밖이어도 보이고 목록 끝에 "연결되면 볼 수 있어요"를, 연결된 채 받지 못했으면 다 덮을 때만 보인다.
 * - 연결이 없고 그 달이 저장 범위 밖이면 목록 자리에 "연결되면 볼 수 있어요", 기기에 남은 것이 없으면 불러오지 못함이다.
 */
function MonthTransactions({ month, today, highlight, onHighlightEnd }: MonthTransactionsProps) {
  const ledger = useCurrentLedger()
  const list = useTransactionList(month)
  const accountsQuery = useAccounts()
  const categoriesQuery = useCategories()
  const accounts = useShown(accountsQuery, accountsKey(ledger.id), useKeptCopy(ledger.id, 'accounts', parseAccounts))
  const categories = useShown(categoriesQuery, categoriesKey(ledger.id), useKeptCopy(ledger.id, 'categories', parseCategories))
  // 최근 한 달은 홈이 받아 남긴다. 내역은 받아 둔 것이나 기기의 사본만 읽어 요청을 늘리지 않는다
  const lastMonth = useKeptLastMonth({ fetch: false })
  const online = useConnection() === 'online'
  const listReceivedAt = useReceivedAt(transactionListKey(ledger.id, month))
  const accountList = accounts.state === 'ready' ? accounts.data : undefined
  const categoryList = categories.state === 'ready' ? categories.data : undefined
  const names = useMemo(
    () => accountList && categoryList && nameBookOf(accountList, categoryList),
    [accountList, categoryList],
  )
  const keptMonth = useMemo(() => lastMonth && keptMonthOf(lastMonth.value, month), [lastMonth, month])

  // 다시 받는 동안에는 isError가 풀리므로 값이 없으면 이 화면에서 받아 본 적이 있는지로 본다
  const listFailed = list.data ? list.isError : list.isFetchedAfterMount
  const stale = !online || listFailed
  const shown = { month, today, highlight, onHighlightEnd, names: names!, categories: categoryList! }

  if (names) {
    const pages = list.data?.pages
    if (pages && (!stale || !list.hasNextPage || !keptMonth)) {
      const rows = {
        items: pages.flatMap((page) => page.items),
        days: pages.flatMap((page) => page.days),
        totals: pages[0].totals ?? { income: 0, expense: 0 },
        complete: !list.hasNextPage,
      }
      return (
        <MonthContent
          {...shown}
          rows={rows}
          settled={!list.isFetching}
          basis={stale ? listReceivedAt : undefined}
          end={list.hasNextPage && !online ? 'out-of-range' : { list }}
        />
      )
    }
    if (keptMonth && (!keptMonth.partial || !online)) {
      return (
        <MonthContent
          {...shown}
          rows={{ ...keptMonth, complete: true }}
          settled
          basis={stale ? lastMonth!.receivedAt : undefined}
          end={keptMonth.partial ? 'out-of-range' : undefined}
        />
      )
    }
    if (!online && lastMonth && !keptMonth) return <OutOfRange inPlace />
  }
  const failed =
    [accounts, categories].some(({ state }) => state === 'failed') ||
    (names !== undefined && (online ? listFailed : lastMonth === null))
  if (failed) {
    const queries = [list, accountsQuery, categoriesQuery].filter((query) => !query.data && query.isFetchedAfterMount)
    return (
      <LoadFailureHere
        headingLevel={2}
        busy={queries.some((query) => query.isFetching)}
        onRetry={() => queries.forEach((query) => void query.refetch())}
      />
    )
  }
  return <TransactionListSkeleton />
}

/**
 * 연결이 없을 때 저장 범위 밖이다. 그 달의 앞쪽 일부가 밖이면 목록 끝에, 달 전체가 밖이면 목록 자리에 둔다(D-01 네트워크 오류).
 * 버튼은 없다. 연결이 돌아오면 그 달을 다시 받는다.
 */
function OutOfRange({ inPlace = false }: { inPlace?: boolean }) {
  // 목록 자리면 데이터 없음과 같은 자리와 모양이다(00-common 4.2). 채울 방법이 연결뿐이라 버튼이 없다
  return inPlace ? <EmptyState description={OUT_OF_RANGE} /> : <p className={styles.outOfRange}>{OUT_OF_RANGE}</p>
}

/** 그 달의 줄(서버 순서), 그날 합계, 그 달 합계(서버 값). 다음 쪽이 남았으면 complete가 아니다 */
interface MonthRows {
  items: ListedTransaction[]
  days: DayTotal[]
  totals: IncomeAndExpense
  complete: boolean
}

type TransactionListQuery = ReturnType<typeof useTransactionList>

interface MonthContentProps extends MonthTransactionsProps {
  rows: MonthRows
  names: NameBook
  categories: Category[]
  /** 받기가 끝났다. 저장 뒤 돌아왔으면 그 뒤의 목록에서 강조할 줄을 찾는다 */
  settled: boolean
  /** 합계 머리에 붙일 기준 시각(F-908). 연결이 있고 새로 받은 값이면 없다 */
  basis: number | undefined
  /** 목록 끝: 서버의 다음 쪽(5.10)이나 저장 범위 밖 안내(F-908). 없으면 둘 다 없다 */
  end: { list: TransactionListQuery } | 'out-of-range' | undefined
}

/**
 * 그 달의 줄과 합계. 이 기기에 쌓은 보내지 않은 입력을 같은 순서 규칙으로 섞는다(D-01 (8)(11)). 수입·지출 합계에는 그 달의
 * 보내지 않은 입력을 더하고(D-01 (4)), 그날 합계에는 보이는 보내지 않음 줄을 더한다(planner Q5).
 */
function MonthContent(props: MonthContentProps) {
  const { month, today, rows, names, categories, highlight, onHighlightEnd, settled, basis, end } = props
  const pending = usePendingTransactions()
  const serverItems = rows.items
  const monthPending = useMemo(() => {
    const serverIds = new Set(serverItems.map(({ id }) => id.toLowerCase()))
    return pending
      .flatMap((item) => pendingRow(item, categories) ?? [])
      .filter((row) => monthOf(row.occurredOn) === month && !serverIds.has(row.id.toLowerCase()))
  }, [pending, categories, serverItems, month])
  const items = useMemo(() => mergeMonth(serverItems, monthPending, rows.complete), [serverItems, monthPending, rows.complete])
  const groups = useMemo(() => groupByDate(items), [items])
  const dayTotals = useMemo(
    () => withPendingDays(new Map(rows.days.map((day) => [day.date, day])), items),
    [rows.days, items],
  )
  const totals = useMemo(() => {
    const added = pendingSums(monthPending)
    return { income: rows.totals.income + added.income, expense: rows.totals.expense + added.expense }
  }, [rows.totals, monthPending])
  const list = useRef<HTMLDivElement>(null)

  // 다시 받기가 끝난 뒤의 목록에 그 줄이 있으면 1초 동안 강조한다. 없으면 강조하지 않고 끝낸다
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

  if (items.length === 0 && rows.complete && end !== 'out-of-range') {
    return (
      <>
        <Totals totals={totals} basis={basis} />
        <EmptyMonth month={month} today={today} />
      </>
    )
  }

  return (
    <>
      <Totals totals={totals} basis={basis} />
      <div ref={list}>
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
      {end === 'out-of-range' ? <OutOfRange /> : end && <ListEnd list={end.list} rows={list} />}
    </>
  )
}

/**
 * 그 달의 수입·지출 합계(서버 값에 보내지 않은 입력을 더한 것). 수입이 0원이면 부호와 강조색 없이 "0원"이다(0.2).
 * 연결이 없거나 새로 받지 못했으면 합계 머리 오른쪽에 기준 시각을 붙인다(D-01 네트워크 오류, N-03 (5)).
 */
function Totals({ totals, basis }: { totals: IncomeAndExpense; basis: number | undefined }) {
  return (
    <>
      {basis !== undefined && (
        <p className={styles.basis}>
          <BasisTime at={basis} />
        </p>
      )}
      <TotalFigures totals={totals} />
    </>
  )
}

function TotalFigures({ totals }: { totals: IncomeAndExpense }) {
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
