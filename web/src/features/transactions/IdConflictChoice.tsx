import DialogFrame from '../../components/DialogFrame'
import type { ChoiceLists } from './choiceLists'
import ConflictPanel, { ConflictCompare, DeletedElsewhere, type PanelFailure } from './ConflictPanel'
import { compareRows } from './conflictValues'
import type { TransactionValues } from './transactionForm'
import type { TransactionDetail } from './transactions'

/*
 * 같은 거래를 다시 보낸 결과의 선택 판(ADR 006 결정 3, N-04 모양, #239). 거래 입력·한 줄 입력의 저장(useNewTransactionSave, #239)과
 * 보내지 않은 입력 목록(B-05)의 "비교해서 고르기"(#280)가 같이 쓴다. 문구는 designer #239·#102이고 화면에 "서버"라는 말을 쓰지 않는다.
 * 판은 그리기만 하고 고른 뒤의 일은 부른 쪽이 한다.
 */

export const CHOICE_TITLE = '이미 저장된 거래가 있어요'
export const CHOICE_DESCRIPTION = '먼저 저장된 내용과 지금 입력이 달라요. 어느 쪽으로 할지 골라 주세요.'
/** 같은 id로 다시 보낸 거래가 이미 고쳐졌거나 휴지통·취소였을 때(200, ADR 006 결정 3)의 토스트(designer #239) */
export const RESEND_NOTICE = '이미 저장된 거래라 저장된 내용으로 두었어요'
/** "저장된 내용 그대로"를 고른 뒤의 토스트 */
export const KEPT_TOAST = '저장된 내용으로 두었어요'
/** 유형이 달라 "새 거래로 저장"일 때 주 버튼 위의 안내 */
export const KEPT_NOTICE = '저장된 거래는 그대로 남아요'
/* 판의 실패와 비활성 문구는 D-04 저장의 것을 쓴다(designer #239 D1) */
export const SAVE_FAILED = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
export const SAVE_LOST = '연결이 끊겨 저장하지 못했어요. 연결되면 다시 시도해 주세요.'
export const SAVE_OFFLINE = '연결되면 저장할 수 있어요'

/** 판의 실패. `on`이 'keep'이면 "저장된 내용 그대로"의 실패라 주 버튼 글자를 바꾸지 않고 초점을 그 버튼에 둔다(designer #280 D3) */
export type ChoiceFailure = PanelFailure & { on?: 'keep' }

/** 판에 보이는 저장된 거래와 그 판의 실패 */
export interface Choice {
  current: TransactionDetail
  /** 판을 연 때의 기기의 오늘 */
  today: string
  /** 새 저장된 내용으로 다시 그린 횟수 */
  redraws: number
  failure?: ChoiceFailure
}

/** 처리 중인 버튼. 'action'은 주 버튼, 'keep'은 "저장된 내용 그대로"다 */
export type ChoiceBusy = 'action' | 'keep' | false

interface IdConflictChoiceProps {
  open: boolean
  /** 판의 내용. 닫히는 움직임 동안에도 남긴다 */
  choice: Choice | undefined
  /** 내 입력. 검사에 맞은 값이다 */
  mine: TransactionValues
  lists: ChoiceLists | undefined
  busy: ChoiceBusy
  online: boolean
  /** 판 바깥, 끌어내리기, X, Esc. 처리 중에는 부르지 않는다 */
  onClose: () => void
  onKeep: () => void
  onFix: () => void
  onSaveAsNew: () => void
}

/**
 * 선택 판(designer #239). 유형이 같으면 주 버튼 "내 입력으로 고치기"(연결이 없는 동안 비활성), 다르면 "새 거래로 저장"과
 * 그 위의 "저장된 거래는 그대로 남아요"다. 보조 버튼은 늘 "저장된 내용 그대로"다. 처음 초점은 판 제목이다(designer #239).
 * 저장된 거래가 그사이 휴지통으로 갔으면 주 버튼을 숨긴다. 주 버튼이 실패한 뒤의 글자는 "다시 시도"다.
 */
export default function IdConflictChoice({
  open,
  choice,
  mine,
  lists,
  busy,
  online,
  onClose,
  onKeep,
  onFix,
  onSaveAsNew,
}: IdConflictChoiceProps) {
  return (
    <DialogFrame open={open} title={CHOICE_TITLE} busy={busy !== false} titleFocusable onClose={onClose}>
      {choice && lists && (
        <ChoiceContent
          choice={choice}
          mine={mine}
          lists={lists}
          busy={busy}
          online={online}
          onKeep={onKeep}
          onFix={onFix}
          onSaveAsNew={onSaveAsNew}
        />
      )}
    </DialogFrame>
  )
}

type ChoiceContentProps = Omit<IdConflictChoiceProps, 'open' | 'choice' | 'lists' | 'onClose'> & {
  choice: Choice
  lists: ChoiceLists
}

function ChoiceContent({ choice, mine, lists, busy, online, onKeep, onFix, onSaveAsNew }: ChoiceContentProps) {
  const { current, failure, today, redraws } = choice
  const sameType = current.type === mine.type
  const actionFailed = failure !== undefined && failure.on !== 'keep'
  const again = actionFailed ? '다시 시도' : undefined
  const action =
    current.deletedAt !== null
      ? undefined
      : sameType
        ? { label: again ?? '내 입력으로 고치기', kind: 'primary' as const, onClick: onFix, disabled: !online }
        : { label: again ?? '새 거래로 저장', kind: 'primary' as const, onClick: onSaveAsNew }
  // 연결이 없어 누를 수 없는 이유는 주 버튼의 실패 문구가 없을 때만 보인다. 유형이 다르면 먼저 저장된 거래가 남는다는 것을 알린다
  const notice = !action ? undefined : !sameType ? KEPT_NOTICE : !online && !actionFailed ? SAVE_OFFLINE : undefined
  return (
    <ConflictPanel
      description={CHOICE_DESCRIPTION}
      closeLabel="저장된 내용 그대로"
      onCloseAction={onKeep}
      action={action}
      busy={busy !== false}
      closeBusy={busy === 'keep'}
      notice={notice}
      failure={failure}
      failureFocus={failure?.on === 'keep' ? 'close' : 'action'}
      redraws={redraws}
    >
      {current.deletedAt === null ? (
        <ConflictCompare latestLabel="저장된 내용" rows={compareRows(lists.valuesOf(current), mine, lists.names, today)} />
      ) : (
        <DeletedElsewhere />
      )}
    </ConflictPanel>
  )
}
