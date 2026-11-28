import { useId } from 'react'
import Amount from '../../components/Amount'
import { totalKind } from '../../components/amountDisplay'
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
  /** 넓은 화면 오른쪽 칸에 상세를 연 거래 id(D-01 (13)). 지금 것으로 표시하고 면 색으로 칠한다 */
  selected?: string
  /** 줄을 눌러도 스크롤을 맨 위로 옮기지 않는다. 목록이 그대로 남는 두 칸 화면이 쓴다 */
  preventScrollReset?: boolean
  /** 날짜 머리의 제목 단계. 화면 이름(h1) 바로 아래면 2, 구역 제목(h2) 아래면 3이다. 모양은 같다. */
  headingLevel: 2 | 3
}

export function DayGroup(props: DayGroupProps) {
  const { date, today, total, items, names, highlighted, selected, preventScrollReset, headingLevel } = props
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
              selected={item.id === selected}
              preventScrollReset={preventScrollReset}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * 그날 합계(0.5). 지출만이면 지출, 수입만이면 수입, 둘 다면 수입과 지출, 둘 다 0이면 비운다. 환불만 있는 날의 음수 합계도
 * 0이 아니라 보이고, 본문 글자색과 "-"다(totalKind, #390).
 */
function DaySums({ total }: { total: DayTotal }) {
  if (total.income === 0 && total.expense === 0) return null
  return (
    <dl className={styles.daySums}>
      {total.income !== 0 && (
        <div className={styles.daySum}>
          <dt className={styles.daySumName}>수입</dt>
          <dd className={styles.daySumAmount}>
            <Amount kind={totalKind('income', total.income)} value={total.income} />
          </dd>
        </div>
      )}
      {total.expense !== 0 && (
        <div className={styles.daySum}>
          <dt className={styles.daySumName}>지출</dt>
          <dd className={styles.daySumAmount}>
            <Amount kind={totalKind('expense', total.expense)} value={total.expense} />
          </dd>
        </div>
      )}
    </dl>
  )
}

const amountKinds = { EXPENSE: 'expense', INCOME: 'income', TRANSFER: 'transfer' } as const

/** 환불 구분의 칩 글자(00-common 2.2, 판단 7) */
const refundChips = { REFUND: '환불', REIMBURSEMENT: '돌려받음' } as const

interface TransactionRowProps {
  transaction: ShownTransaction
  names: NameBook
  /** 날짜 묶음 머리의 id. 링크 이름에 날짜를 넣는다. */
  dateId: string
  highlighted: boolean
  selected: boolean
  preventScrollReset: boolean | undefined
}

/**
 * 거래 줄(0.4). 줄 전체가 상세로 가는 링크다. 링크 이름은 aria-labelledby로 제목 전체, 금액, 날짜(묶음 머리), 시각,
 * 둘째 줄, 상태를 차례로 잇는다. 말줄임으로 잘린 제목도 화면 읽기에는 다 읽힌다.
 * 기기에 쌓여 아직 서버에 없는 줄은 셋째 줄에 표시 칩 "보내지 않음"을 붙이고(C-01 (10), D-01 (11)), 서버가 거부한 줄은 그 자리에
 * 오류 칩 "보낼 수 없음"을 붙인다(D-01 (11), designer #235 Q2). 칩은 "취소"와 같은 자리다(0.4, designer #234 B). 이 줄은 서버에
 * 없어 상세를 열 수 없으므로 누르면 보내지 않은 입력 목록(B-05)으로 간다(0.4, C-01 (10), 작성자 판단 42, #236).
 * 제목과 둘째 줄은 한 덩어리(lead)다. 휴대폰 배치는 둘째 줄이 금액 아래로 내려가고, 넓은 화면 내역은 제목 옆에 둔다(D-01 넓은 화면).
 * 환불·돌려받음 지출은 수입과 같은 강조색과 "+"이고 칩 글자로 수입과 구분한다(00-common 2.2, 판단 7, #395). 칩이 여럿이면
 * 0.4의 순서(보내지 않음·보낼 수 없음, 취소, 환불·돌려받음)로 한 자리에 놓는다.
 */
function TransactionRow({ transaction, names, dateId, highlighted, selected, preventScrollReset }: TransactionRowProps) {
  const id = useId()
  const title = titleOf(transaction, names)
  const detail = detailOf(transaction, names)
  const time = transaction.occurredTime
  const canceled = transaction.status === 'CANCELED'
  const refund = transaction.type === 'TRANSFER' || !transaction.refundKind ? undefined : refundChips[transaction.refundKind]
  const chips = [
    transaction.pending &&
      (transaction.rejected ? (
        <StatusChip key="pending" danger>
          보낼 수 없음
        </StatusChip>
      ) : (
        <StatusChip key="pending">보내지 않음</StatusChip>
      )),
    canceled && <StatusChip key="canceled">취소</StatusChip>,
    refund && <StatusChip key="refund">{refund}</StatusChip>,
  ].filter(Boolean)
  const labelledBy = [
    `${id}-title`,
    `${id}-amount`,
    dateId,
    time && `${id}-time`,
    detail && `${id}-detail`,
    chips.length > 0 && `${id}-status`,
  ]
    .filter(Boolean)
    .join(' ')

  const className = highlighted || selected ? `${styles.row} ${styles.highlighted}` : styles.row
  const content = (
    <>
      <span id={`${id}-time`} className={`${styles.time} tabular-nums`}>
        {time ?? ''}
      </span>
      <span className={styles.body}>
        <span className={styles.first}>
          <span className={styles.lead}>
            <span id={`${id}-title`} className={styles.title}>
              {title}
            </span>
            {detail && (
              <span id={`${id}-detail`} className={styles.detail}>
                {detail}
              </span>
            )}
          </span>
          <span id={`${id}-amount`} className={styles.amount}>
            <Amount kind={refund ? 'income' : amountKinds[transaction.type]} value={transaction.amount} canceled={canceled} />
          </span>
        </span>
        {chips.length > 0 && (
          <span id={`${id}-status`} className={styles.status}>
            {chips}
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
        aria-current={selected ? 'page' : undefined}
        preventScrollReset={preventScrollReset}
      >
        {content}
      </Link>
    </li>
  )
}
