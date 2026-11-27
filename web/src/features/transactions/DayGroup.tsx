import { useId } from 'react'
import Amount from '../../components/Amount'
import { Link } from '../../components/Link'
import StatusChip from '../../components/StatusChip'
import { formatDate } from '../../lib/calendarDate'
import { PENDING_PATH } from '../sync/useSyncState'
import { detailOf, titleOf, type NameBook } from './listedText'
import type { ShownTransaction } from './pendingTransactions'
import type { DayTotal } from './transactions'
import styles from './TransactionList.module.css'

/*
 * 날짜 묶음 머리(0.5)와 거래 줄(0.4). 내역(D-01)과 홈의 최근 거래(C-01)가 같은 것을 쓴다.
 * 줄의 좌우 여백은 놓는 곳이 CSS 변수 --row-inset으로 바꾼다(기본 16px, 넓은 화면 홈은 0).
 */

interface DayGroupProps {
  date: string
  today: string
  /** 서버가 준 그날 전체 합계(보이는 보내지 않음 줄을 더한 것) */
  total: DayTotal | undefined
  items: ShownTransaction[]
  names: NameBook
  /** 강조할 거래 id */
  highlighted?: string
  /** 날짜 머리의 제목 단계. 화면 이름(h1) 바로 아래면 2, 구역 제목(h2) 아래면 3이다. 모양은 같다. */
  headingLevel: 2 | 3
}

export function DayGroup({ date, today, total, items, names, highlighted, headingLevel }: DayGroupProps) {
  const headingId = useId()
  const Heading = `h${headingLevel}` as const
  return (
    <div>
      <div className={styles.dayHead}>
        <Heading id={headingId} className={styles.date}>
          {formatDate(date, today)}
        </Heading>
        {total && <DaySums total={total} />}
      </div>
      {/* Safari는 점을 없앤 목록을 목록으로 알리지 않으므로 role을 적는다. 줄이 없으면(달력의 빈 날) 목록을 두지 않는다 */}
      {items.length > 0 && (
        <ul role="list" aria-labelledby={headingId} className={styles.rows}>
          {items.map((item) => (
            <TransactionRow
              key={item.id}
              transaction={item}
              names={names}
              dateId={headingId}
              highlighted={item.id === highlighted}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** 그날 합계(0.5). 지출만이면 지출, 수입만이면 수입, 둘 다면 수입과 지출, 둘 다 0이면 비운다. */
function DaySums({ total }: { total: DayTotal }) {
  if (total.income === 0 && total.expense === 0) return null
  return (
    <dl className={styles.daySums}>
      {total.income > 0 && (
        <div className={styles.daySum}>
          <dt className={styles.daySumName}>수입</dt>
          <dd className={styles.daySumAmount}>
            <Amount kind="income" value={total.income} />
          </dd>
        </div>
      )}
      {total.expense > 0 && (
        <div className={styles.daySum}>
          <dt className={styles.daySumName}>지출</dt>
          <dd className={styles.daySumAmount}>
            <Amount kind="expense" value={total.expense} />
          </dd>
        </div>
      )}
    </dl>
  )
}

const amountKinds = { EXPENSE: 'expense', INCOME: 'income', TRANSFER: 'transfer' } as const

interface TransactionRowProps {
  transaction: ShownTransaction
  names: NameBook
  /** 날짜 묶음 머리의 id. 링크 이름에 날짜를 넣는다. */
  dateId: string
  highlighted: boolean
}

/**
 * 거래 줄(0.4). 줄 전체가 상세로 가는 링크다. 링크 이름은 aria-labelledby로 제목 전체, 금액, 날짜(묶음 머리), 시각,
 * 둘째 줄, 상태를 차례로 잇는다. 말줄임으로 잘린 제목도 화면 읽기에는 다 읽힌다.
 * 기기에 쌓여 아직 서버에 없는 줄은 셋째 줄에 표시 칩 "보내지 않음"을 붙이고(C-01 (10), D-01 (11)), 서버가 거부한 줄은 그 자리에
 * 오류 칩 "보낼 수 없음"을 붙인다(D-01 (11), designer #235 Q2). 칩은 "취소"와 같은 자리다(0.4, designer #234 B). 이 줄은 서버에
 * 없어 상세를 열 수 없으므로 누르면 보내지 않은 입력 목록(B-05)으로 간다(0.4, C-01 (10), 작성자 판단 42, #236).
 */
function TransactionRow({ transaction, names, dateId, highlighted }: TransactionRowProps) {
  const id = useId()
  const title = titleOf(transaction, names)
  const detail = detailOf(transaction, names)
  const time = transaction.occurredTime
  const canceled = transaction.status === 'CANCELED'
  const labelledBy = [
    `${id}-title`,
    `${id}-amount`,
    dateId,
    time && `${id}-time`,
    detail && `${id}-detail`,
    (canceled || transaction.pending) && `${id}-status`,
  ]
    .filter(Boolean)
    .join(' ')

  const className = highlighted ? `${styles.row} ${styles.highlighted}` : styles.row
  const content = (
    <>
      <span id={`${id}-time`} className={`${styles.time} tabular-nums`}>
        {time ?? ''}
      </span>
      <span className={styles.body}>
        <span className={styles.first}>
          <span id={`${id}-title`} className={styles.title}>
            {title}
          </span>
          <span id={`${id}-amount`} className={styles.amount}>
            <Amount kind={amountKinds[transaction.type]} value={transaction.amount} canceled={canceled} />
          </span>
        </span>
        {detail && (
          <span id={`${id}-detail`} className={styles.detail}>
            {detail}
          </span>
        )}
        {canceled && (
          <span id={`${id}-status`} className={styles.status}>
            <StatusChip>취소</StatusChip>
          </span>
        )}
        {transaction.pending && (
          <span id={`${id}-status`} className={styles.status}>
            {transaction.rejected ? <StatusChip danger>보낼 수 없음</StatusChip> : <StatusChip>보내지 않음</StatusChip>}
          </span>
        )}
      </span>
    </>
  )
  return (
    <li>
      <Link
        to={transaction.pending ? PENDING_PATH : `/transactions/${transaction.id}`}
        className={className}
        aria-labelledby={labelledBy}
      >
        {content}
      </Link>
    </li>
  )
}
