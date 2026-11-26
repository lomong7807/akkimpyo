import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import Amount from '../../components/Amount'
import { Button, ButtonLink } from '../../components/Button'
import EmptyState from '../../components/EmptyState'
import Icon from '../../components/Icon'
import { holdKeyboard } from '../../components/keyboardBridge'
import { MainScreen } from '../../components/Screen'
import { LoadingStatus, SkeletonBar, SkeletonSpace } from '../../components/Skeleton'
import { useLoadingMessage } from '../../components/useLoadingMessage'
import { formatAmount } from '../../lib/amountText'
import { formatMonth, monthOf, today } from '../../lib/calendarDate'
import { accountTypes, type Account } from '../accounts/accounts'
import { accountTypeNames } from '../accounts/accountTypeNames'
import { useAccounts } from '../accounts/useAccounts'
import { useCategories } from '../categories/useCategories'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { canEdit } from '../me/me'
import { DayGroup } from '../transactions/DayGroup'
import { groupByDate } from '../transactions/groupByDate'
import { nameBookOf, type NameBook } from '../transactions/listedText'
import { mergeRecent, pendingRow, usePendingTransactions, withPendingDays } from '../transactions/pendingTransactions'
import { DayHeadSkeleton, RowsSkeleton } from '../transactions/TransactionListSkeleton'
import { RECENT_COUNT, type IncomeAndExpense, type RecentTransactions } from '../transactions/transactions'
import { useMonthTotals, useRecentTransactions } from '../transactions/useTransactionList'
import styles from './Home.module.css'

/** 구역 하나가 기다리는 조회 */
interface SectionQuery {
  data: unknown
  isFetchedAfterMount: boolean
  isFetching: boolean
  refetch: () => Promise<unknown>
}

/** 구역의 상태. 구역마다 따로 정하므로 한 구역이 실패해도 다른 구역은 그대로다. */
type SectionState = 'ready' | 'failed' | 'loading'

function stateOf(queries: SectionQuery[]): SectionState {
  if (queries.every((query) => query.data !== undefined)) return 'ready'
  // 다시 받는 동안에는 isError가 풀리므로 이 화면에서 받아 본 적이 있는지로 본다
  return queries.some((query) => query.data === undefined && query.isFetchedAfterMount) ? 'failed' : 'loading'
}

/**
 * C-01 홈(1A 최소판). 이번 달 합계, 계좌 잔액, 최근 거래를 구역마다 따로 받아 보인다.
 * 1A 임시: 이번 달 합계는 눌리지 않고 머리 줄에 화살표가 없다(월별 통계 E-01은 1B). 한 줄 입력, 숨긴 계좌, 연결이 없을 때의
 * "기준" 표시가 없다. 예산·진행 중 이벤트·확인할 거래는 2·3단계다.
 * 넓은 화면은 두 칸이다: 왼쪽에 합계와 계좌 잔액, 오른쪽에 최근 거래.
 */
export default function HomePage() {
  // 화면을 연 날의 오늘. 이번 달(기기의 오늘이 속한 달, planner 결정 2026-11-25)과 날짜 이름(올해인지)을 정한다
  const [openedOn] = useState(today)
  const month = monthOf(openedOn)
  const totals = useMonthTotals(month)
  const accounts = useAccounts()
  const categories = useCategories()
  const recent = useRecentTransactions()
  const message = useLoadingMessage()

  // 최근 거래의 줄은 계좌와 카테고리 이름이 있어야 그린다(내역과 같다)
  const recentQueries = [recent, accounts, categories]
  const states = {
    totals: stateOf([totals]),
    accounts: stateOf([accounts]),
    recent: stateOf(recentQueries),
  }
  const loading = Object.values(states).includes('loading')
  const skeletonShown = message !== undefined

  return (
    <MainScreen fullWidth>
      <h1 className={styles.title}>홈</h1>
      {/* 뼈대는 구역마다 있지만 화면 읽기에는 한 번만 알린다 */}
      <LoadingStatus message={loading ? message : undefined} />
      <div className={styles.home}>
        <div className={styles.column}>
          <MonthTotals
            label={`${formatMonth(month, openedOn)} 합계`}
            totals={totals.data}
            state={states.totals}
            queries={[totals]}
            skeletonShown={skeletonShown}
          />
          <AccountBalances
            accounts={accounts.data}
            state={states.accounts}
            queries={[accounts]}
            skeletonShown={skeletonShown}
          />
        </div>
        <div className={styles.column}>
          <RecentSection
            today={openedOn}
            recent={recent.data}
            accounts={accounts.data}
            categories={categories.data}
            state={states.recent}
            queries={recentQueries}
            skeletonShown={skeletonShown}
          />
        </div>
      </div>
    </MainScreen>
  )
}

interface SectionProps {
  state: SectionState
  queries: SectionQuery[]
  /** 뼈대를 보일 때가 됐는지(300ms, useLoadingMessage) */
  skeletonShown: boolean
}

/** 구역의 머리 줄: 제목(h2)과 오른쪽 끝의 동작 */
function SectionHead({ id, children, action }: { id: string; children: string; action?: ReactNode }) {
  return (
    <div className={`${styles.head} ${styles.inset}`}>
      <h2 id={id} className={styles.heading}>
        {children}
      </h2>
      {action}
    </div>
  )
}

/** 구역 안의 내용 자리. 머리 줄 아래 12px이다. */
function SectionBody({ children }: { children: ReactNode }) {
  return <div className={`${styles.body} ${styles.inset}`}>{children}</div>
}

/**
 * 구역을 불러오지 못했다. 00-common 4.3의 읽기 화면 문구와 "다시 시도"를 구역 안에 왼쪽 정렬로 작게 둔다(머리 줄은 남는다).
 * "다시 시도"는 이 구역이 기다리는 것 가운데 받지 못한 것만 다시 받는다.
 */
function SectionFailure({ queries }: { queries: SectionQuery[] }) {
  function retry() {
    queries.filter((query) => query.data === undefined).forEach((query) => void query.refetch())
  }
  return (
    <div className={styles.failure}>
      <p className={styles.failureTitle}>불러오지 못했어요.</p>
      <p className={styles.failureDescription}>잠시 후 다시 시도해 주세요.</p>
      <div className={styles.retry}>
        <Button kind="text" busy={queries.some((query) => query.isFetching)} onClick={retry}>
          다시 시도
        </Button>
      </div>
    </div>
  )
}

interface MonthTotalsProps extends SectionProps {
  /** 머리 줄 "{달}월 합계" */
  label: string
  totals: IncomeAndExpense | undefined
}

/** (2) 이번 달 합계(F-111). 지출만 큰 숫자이고 수입과 차액은 그 아래 줄이다(designer 결정 14). 1A에는 눌리지 않는다. */
function MonthTotals({ label, totals, state, queries, skeletonShown }: MonthTotalsProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <SectionHead id={headingId}>{label}</SectionHead>
      <SectionBody>
        {state === 'ready' && <Figures totals={totals!} />}
        {state === 'failed' && <SectionFailure queries={queries} />}
        {state === 'loading' && (
          <SkeletonSpace shown={skeletonShown}>
            <FiguresSkeleton />
          </SkeletonSpace>
        )}
      </SectionBody>
    </section>
  )
}

/**
 * 지출(큰 숫자), 수입, 차액. 수입이 0원이면 부호와 강조색 없이 "0원"이다(내역의 합계와 같다). 차액은 부호를 늘 붙인다.
 * 큰 숫자는 칸 폭을 넘으면 text-title로 내린다(L-12). 재지 않고 CSS로 고르도록 두 벌을 두고, 작은 짝은 화면 읽기에 숨긴다.
 */
function Figures({ totals }: { totals: IncomeAndExpense }) {
  return (
    <dl className={styles.summary}>
      <div className={styles.spending}>
        <dt className={styles.figureName}>지출</dt>
        <dd className={styles.hero}>
          <span className={styles.heroFallback} aria-hidden="true">
            <span className={styles.heroStrut} />
            <span className={styles.heroFallbackAmount}>
              <Amount kind="expense" value={totals.expense} />
            </span>
          </span>
          <span className={styles.heroAmount}>
            <Amount kind="expense" value={totals.expense} />
          </span>
        </dd>
      </div>
      <div className={styles.figure}>
        <dt className={styles.figureName}>수입</dt>
        <dd className={styles.figureAmount}>
          <Amount kind={totals.income > 0 ? 'income' : 'balance'} value={totals.income} />
        </dd>
      </div>
      <div className={styles.figure}>
        <dt className={styles.figureName}>차액</dt>
        <dd className={styles.figureAmount}>
          <Amount kind="difference" value={totals.income - totals.expense} />
        </dd>
      </div>
    </dl>
  )
}

/** 합계의 뼈대: 이름, 큰 숫자, 두 줄. 실제와 같은 CSS로 놓아 내용으로 바뀔 때 밀리지 않는다. */
function FiguresSkeleton() {
  return (
    <div className={styles.summary}>
      <div className={styles.spending}>
        <div className={styles.skeletonLine}>
          <SkeletonBar kind="name" text="label" />
        </div>
        <div className={styles.hero}>
          <SkeletonBar kind="name" text="hero" />
        </div>
      </div>
      {[0, 1].map((index) => (
        <div key={index} className={styles.figure}>
          <SkeletonBar kind="name" text="label" />
          <SkeletonBar kind="amount" text="body" />
        </div>
      ))}
    </div>
  )
}

interface AccountBalancesProps extends SectionProps {
  accounts: Account[] | undefined
}

/**
 * (5) 계좌 잔액 요약(F-112, P-220). 종류별 합계(계좌가 없는 종류는 숨김)와 선 아래 자산 합계.
 * 구역 전체가 계좌 목록(G-01)으로 가는 링크 하나다. 계좌 목록 화면과 같은 캐시를 쓴다.
 */
function AccountBalances({ accounts, state, queries, skeletonShown }: AccountBalancesProps) {
  const headingId = useId()
  if (state === 'ready' && accounts!.length > 0) {
    const total = sumOf(accounts!)
    return (
      <section aria-labelledby={headingId} className={`${styles.section} ${styles.linkSection}`}>
        <Link to="/accounts" className={styles.sectionLink} aria-label={`계좌 잔액, 자산 합계 ${wonOf(total)}`}>
          <div className={styles.head}>
            <h2 id={headingId} className={styles.heading}>
              계좌 잔액
            </h2>
            <span className={styles.caret}>
              <Icon name="CaretRight" size={20} />
            </span>
          </div>
          <Balances accounts={accounts!} total={total} />
        </Link>
      </section>
    )
  }
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <SectionHead id={headingId}>계좌 잔액</SectionHead>
      <SectionBody>
        {state === 'ready' && <p className={styles.none}>계좌가 없어요</p>}
        {state === 'failed' && <SectionFailure queries={queries} />}
        {state === 'loading' && (
          <SkeletonSpace shown={skeletonShown}>
            <BalancesSkeleton />
          </SkeletonSpace>
        )}
      </SectionBody>
    </section>
  )
}

function Balances({ accounts, total }: { accounts: Account[]; total: number }) {
  const groups = accountTypes
    .map((type) => accounts.filter((account) => account.type === type))
    .filter((group) => group.length > 0)
  return (
    <dl className={`${styles.body} ${styles.sums}`}>
      {groups.map((group) => (
        <div key={group[0].type} className={styles.balance}>
          <dt className={styles.balanceName}>{accountTypeNames[group[0].type]}</dt>
          <dd className={styles.balanceAmount}>
            <Amount kind="balance" value={sumOf(group)} />
          </dd>
        </div>
      ))}
      <div className={`${styles.balance} ${styles.assets}`}>
        <dt className={styles.balanceName}>자산 합계</dt>
        <dd className={styles.balanceAmount}>
          <Amount kind="balance" value={total} />
        </dd>
      </div>
    </dl>
  )
}

/** 계좌 잔액의 뼈대: 세 줄과 자산 합계(계좌 목록 뼈대와 같은 막대) */
function BalancesSkeleton() {
  return (
    <div className={styles.sums}>
      {[0, 1, 2].map((index) => (
        <div key={index} className={styles.balance}>
          <SkeletonBar kind="name" text="body" />
          <SkeletonBar kind="amount" text="body" />
        </div>
      ))}
      <div className={`${styles.balance} ${styles.assets}`}>
        <SkeletonBar kind="name" text="body" />
        <SkeletonBar kind="amount" text="body" />
      </div>
    </div>
  )
}

function sumOf(accounts: Account[]): number {
  return accounts.reduce((sum, { balance }) => sum + balance, 0)
}

/** 링크 이름에 넣는 금액. 화면의 잔액과 같은 글자다("-612,400원"). */
function wonOf(value: number): string {
  return `${formatAmount(Math.abs(value), value < 0)}원`
}

interface RecentSectionProps extends SectionProps {
  today: string
  recent: RecentTransactions | undefined
  accounts: Account[] | undefined
  categories: Parameters<typeof nameBookOf>[1] | undefined
}

/**
 * (7)~(9) 최근 거래(F-113). 장부 전체에서 가장 최근 10건을 내역과 같은 날짜 묶음 머리와 거래 줄로 보인다. 날짜 묶음 머리의
 * 합계는 그날 전체다(작성자 판단 41). 저장하고 돌아와도 줄을 강조하지 않는다(C-01에 없다).
 */
function RecentSection({ today, recent, accounts, categories, state, queries, skeletonShown }: RecentSectionProps) {
  const headingId = useId()
  const names = useMemo(
    () => accounts && categories && nameBookOf(accounts, categories),
    [accounts, categories],
  )
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <SectionHead id={headingId} action={<AllTransactionsLink />}>
        최근 거래
      </SectionHead>
      {state === 'ready' && <RecentList today={today} recent={recent!} names={names!} categories={categories!} />}
      {state === 'failed' && (
        <SectionBody>
          <SectionFailure queries={queries} />
        </SectionBody>
      )}
      {state === 'loading' && (
        <SkeletonSpace shown={skeletonShown}>
          <DayHeadSkeleton />
          <RowsSkeleton count={3} />
        </SkeletonSpace>
      )}
    </section>
  )
}

/** 머리 줄 오른쪽의 "모두 보기". 글자를 내용 오른쪽 선에 맞추고, 44px 누름 영역이 머리 줄 높이를 늘리지 않는다. */
function AllTransactionsLink() {
  return (
    <div className={styles.headAction}>
      <ButtonLink kind="text" to="/transactions">
        <span className={styles.actionLabel}>
          모두 보기
          <Icon name="CaretRight" size={20} />
        </span>
      </ButtonLink>
    </div>
  )
}

interface RecentListProps {
  today: string
  recent: RecentTransactions
  names: NameBook
  categories: Parameters<typeof nameBookOf>[1]
}

/**
 * 최근 거래의 줄. 이 기기에 쌓은 보내지 않은 입력을 같은 순서 규칙으로 섞어 위에서 10건을 보이고(C-01 (10), planner Q6),
 * 그날 합계에는 보이는 보내지 않음 줄을 더한다(planner Q5). 이번 달 합계와 계좌 잔액에는 더하지 않는다(작성자 판단 43).
 */
function RecentList({ today, recent, names, categories }: RecentListProps) {
  const pending = usePendingTransactions()
  const items = useMemo(() => {
    const rows = pending.flatMap((item) => pendingRow(item, categories) ?? [])
    return mergeRecent(recent.items, rows, today, RECENT_COUNT)
  }, [pending, categories, recent.items, today])
  const groups = useMemo(() => groupByDate(items), [items])
  const dayTotals = useMemo(
    () => withPendingDays(new Map(recent.days.map((day) => [day.date, day])), items),
    [recent.days, items],
  )
  if (groups.length === 0) return <NoTransactions />
  return (
    <div>
      {groups.map((group) => (
        <DayGroup
          key={group.date}
          date={group.date}
          today={today}
          total={dayTotals.get(group.date)}
          items={group.items}
          names={names}
          headingLevel={3}
        />
      ))}
    </div>
  )
}

/** 장부에 거래가 없다(00-common 4.2). 보기 전용에게는 할 수 없는 행동을 권하지 않는다. */
function NoTransactions() {
  const ledger = useCurrentLedger()
  return (
    <div className={styles.inset}>
      {canEdit(ledger) ? (
        <EmptyState description="거래를 입력하면 여기에 보여요">
          <ButtonLink kind="primary" to="/transactions/new" onClick={holdKeyboard}>
            거래 입력
          </ButtonLink>
        </EmptyState>
      ) : (
        <EmptyState description="아직 거래가 없어요" />
      )}
    </div>
  )
}
