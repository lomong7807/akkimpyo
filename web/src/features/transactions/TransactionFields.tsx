import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import AmountField from '../../components/AmountField'
import { Button } from '../../components/Button'
import DateField from '../../components/DateField'
import Icon from '../../components/Icon'
import SegmentedChoice from '../../components/SegmentedChoice'
import TextAreaField from '../../components/TextAreaField'
import { TextField } from '../../components/TextField'
import TimeField from '../../components/TimeField'
import { useCategories } from '../categories/useCategories'
import { categoryKindOf } from './formDefaults'
import { AccountField, CategoryField } from './TransactionPickers'
import { MEMO_MAX, memoLength, PAYEE_MAX, payeeLength, typeChange, type TransactionField } from './transactionForm'
import type { TransactionType } from './transactions'
import type { TransactionForm } from './useTransactionForm'
import styles from './TransactionNew.module.css'

const typeOptions: { value: TransactionType; label: string }[] = [
  { value: 'EXPENSE', label: '지출' },
  { value: 'INCOME', label: '수입' },
  { value: 'TRANSFER', label: '이체' },
]

/** 계좌 칸의 이름(D-04 (6), (17)) */
const accountLabels: Record<TransactionType, string> = { EXPENSE: '계좌', INCOME: '들어온 계좌', TRANSFER: '보내는 계좌' }

interface TransactionFieldsProps {
  form: TransactionForm
  /** 보내는 중이라 바꿀 수 없다 */
  readOnly: boolean
  /** "더 보기"를 펼쳤다 */
  moreOpen: boolean
  onMoreOpenChange: (open: boolean) => void
}

/** 엔터를 그 칸의 동작으로 받는지. 한글을 조합하는 중과 Ctrl·Cmd를 함께 누른 저장은 빼고 본다. */
function isPlainEnter(event: KeyboardEvent): boolean {
  const composing = event.nativeEvent.isComposing || event.keyCode === 229
  return event.key === 'Enter' && !composing && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
}

/** D-04 새 입력의 칸(유형, 금액, 가맹점/내용, 카테고리, 계좌, 날짜, 더 보기 아래의 시각과 메모) */
export default function TransactionFields({ form, readOnly, moreOpen, onMoreOpenChange }: TransactionFieldsProps) {
  const { values, effective, change, control, check } = form
  const categories = useCategories()
  const transfer = values.type === 'TRANSFER'
  const foldedId = useId()
  const amount = useRef<HTMLInputElement>(null)

  // 새 입력은 열리면 금액에 초점을 둔다. 빠른 입력이 누르는 순간 올려 둔 화면 키보드가 이어진다
  useEffect(() => amount.current?.focus(), [])

  /**
   * 고르는 칸은 고르면 바로 검사한다. 받는 계좌는 보내는 계좌와 같은지 고르는 즉시 본다(D-04 (18)). 받는 계좌를 고른 뒤
   * 보내는 계좌를 바꿔도 같다.
   */
  function picked(field: TransactionField, value: string) {
    const check: TransactionField[] = [field]
    if (transfer && field === 'accountId' && values.toAccountId !== '') check.push('toAccountId')
    change({ [field]: value }, { check })
  }

  function changeType(type: TransactionType) {
    change(typeChange(values, type, (id) => categoryKindOf(categories.data, id)))
  }

  // 금액에서 엔터는 다음 칸(지출·수입은 가맹점/내용, 이체는 보내는 계좌)으로 간다(D-04 키보드 흐름)
  function handleAmountKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isPlainEnter(event)) return
    event.preventDefault()
    const form = event.currentTarget.form
    const next = form?.querySelector<HTMLElement>(transfer ? '[data-field="accountId"]' : '[data-field="payee"]')
    next?.focus()
  }

  // 가맹점/내용의 엔터는 양식을 보내 저장한다. 한글을 조합하는 중의 엔터는 글자를 끝낼 뿐이다
  function handlePayeeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229
    if (event.key === 'Enter' && composing) event.preventDefault()
  }

  const { error: accountError, ref: accountRef } = control('accountId')
  const { error: toAccountError, ref: toAccountRef } = control('toAccountId')
  const { error: categoryError, ref: categoryRef } = control('categoryId')

  return (
    <>
      <SegmentedChoice label="유형" options={typeOptions} value={values.type} onChange={changeType} readOnly={readOnly} />
      <AmountField
        {...control('amount')}
        ref={(element) => {
          control('amount').ref(element)
          amount.current = element
        }}
        label="금액"
        size="title"
        readOnly={readOnly}
        onChange={(amount) => change({ amount })}
        onBlur={() => check('amount')}
        onKeyDown={handleAmountKeyDown}
      />
      {!transfer && (
        <>
          <TextField
            {...control('payee')}
            data-field="payee"
            label="가맹점/내용"
            optional
            placeholder="예: 올래국수"
            enterKeyHint="done"
            autoComplete="off"
            readOnly={readOnly}
            count={{ current: payeeLength(values.payee), max: PAYEE_MAX }}
            onChange={(event) => change({ payee: event.target.value })}
            onBlur={() => check('payee')}
            onKeyDown={handlePayeeKeyDown}
          />
          <CategoryField
            ref={categoryRef}
            kind={values.type === 'INCOME' ? 'INCOME' : 'EXPENSE'}
            value={values.categoryId}
            error={categoryError}
            readOnly={readOnly}
            onChange={(categoryId) => picked('categoryId', categoryId)}
          />
        </>
      )}
      <AccountField
        ref={(element) => {
          accountRef(element)
          element?.setAttribute('data-field', 'accountId')
        }}
        label={accountLabels[values.type]}
        value={effective.accountId}
        error={accountError}
        readOnly={readOnly}
        onChange={(accountId) => {
          if (accountId !== effective.accountId) picked('accountId', accountId)
        }}
      />
      {transfer && (
        <AccountField
          ref={toAccountRef}
          label="받는 계좌"
          help="카드대금 납부는 은행 계좌에서 카드 계좌로 이체해 입력해요. 지출로 넣으면 두 번 계산돼요."
          value={values.toAccountId}
          error={toAccountError}
          readOnly={readOnly}
          onChange={(toAccountId) => picked('toAccountId', toAccountId)}
        />
      )}
      <DateField
        {...control('occurredOn')}
        label="날짜"
        readOnly={readOnly}
        onChange={(occurredOn) => change({ occurredOn })}
      />
      <div className={styles.more}>
        <Button
          kind="text"
          aria-expanded={moreOpen}
          aria-controls={foldedId}
          onClick={() => onMoreOpenChange(!moreOpen)}
        >
          <span className={styles.moreLabel}>
            더 보기
            <Icon name={moreOpen ? 'CaretUp' : 'CaretDown'} size={20} />
          </span>
        </Button>
      </div>
      {/* 접혀 있어도 값은 남고 저장된다 */}
      <div id={foldedId} hidden={!moreOpen} className={styles.folded}>
        <TimeField
          {...control('occurredTime')}
          label="시각"
          optional
          readOnly={readOnly}
          onChange={(occurredTime) => change({ occurredTime })}
          onBlur={() => check('occurredTime')}
        />
        <TextAreaField
          {...control('memo')}
          label="메모"
          optional
          readOnly={readOnly}
          count={{ current: memoLength(values.memo), max: MEMO_MAX }}
          onChange={(event) => change({ memo: event.target.value })}
          onBlur={() => check('memo')}
        />
      </div>
    </>
  )
}
