import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import Amount from '../../components/Amount'
import { ButtonLink } from '../../components/Button'
import EmptyState from '../../components/EmptyState'
import { holdKeyboard } from '../../components/keyboardBridge'
import MonthNavigation from '../../components/MonthNavigation'
import { MainScreen } from '../../components/Screen'
import SwitchRow, { type SwitchItem } from '../../components/SwitchRow'
import { formatMonth, isSelectableMonth, monthOf, moveMonth, selectableMonths, today } from '../../lib/calendarDate'
import { parseCategories, type Category } from '../categories/categories'
import { categoriesKey, useCategories } from '../categories/useCategories'
import BasisTime from '../connection/BasisTime'
import { useShown } from '../connection/deviceFirst'
import LoadFailureHere from '../connection/LoadFailureHere'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { useKeptCopy } from '../me/ledgerCopy'
import { canEdit } from '../me/me'
import type { MonthlyStats, TopExpense } from './monthlyStats'
import MonthlyStatsSkeleton from './MonthlyStatsSkeleton'
import { monthlyStatsAddressOf } from './statsAddress'
import { useStatsMemory } from './statsMemory'
import { monthlyStatsKey, useMonthlyStats } from './useMonthlyStats'
import styles from './MonthlyStats.module.css'

/** 통계 전환 줄의 이름 */
const MONTHLY = '월별'

/**
 * E-01 월별 통계(#242, F-301). 주소의 달(`?month=YYYY-MM`)을 보인다. 달이 없거나 고를 수 없는 달이면 기억한 달이나 기기의 오늘이
 * 속한 달로 바꿔 간다(E 공통의 기간 규칙). 하단 탭은 달 없이 오고, 홈의 합계는 이번 달을 담아 온다.
 * 계산은 서버가 한다(P-205). 통계는 기기에 저장하지 않는 읽기 화면이다(P-902, F-908, #238의 범위 밖 표).
 * 1B 임시: 전환 줄은 "월별" 칸 하나라 그리지 않는다(SwitchRow, designer #242). 카테고리 줄은 누를 수 없다(E-02는 1C, planner #102).
 * 이벤트 지출 제외(2단계)와 할부 기준(3단계)은 아직 없다.
 */
export default function MonthlyStatsPage() {
  const memory = useStatsMemory()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // 화면을 연 날의 오늘. 범위와 달 이름(올해인지)을 정한다
  const [openedOn] = useState(today)
  const range = selectableMonths(openedOn)
  const requested = searchParams.get('month')
  const month = isSelectableMonth(requested, range) ? requested : undefined

  useEffect(() => {
    if (month) memory.rememberMonth(month)
  }, [month, memory])

  if (!month) {
    const remembered = memory.month() ?? null
    const fallback = isSelectableMonth(remembered, range) ? remembered : monthOf(openedOn)
    return <Navigate to={monthlyStatsAddressOf(fallback)} replace />
  }

  function move(months: -1 | 1) {
    void navigate(monthlyStatsAddressOf(moveMonth(month!, months)), { replace: true })
  }

  // 1C에 카테고리(E-02), 연 단위(E-05) 칸이 더해지면 전환 줄이 보인다(F-311)
  const switchItems: SwitchItem[] = [{ label: MONTHLY, to: monthlyStatsAddressOf(month) }]

  return (
    <MainScreen>
      <h1 className={styles.title}>통계</h1>
      <div className={styles.stats}>
        <SwitchRow label="통계 화면" items={switchItems} current={MONTHLY} />
        <div className={styles.monthNavigation}>
          <MonthNavigation
            month={month}
            label={formatMonth(month, openedOn)}
            first={range.first}
            last={range.last}
            onMove={move}
            headingLevel={2}
          />
        </div>
        <MonthContent key={month} month={month} today={openedOn} />
      </div>
    </MainScreen>
  )
}

/**
 * 그 달의 통계 자리. 달마다 새로 그린다. 카테고리 이름이 있어야 줄을 그릴 수 있어 함께 기다린다.
 * 통계는 기기에 남기지 않으므로 서버의 값만 보인다. 연결이 없거나 다시 받지 못했으면 받아 둔 값에 기준 시각을 붙이고, 받아 둔 값이
 * 없으면 불러오지 못함이다(useShown의 규칙). 카테고리 이름은 기기에 남긴 목록으로도 붙인다(카테고리는 기기에 저장한다).
 */
function MonthContent({ month, today }: { month: string; today: string }) {
  const ledger = useCurrentLedger()
  const statsQuery = useMonthlyStats(month)
  const categoriesQuery = useCategories()
  const stats = useShown(statsQuery, monthlyStatsKey(ledger.id, month), null)
  const categories = useShown(categoriesQuery, categoriesKey(ledger.id), useKeptCopy(ledger.id, 'categories', parseCategories))

  if (stats.state === 'ready' && categories.state === 'ready') {
    return <MonthFigures month={month} today={today} stats={stats.data} basis={stats.basis} categories={categories.data} />
  }
  if (stats.state === 'failed' || categories.state === 'failed') {
    const queries = [statsQuery, categoriesQuery].filter((query) => !query.data && query.isFetchedAfterMount)
    return (
      <LoadFailureHere
        headingLevel={2}
        busy={queries.some((query) => query.isFetching)}
        onRetry={() => queries.forEach((query) => void query.refetch())}
      />
    )
  }
  return <MonthlyStatsSkeleton />
}

interface MonthFiguresProps {
  month: string
  today: string
  stats: MonthlyStats
  /** 합계 위에 붙일 기준 시각(F-908). 연결이 있고 새로 받은 값이면 없다 */
  basis: number | undefined
  categories: Category[]
}

function MonthFigures({ month, today, stats, basis, categories }: MonthFiguresProps) {
  const monthName = formatMonth(month, today)
  const noTransactions = stats.income === 0 && stats.expense === 0 && stats.topExpenses.length === 0
  return (
    <>
      {basis !== undefined && (
        <p className={styles.basis}>
          <BasisTime at={basis} />
        </p>
      )}
      <Totals stats={stats} />
      {noTransactions ? (
        <NoTransactions monthName={monthName} />
      ) : stats.topExpenses.length === 0 ? (
        // 수입만 있거나 환불이 더 커 지출이 0원 이하인 달(planner #242)
        <EmptyState description={`${monthName}에는 지출이 없어요`} />
      ) : (
        <TopExpenses items={stats.topExpenses} categories={categories} />
      )}
    </>
  )
}

/**
 * (5) 수입, 지출, 차액(0.2의 색 규칙). 수입이 0원이면 부호와 강조색 없이 "0원"이다(홈, 내역과 같다). 값 자체가 음수인 합계
 * (환불이 더 큰 달의 지출, 차액)는 본문 글자색과 "-"다. 차액은 서버가 준 값이고 부호를 늘 붙인다.
 */
function Totals({ stats }: { stats: MonthlyStats }) {
  return (
    <dl className={styles.totals}>
      <div className={styles.total}>
        <dt className={styles.totalName}>수입</dt>
        <dd className={styles.totalAmount}>
          <Amount kind={stats.income > 0 ? 'income' : 'balance'} value={stats.income} />
        </dd>
      </div>
      <div className={styles.total}>
        <dt className={styles.totalName}>지출</dt>
        <dd className={styles.totalAmount}>
          <Amount kind={stats.expense < 0 ? 'balance' : 'expense'} value={stats.expense} />
        </dd>
      </div>
      <div className={styles.total}>
        <dt className={styles.totalName}>차액</dt>
        <dd className={styles.totalAmount}>
          <Amount kind="difference" value={stats.net} />
        </dd>
      </div>
    </dl>
  )
}

/** 거래가 없는 달. "거래 입력"은 거래 입력(D-04)을 지출로 연다. 보기 전용은 문장만이다. */
function NoTransactions({ monthName }: { monthName: string }) {
  const ledger = useCurrentLedger()
  return (
    <EmptyState description={`${monthName}에 입력한 거래가 없어요`}>
      {canEdit(ledger) && (
        <ButtonLink kind="primary" to="/transactions/new" onClick={holdKeyboard}>
          거래 입력
        </ButtonLink>
      )}
    </EmptyState>
  )
}

/**
 * (6)(7) 지출이 큰 카테고리(F-301). 서버가 준 순서(금액이 큰 순) 그대로다. 이름은 카테고리 목록(#34)의 최상위 이름이고, 목록에
 * 없는 id면 이름 자리를 비운다(내역과 같다, planner #242). 막대는 장식이라 화면 읽기에서 숨기고 금액 글자로 읽힌다.
 */
function TopExpenses({ items, categories }: { items: TopExpense[]; categories: Category[] }) {
  const headingId = useId()
  const names = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories])
  // 0원 이하는 서버가 빼므로 가장 큰 값은 양수다
  const largest = Math.max(...items.map(({ amount }) => amount))
  return (
    <section aria-labelledby={headingId} className={styles.top}>
      <h2 id={headingId} className={styles.topHead}>
        지출이 큰 카테고리
      </h2>
      <ul className={styles.topList}>
        {items.map(({ categoryId, amount }) => (
          <li key={categoryId} className={styles.topRow}>
            <span className={styles.topName}>{names.get(categoryId)}</span>
            <span className={styles.topAmount}>
              <Amount kind="expense" value={amount} />
            </span>
            <span className={styles.bar} aria-hidden="true">
              <span className={styles.barFill} style={shareOf(amount, largest)} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * 막대 폭. 계산한 비율만 CSS 변수로 넘긴다(docs/design/components.md 5절). 금액이 아니라 폭의 비율이라 소수이고, 소수 둘째 자리까지
 * 반올림한다.
 */
function shareOf(amount: number, largest: number): CSSProperties {
  const percent = Math.round((amount / largest) * 10_000) / 100
  return { '--share': `${percent}%` } as CSSProperties
}
