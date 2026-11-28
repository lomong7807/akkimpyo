import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { ButtonLink } from '../../components/Button'
import EmptyState from '../../components/EmptyState'
import { holdKeyboard } from '../../components/keyboardBridge'
import MonthNavigation from '../../components/MonthNavigation'
import { SubScreen } from '../../components/Screen'
import Skeleton, { LoadingStatus, SkeletonBar } from '../../components/Skeleton'
import { useLoadingMessage } from '../../components/useLoadingMessage'
import { useWideScreen } from '../../components/wideScreen'
import {
  addDays,
  addMonths,
  clampDate,
  formatMonth,
  isSelectableMonth,
  monthOf,
  monthWeeks,
  moveMonth,
  selectableMonths,
  selectableRange,
  today,
  WEEKDAYS,
  type DateRange,
} from '../../lib/calendarDate'
import { useAccounts } from '../accounts/useAccounts'
import { useCategories } from '../categories/useCategories'
import LoadFailureHere from '../connection/LoadFailureHere'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { canEdit } from '../me/me'
import { syncedMoment } from '../sync/syncedText'
import { useSyncedAt } from '../sync/useSyncState'
import { calendarAddressOf, calendarStateOf, type CalendarState } from './calendarAddress'
import { cellAmount, cellLabel, firstDayOf } from './calendarCells'
import { useDailyTotals } from './dailyTotals'
import { DayGroup } from './DayGroup'
import ListEnd, { type PagedList } from './ListEnd'
import { nameBookOf, type NameBook } from './listedText'
import { useListMemory } from './listMemory'
import { mergeMonth, pendingRow, pendingSums, usePendingTransactions, type ShownTransaction } from './pendingTransactions'
import { RowsSkeleton } from './TransactionListSkeleton'
import type { IncomeAndExpense } from './transactions'
import { useDayTransactions } from './useTransactionList'
import styles from './CalendarPage.module.css'

/** 화살표·PageUp·PageDown으로 초점을 옮기는 곳(00-common 5.8, designer #300 Q8). Home·End는 쓰지 않는다 */
const moves: Partial<Record<string, (date: string) => string>> = {
  ArrowLeft: (date) => addDays(date, -1),
  ArrowRight: (date) => addDays(date, 1),
  ArrowUp: (date) => addDays(date, -7),
  ArrowDown: (date) => addDays(date, 7),
  PageUp: (date) => addMonths(date, -1),
  PageDown: (date) => addMonths(date, 1),
}

/** 같은 오류가 되풀이됐다고 보는 "다시 시도"의 연이은 실패 수(00-common 4.3) */
const REPEATED_FAILURES = 2

/**
 * D-02 달력. 주소의 달(`?month=YYYY-MM`)을 보인다. 달이 없거나 고를 수 없는 달이면 내역과 같게 기억한 달이나 기기의 오늘이
 * 속한 달로 바꿔 간다. 고른 날은 이 방문 기록 항목의 상태에 두어 상세에 다녀오거나 새로고침해도 그대로다(designer #300 Q5).
 * 옮긴 달은 내역의 기억한 달과 이 달력을 연 내역 항목에 넘긴다(D-02 (1), architect #300 B).
 * 칸의 금액은 날짜별 합계(#66), 고른 날의 머리와 목록은 하루 목록(#15) 한 응답이다(architect #300 C). 이 기기에 쌓인 보내지 않은
 * 입력도 칸, 머리, 목록에 더한다(planner #300 Q3). 연결이 없을 때는 1B 임시로 기기의 내역을 쓰지 않고 불러오기 실패다(#300).
 */
export default function CalendarPage() {
  const memory = useListMemory()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  // 화면을 연 날의 오늘. 범위, 오늘 표시, 처음 고른 날, 달 이름(올해인지)을 정한다
  const [openedOn] = useState(today)
  const range = selectableMonths(openedOn)
  const requested = searchParams.get('month')
  const month = isSelectableMonth(requested, range) ? requested : undefined
  const state = calendarStateOf(location.state)
  const { listKey } = state

  useEffect(() => {
    if (!month) return
    memory.rememberMonth(month)
    if (listKey) memory.handOffMonth(listKey, month)
  }, [month, listKey, memory])

  if (!month) {
    const remembered = memory.month()
    const fallback = isSelectableMonth(remembered ?? null, range) ? remembered! : monthOf(openedOn)
    return <Navigate to={calendarAddressOf(fallback)} replace state={listKey ? { listKey } : null} />
  }

  return (
    <SubScreen title="달력" parent={`/transactions?month=${month}`} fullWidth>
      <MonthCalendar
        month={month}
        today={openedOn}
        range={range}
        state={state}
        onNavigate={(next) =>
          void navigate(calendarAddressOf(next.month), {
            replace: true,
            state: next.state,
            preventScrollReset: next.keepScroll,
          })
        }
      />
    </SubScreen>
  )
}

interface MonthCalendarProps {
  month: string
  today: string
  range: DateRange
  state: CalendarState
  onNavigate: (next: { month: string; state: CalendarState; keepScroll: boolean }) => void
}

function MonthCalendar({ month, today, range, state, onNavigate }: MonthCalendarProps) {
  const ledger = useCurrentLedger()
  const wide = useWideScreen()
  const days = selectableRange(today)
  const isSelectable = (date: string) => clampDate(date, days) === date
  const selected = state.day && monthOf(state.day) === month && isSelectable(state.day) ? state.day : firstDayOf(month, today)
  // Tab으로 들어가는 칸. 화살표로 옮기고, 고르면 고른 날이다
  const [focusDate, setFocusDate] = useState<string>()
  const active = focusDate && monthOf(focusDate) === month ? focusDate : selected
  const gridRef = useRef<HTMLTableElement>(null)
  // 키보드로 다른 달의 날짜로 옮기면 그 달을 그린 뒤 그 칸에 초점을 준다
  const focusAfterRender = useRef<string>(undefined)
  const monthHeadingId = useId()

  const dailyQuery = useDailyTotals(month)
  const dayQuery = useDayTransactions(selected)
  const accountsQuery = useAccounts()
  const categoriesQuery = useCategories()
  const pending = usePendingTransactions()

  const names = useMemo(
    () => accountsQuery.data && categoriesQuery.data && nameBookOf(accountsQuery.data, categoriesQuery.data),
    [accountsQuery.data, categoriesQuery.data],
  )
  const dayItems = useMemo(() => dayQuery.data?.pages.flatMap((page) => page.items), [dayQuery.data])
  // 이 달의 보내지 않은 입력. 고른 날의 서버 줄에 같은 id가 있으면 서버에 저장된 것이라 뺀다
  const monthPending = useMemo(() => {
    const serverIds = new Set((dayItems ?? []).map(({ id }) => id.toLowerCase()))
    return pending
      .flatMap((item) => pendingRow(item, categoriesQuery.data ?? []) ?? [])
      .filter((row) => monthOf(row.occurredOn) === month && !serverIds.has(row.id.toLowerCase()))
  }, [pending, categoriesQuery.data, dayItems, month])
  const cellTotals = useMemo(() => {
    if (!dailyQuery.data) return undefined
    const totals = new Map<string, IncomeAndExpense>(dailyQuery.data.map(({ date, income, expense }) => [date, { income, expense }]))
    for (const row of monthPending) {
      if (row.type === 'TRANSFER') continue
      const shown = totals.get(row.occurredOn) ?? { income: 0, expense: 0 }
      totals.set(row.occurredOn, {
        income: shown.income + (row.type === 'INCOME' ? row.amount : 0),
        expense: shown.expense + (row.type === 'EXPENSE' ? row.amount : 0),
      })
    }
    return totals
  }, [dailyQuery.data, monthPending])

  useLayoutEffect(() => {
    // 달이 바뀌기 전의 그림(옮길 날짜가 아직 없는 달)에서는 기다린다
    if (focusAfterRender.current === undefined || focusAfterRender.current !== active) return
    focusAfterRender.current = undefined
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${active}"]`)?.focus()
  }, [active])

  function move(months: -1 | 1) {
    setFocusDate(undefined)
    onNavigate({ month: moveMonth(month, months), state: { listKey: state.listKey }, keepScroll: false })
  }

  function select(date: string) {
    if (!isSelectable(date)) return
    setFocusDate(date)
    onNavigate({ month, state: { ...state, day: date }, keepScroll: true })
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const moveFocus = moves[event.key]
    if (moveFocus) {
      event.preventDefault()
      const target = clampDate(moveFocus(active), days)
      setFocusDate(target)
      if (monthOf(target) === month) {
        gridRef.current?.querySelector<HTMLElement>(`[data-date="${target}"]`)?.focus()
        return
      }
      // 다른 달로 넘어가면 달을 옮기고 그 달을 그린 뒤 초점을 준다. 고른 날은 옮긴 달의 처음 규칙이다(designer #300 Q8)
      focusAfterRender.current = target
      onNavigate({ month: monthOf(target), state: { listKey: state.listKey }, keepScroll: false })
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!event.repeat) select(active)
    }
  }

  const failing = [dailyQuery, dayQuery, accountsQuery, categoriesQuery].filter((query) => !query.data && query.isError)

  return (
    <div className={styles.columns}>
      <section className={styles.monthColumn} aria-labelledby={monthHeadingId}>
        <div className={styles.monthNavigation}>
          <MonthNavigation
            month={month}
            label={formatMonth(month, today)}
            first={range.first}
            last={range.last}
            onMove={move}
            headingLevel={2}
            headingId={monthHeadingId}
          />
        </div>
        <MonthGrid
          gridRef={gridRef}
          month={month}
          today={today}
          selected={selected}
          active={active}
          totals={cellTotals}
          loading={!dailyQuery.data && !dailyQuery.isError}
          wide={wide}
          labelledBy={monthHeadingId}
          isSelectable={isSelectable}
          onSelect={select}
          onKeyDown={handleKeyDown}
        />
      </section>
      <div className={styles.dayColumn}>
        {failing.length > 0 ? (
          <CalendarFailure key={`${month}|${selected}`} queries={failing} />
        ) : names && dayQuery.data && categoriesQuery.data ? (
          <SelectedDay
            date={selected}
            today={today}
            query={dayQuery}
            items={dayItems!}
            pending={monthPending.filter((row) => row.occurredOn === selected)}
            names={names}
            canWrite={canEdit(ledger)}
          />
        ) : (
          <SelectedDayLoading date={selected} today={today} />
        )}
      </div>
    </div>
  )
}

interface MonthGridProps {
  gridRef: RefObject<HTMLTableElement | null>
  month: string
  today: string
  selected: string
  /** Tab으로 들어가는 칸 */
  active: string
  /** 날짜마다 보일 합계. 받기 전이거나 받지 못했으면 없다 */
  totals: Map<string, IncomeAndExpense> | undefined
  loading: boolean
  wide: boolean
  labelledBy: string
  isSelectable: (date: string) => boolean
  onSelect: (date: string) => void
  onKeyDown: (event: KeyboardEvent) => void
}

/**
 * 한 달 달력(D-02 (2)(3)). 일요일부터 7칸, 그 달의 주 수만큼 줄. 칸은 날짜 숫자 아래에 지출(본문 글자색)과 수입(강조색, "+")을
 * "원" 없이 보인다. 0원은 보이지 않는다. 금액이 칸에 다 들어가지 않으면(글자를 키움) 그 칸은 금액 대신 점 하나다(F-903).
 * 받는 동안 날짜 숫자는 그대로 두고 금액 자리만 300ms 뒤 뼈대다.
 */
function MonthGrid(props: MonthGridProps) {
  const { gridRef, month, today, selected, active, totals, loading, wide, labelledBy, isSelectable, onSelect, onKeyDown } =
    props
  const message = useLoadingMessage()
  const shownLoading = loading ? message : undefined
  const overflowing = useOverflowingCells(gridRef, totals, wide)

  return (
    <>
      <LoadingStatus message={shownLoading} />
      <table ref={gridRef} role="grid" aria-labelledby={labelledBy} className={styles.grid} onKeyDown={onKeyDown}>
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th key={weekday} scope="col" className={styles.weekday} aria-label={`${weekday}요일`}>
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(month).map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((date, weekday) => {
                if (!date) return <td key={weekday} className={styles.blank} />
                const selectable = isSelectable(date)
                const total = totals?.get(date)
                return (
                  <td
                    key={date}
                    role="gridcell"
                    data-date={date}
                    className={styles.day}
                    tabIndex={date === active ? 0 : selectable ? -1 : undefined}
                    aria-label={cellLabel(date, today, total)}
                    aria-selected={date === selected || undefined}
                    aria-current={date === today ? 'date' : undefined}
                    aria-disabled={!selectable || undefined}
                    onClick={selectable ? () => onSelect(date) : undefined}
                  >
                    <span className={`${styles.number} tabular-nums`}>{Number(date.slice(-2))}</span>
                    <span
                      data-figures={date}
                      className={overflowing.has(date) ? `${styles.figures} ${styles.dotted}` : styles.figures}
                    >
                      {shownLoading ? (
                        <span className={styles.figureSkeleton} aria-hidden="true">
                          <SkeletonBar kind="name" text="label" />
                        </span>
                      ) : (
                        total && <Figures total={total} wide={wide} />
                      )}
                      {overflowing.has(date) && <span className={styles.dot} aria-hidden="true" />}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/**
 * 칸의 지출과 수입. 0원인 값은 없다. 음수(환불이 더 큰 날, #390)는 수입도 강조색 없이 지출과 같은 본문 글자색과 "-"다
 * (00-common 2.2, designer #390). 읽는 것은 칸의 접근 이름이 한다
 */
function Figures({ total, wide }: { total: IncomeAndExpense; wide: boolean }) {
  const gained = total.income > 0
  return (
    <>
      {total.expense !== 0 && (
        <span data-figure="" aria-hidden="true" className={`${styles.figure} ${styles.expense} tabular-nums`}>
          {cellAmount(total.expense, wide)}
        </span>
      )}
      {total.income !== 0 && (
        <span
          data-figure=""
          aria-hidden="true"
          className={`${styles.figure} ${gained ? styles.income : styles.expense} tabular-nums`}
        >
          {`${gained ? '+' : ''}${cellAmount(total.income, wide)}`}
        </span>
      )}
    </>
  )
}

const NONE: ReadonlySet<string> = new Set()

/**
 * 금액 글자가 칸의 금액 자리보다 넓은 칸의 날짜. 칸 폭이 바뀌거나(창 폭) 글자 크기가 바뀌면(글자 키우기) 다시 잰다.
 * 점으로 바꾼 칸도 금액 글자는 보이지 않게 둔 채 자리에 남아 있어 계속 잴 수 있다.
 */
function useOverflowingCells(
  gridRef: RefObject<HTMLTableElement | null>,
  totals: unknown,
  wide: boolean,
): ReadonlySet<string> {
  const [overflowing, setOverflowing] = useState(NONE)

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    function measure() {
      const next = new Set<string>()
      for (const figures of grid!.querySelectorAll<HTMLElement>('[data-figures]')) {
        const width = figures.clientWidth
        const lines = figures.querySelectorAll<HTMLElement>('[data-figure]')
        if ([...lines].some((line) => line.scrollWidth > width)) next.add(figures.dataset.figures!)
      }
      setOverflowing((last) => (last.size === next.size && [...next].every((date) => last.has(date)) ? last : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    for (const line of grid.querySelectorAll('[data-figure]')) observer.observe(line)
    return () => observer.disconnect()
    // 금액이나 배치(넓은 화면)가 바뀌면 잴 글자도 바뀐다
  }, [gridRef, totals, wide])

  return overflowing
}

interface SelectedDayProps {
  date: string
  today: string
  query: PagedList
  /** 받은 쪽들의 서버 줄(서버 순서) */
  items: ShownTransaction[]
  /** 그날의 보내지 않은 입력(서버에 없는 것) */
  pending: ShownTransaction[]
  names: NameBook
  canWrite: boolean
}

/**
 * 고른 날의 머리와 거래 목록(D-02 (4)(5)). 머리의 합계는 하루 목록 첫 쪽의 그날 합계에 보내지 않은 입력을 더한 것이다.
 * 줄의 순서는 내역과 같고(서버 순서에 보내지 않은 입력을 끼운다) 50건씩 이어 받는다(00-common 5.10).
 */
function SelectedDay({ date, today, query, items, pending, names, canWrite }: SelectedDayProps) {
  const pages = query.data!.pages
  const complete = !query.hasNextPage
  const shown = useMemo(() => mergeMonth(items, pending, complete), [items, pending, complete])
  const total = useMemo(() => {
    const server = pages[0].totals ?? { income: 0, expense: 0 }
    const added = pendingSums(shown.filter((row) => row.pending))
    return { date, income: server.income + added.income, expense: server.expense + added.expense }
  }, [pages, shown, date])
  const rows = useRef<HTMLDivElement>(null)

  return (
    <div ref={rows}>
      <DayGroup date={date} today={today} total={total} items={shown} names={names} headingLevel={3} />
      {shown.length === 0 && complete ? (
        <EmptyState description="이날 거래가 없어요">
          {canWrite && (
            <ButtonLink kind="primary" to="/transactions/new" state={{ date }} onClick={holdKeyboard}>
              거래 입력
            </ButtonLink>
          )}
        </EmptyState>
      ) : (
        <ListEnd list={query} rows={rows} />
      )}
    </div>
  )
}

/** 고른 날을 받는 동안: 머리의 날짜는 바로 보이고 거래 줄 3개 모양의 뼈대(D-02 상태) */
function SelectedDayLoading({ date, today }: { date: string; today: string }) {
  return (
    <>
      <DayGroup date={date} today={today} total={undefined} items={[]} names={EMPTY_NAMES} headingLevel={3} />
      <Skeleton>
        <RowsSkeleton count={3} />
      </Skeleton>
    </>
  )
}

const EMPTY_NAMES = nameBookOf([], [])

type FailingQuery = { refetch: () => Promise<{ isError: boolean }>; isFetching: boolean }

/**
 * 달력 아래의 불러오기 실패(F-907, F-908). 받지 못한 것만 다시 요청한다. "다시 시도"가 연달아 두 번 실패하면 오류 문구 아래에
 * "마지막으로 맞춘 시각 {시각}"(00-common 4.3)이다. 연결이 없으면 버튼 없이 연결되면 저절로 다시 받는다.
 */
function CalendarFailure({ queries }: { queries: FailingQuery[] }) {
  const [failures, setFailures] = useState(0)
  const syncedAt = useSyncedAt()

  function retry() {
    void Promise.all(queries.map((query) => query.refetch())).then((results) => {
      setFailures((count) => (results.some((result) => result.isError) ? count + 1 : 0))
    })
  }

  const note =
    failures >= REPEATED_FAILURES && typeof syncedAt === 'number' ? `마지막으로 맞춘 시각 ${syncedMoment(syncedAt)}` : undefined
  return (
    <div className={styles.failure}>
      <LoadFailureHere
        headingLevel={2}
        busy={queries.some((query) => query.isFetching)}
        onRetry={retry}
        note={note}
      />
    </div>
  )
}
