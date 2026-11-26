import { useEffect, useRef, type ReactNode } from 'react'
import Amount from '../../components/Amount'
import { Button } from '../../components/Button'
import ErrorMessage from '../../components/ErrorMessage'
import { formatDate } from '../../lib/calendarDate'
import type { CompareRow, CompareValue } from './conflictValues'
import { detailOf, titleOf, type NameBook } from './listedText'
import type { ListedTransaction } from './transactions'
import styles from './ConflictPanel.module.css'

/*
 * 수정 충돌 안내(N-04)와 같은 거래를 다시 보낸 결과의 선택 판(ADR 006 결정 3)의 내용. 틀(바닥 시트, 가운데 창)은
 * DialogFrame이 그리고, 이 파일은 그 안을 그린다. 수정·상세·새 입력 화면의 조각에만 들어간다(첫 화면 묶음에 넣지 않는다).
 */

/** 실행하지 못한 까닭. 실패할 때마다 count를 올린다. 같은 문구여도 다시 알리고 초점을 실행 버튼으로 옮긴다. */
export interface PanelFailure {
  message: string
  count: number
}

interface PanelAction {
  label: string
  /** 삭제를 다시 하는 버튼만 위험 색이다(N-04 (7), 작성자 판단 71) */
  kind: 'primary' | 'danger'
  onClick: () => void
  /** 연결이 없어 누를 수 없다. 이유는 notice로 보인다 */
  disabled?: boolean
}

interface ConflictPanelProps {
  /** 제목 아래의 보조 글자 */
  description: string
  children: ReactNode
  /** 왼쪽의 보조 버튼 */
  closeLabel: string
  onCloseAction: () => void
  /** 오른쪽의 주 버튼. 없으면 숨긴다(최신 거래가 휴지통에 있음) */
  action?: PanelAction
  /** 주 버튼으로 보내는 중. 그 버튼 안에 돌아가는 원, 두 버튼은 비활성이다 */
  busy?: boolean
  /** 버튼 바로 위의 한 줄(비활성인 이유, 누르면 일어날 일) */
  notice?: string
  /** 버튼 바로 위의 실패 문구(00-common 4.3) */
  failure?: PanelFailure
  /** 처음, 그리고 redraws가 바뀔 때 초점을 둘 버튼. 주 버튼이 없으면 보조 버튼이다 */
  focus: 'action' | 'close'
  /** 새 최신 내용으로 다시 그린 횟수. 바뀌면 처음과 같이 초점을 옮긴다 */
  redraws?: number
}

export default function ConflictPanel({
  description,
  children,
  closeLabel,
  onCloseAction,
  action,
  busy = false,
  notice,
  failure,
  focus,
  redraws = 0,
}: ConflictPanelProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const actionButton = useRef<HTMLButtonElement>(null)
  const target = focus === 'action' && action ? actionButton : closeButton

  // 처음, 그리고 새 최신 내용으로 다시 그릴 때. 손가락이나 Safari의 마우스로 누른 버튼은 초점을 받지 않으므로 늘 옮긴다
  useEffect(() => {
    target.current?.focus()
  }, [target, redraws])

  // 실패마다 실행 버튼("다시 시도")으로 옮긴다(5.6, designer #239 D1)
  useEffect(() => {
    if (failure) (actionButton.current ?? closeButton.current)?.focus()
  }, [failure])

  return (
    <>
      <p className={styles.description}>{description}</p>
      {children}
      {notice && <p className={styles.notice}>{notice}</p>}
      {failure && (
        <div key={failure.count} className={styles.failure}>
          <ErrorMessage role="alert">{failure.message}</ErrorMessage>
        </div>
      )}
      <div className={styles.actions}>
        <div>
          <Button ref={closeButton} kind="secondary" disabled={busy} onClick={onCloseAction}>
            {closeLabel}
          </Button>
        </div>
        {action && (
          <div>
            <Button
              ref={actionButton}
              kind={action.kind}
              busy={busy}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          </div>
        )}
      </div>
    </>
  )
}

interface ConflictCompareProps {
  /** 왼쪽 열의 이름. 수정 충돌은 "최신 내용", 선택 판은 "저장된 내용"이다 */
  latestLabel: string
  rows: CompareRow[]
}

const amountKinds = { EXPENSE: 'expense', INCOME: 'income', TRANSFER: 'transfer' } as const

/**
 * N-04 (2): 두 열(왼쪽 최신 내용, 오른쪽 내 입력)에 두 값이 다른 항목만 줄로 보인다. 항목 이름은 줄 위 한 줄이다.
 * 값마다 앞에 열 이름이 있어 화면 읽기는 어느 열인지 읽는다. 글자를 키워 값 자리가 좁아지면 두 값을 위아래로 쌓고
 * 열 이름을 값 위에 보인다(designer #239 D3).
 */
export function ConflictCompare({ latestLabel, rows }: ConflictCompareProps) {
  return (
    <div className={styles.compare}>
      <p className={styles.columns} aria-hidden="true">
        <span>{latestLabel}</span>
        <span>내 입력</span>
      </p>
      <dl className={styles.rows}>
        {rows.map((row) => (
          <div key={row.field} className={styles.row}>
            <dt className={styles.name}>{row.name}</dt>
            <CompareCell label={latestLabel} value={row.latest} memo={row.field === 'memo'} />
            <CompareCell label="내 입력" value={row.mine} memo={row.field === 'memo'} />
          </div>
        ))}
      </dl>
    </div>
  )
}

function CompareCell({ label, value, memo }: { label: string; value: CompareValue; memo: boolean }) {
  const amount = value.kind === 'amount'
  const className = [styles.value, amount && styles.amountValue, memo && styles.memo].filter(Boolean).join(' ')
  return (
    <dd className={className}>
      <span className={styles.label}>{label}</span>{' '}
      <span className={styles.text}>
        {amount ? <Amount kind={amountKinds[value.type]} value={value.value} /> : value.text}
      </span>
    </dd>
  )
}

/** 최신 거래가 휴지통에 있을 때 비교 자리의 문장(designer #239, 같은 계정의 다른 기기) */
export function DeletedElsewhere() {
  return <p className={styles.sentence}>다른 기기에서 이 거래를 삭제했어요</p>
}

interface LatestRowProps {
  transaction: ListedTransaction
  names: NameBook
  today: string
}

/**
 * N-04 (5) 최신 거래 줄. 거래 줄 구성(0.4, F-215)과 같다: 첫 줄 날짜, 시각, 제목, 둘째 줄 보조 글자(카테고리 · 계좌,
 * 이체는 "{보내는 계좌}에서 {받는 계좌}로"), 오른쪽 끝 금액. 누르는 줄이 아니다.
 */
export function LatestRow({ transaction, names, today }: LatestRowProps) {
  const { occurredOn, occurredTime, type, amount, status } = transaction
  const when = occurredTime === null ? formatDate(occurredOn, today) : `${formatDate(occurredOn, today)} ${occurredTime}`
  const detail = detailOf(transaction, names)
  return (
    <div className={styles.latest}>
      <div className={styles.latestBody}>
        <p className={styles.latestFirst}>{`${when} ${titleOf(transaction, names)}`}</p>
        {detail && <p className={styles.latestDetail}>{detail}</p>}
      </div>
      <p className={styles.latestAmount}>
        <Amount kind={amountKinds[type]} value={amount} canceled={status === 'CANCELED'} />
      </p>
    </div>
  )
}

/** N-04 (6) 다시 할지 묻는 문장 */
export function AgainQuestion({ children }: { children: string }) {
  return <p className={styles.sentence}>{children}</p>
}

