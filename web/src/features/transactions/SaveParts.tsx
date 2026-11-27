import type { MouseEvent, ReactNode } from 'react'
import DialogFrame from '../../components/DialogFrame'
import RetryMessage from '../../components/RetryMessage'
import ConflictPanel, { ConflictCompare, DeletedElsewhere } from './ConflictPanel'
import { compareRows } from './conflictValues'
import { QUEUE_FAILED } from './pendingTransactions'
import type { TransactionType } from './transactions'
import {
  CHOICE_DESCRIPTION,
  CHOICE_TITLE,
  KEPT_NOTICE,
  SAVE_FAILED,
  SAVE_OFFLINE,
  type Choice,
  type NewTransactionSave,
} from './useNewTransactionSave'
import type { TransactionForm } from './useTransactionForm'

/* 새 거래 저장(useNewTransactionSave)의 화면 부품: 저장 버튼 위의 실패 문구와 선택 판. D-04 새 입력과 D-05가 같이 쓴다 */

interface SaveFailureMessagesProps {
  save: NewTransactionSave
  /** "저장된 거래 보기"를 누름. 화면이 떠나는 길을 정한다 */
  onViewSaved: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
}

/** 저장 버튼 바로 위의 실패 문구(00-common 4.3). 초점은 옮기지 않는다. 문구는 role="alert"로 읽힌다 */
export function SaveFailureMessages({ save, onViewSaved }: SaveFailureMessagesProps) {
  const { failure, failures, messageBusy, saveBusy, online } = save
  if (!failure) return null
  if (failure.kind === 'retry') {
    return (
      <RetryMessage failures={failures} onRetry={save.retry} busy={messageBusy} disabled={saveBusy}>
        {SAVE_FAILED}
      </RetryMessage>
    )
  }
  if (failure.kind === 'not-queued') {
    return (
      <RetryMessage failures={failures} onRetry={save.retry} busy={messageBusy} disabled={saveBusy || !online}>
        {QUEUE_FAILED}
      </RetryMessage>
    )
  }
  if (failure.kind === 'saved-differently') {
    const path = `/transactions/${failure.savedId}`
    return (
      <RetryMessage
        failures={failures}
        to={path}
        actionLabel="저장된 거래 보기"
        onClick={(event) => onViewSaved(event, path)}
      >
        앞서 저장한 거래와 내용이 달라 저장하지 못했어요. 내역에서 확인해 주세요.
      </RetryMessage>
    )
  }
  return (
    <RetryMessage
      failures={failures}
      onRetry={save.saveAsNew}
      actionLabel="새 거래로 저장"
      busy={messageBusy}
      disabled={saveBusy}
    >
      문제가 생겨 저장하지 못했어요. 새 거래로 저장해 주세요.
    </RetryMessage>
  )
}

interface SaveChoiceDialogProps {
  save: NewTransactionSave
  form: TransactionForm
}

/** 판 바깥, 끌어내리기, X, Esc로 닫으면 입력으로 돌아가 입력을 둔다. 다시 저장하면 다시 이 판이다 */
export function SaveChoiceDialog({ save, form }: SaveChoiceDialogProps) {
  const { choice, lists, choiceBusy, online } = save
  return (
    <DialogFrame open={save.choiceOpen} title={CHOICE_TITLE} busy={choiceBusy} titleFocusable onClose={save.closeChoice}>
      {choice && lists && (
        <ChoiceContent
          choice={choice}
          mineType={form.effective.type}
          busy={choiceBusy}
          online={online}
          onKeep={() => save.keepSaved(choice.current)}
          onFix={() => save.fixSaved(choice.current)}
          onSaveAsNew={save.saveChosenAsNew}
        >
          {choice.current.deletedAt === null ? (
            <ConflictCompare
              latestLabel="저장된 내용"
              rows={compareRows(lists.valuesOf(choice.current), form.effective, lists.names, choice.today)}
            />
          ) : (
            <DeletedElsewhere />
          )}
        </ChoiceContent>
      )}
    </DialogFrame>
  )
}

interface ChoiceContentProps {
  choice: Choice
  /** 내 입력의 유형 */
  mineType: TransactionType
  busy: boolean
  online: boolean
  onKeep: () => void
  onFix: () => void
  onSaveAsNew: () => void
  /** 비교 자리 */
  children: ReactNode
}

/**
 * 선택 판의 버튼(designer #239). 유형이 같으면 주 버튼 "내 입력으로 고치기"(연결이 없는 동안 비활성), 다르면 "새 거래로 저장"과
 * 그 위의 "저장된 거래는 그대로 남아요"다. 보조 버튼은 늘 "저장된 내용 그대로"다. 처음 초점은 판 제목이다(designer #239).
 * 저장된 거래가 그사이 휴지통으로 갔으면 주 버튼을 숨긴다. 실패한 뒤의 주 버튼은 "다시 시도"다.
 */
function ChoiceContent({ choice, mineType, busy, online, onKeep, onFix, onSaveAsNew, children }: ChoiceContentProps) {
  const { current, failure, redraws } = choice
  const sameType = current.type === mineType
  const again = failure ? '다시 시도' : undefined
  const action =
    current.deletedAt !== null
      ? undefined
      : sameType
        ? { label: again ?? '내 입력으로 고치기', kind: 'primary' as const, onClick: onFix, disabled: !online }
        : { label: again ?? '새 거래로 저장', kind: 'primary' as const, onClick: onSaveAsNew }
  // 연결이 없어 누를 수 없는 이유는 실패 문구가 없을 때만 보인다. 유형이 다르면 먼저 저장된 거래가 남는다는 것을 알린다
  const notice = !action ? undefined : !sameType ? KEPT_NOTICE : !online && !failure ? SAVE_OFFLINE : undefined
  return (
    <ConflictPanel
      description={CHOICE_DESCRIPTION}
      closeLabel="저장된 내용 그대로"
      onCloseAction={onKeep}
      action={action}
      busy={busy}
      notice={notice}
      failure={failure}
      redraws={redraws}
    >
      {children}
    </ConflictPanel>
  )
}
