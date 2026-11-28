import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useToast } from '../../components/ToastContext'
import type { PendingTransaction } from '../../device/pendingQueue'
import { today as todayOfDevice } from '../../lib/calendarDate'
import { uuidV7 } from '../../lib/uuid'
import { useConnection } from '../connection/useConnection'
import { ledgerScope } from '../me/ledgerKey'
import type { ChoiceLists } from '../transactions/choiceLists'
import type { Choice, ChoiceBusy } from '../transactions/IdConflictChoice'
import { QUEUED_TOAST } from '../transactions/pendingTransactions'
import type { TransactionValues } from '../transactions/transactionForm'
import { fixSaved, keepSaved, saveAsNew, type ChoiceResult, type Choosable } from './choosePending'
import { CHANGED_ELSEWHERE } from './fixOpening'

/*
 * B-05 보낼 수 없음 줄의 "비교해서 고르기"(#280)가 여는 선택 판의 상태. 판은 #239의 IdConflictChoice이고, 고른 뒤의 일은
 * choosePending이 대기열의 줄에 한다. 판이 닫힌 뒤의 초점은 목록이 옮긴다(PendingList).
 */

/** 판을 열 줄. 그때 본 줄과, 그 줄에서 읽은 저장된 거래·내 입력, 그 장부의 목록 */
export interface ChoiceTarget extends Choosable {
  seen: PendingTransaction
  lists: ChoiceLists
}

/** 판이 닫힌 까닭과 초점을 옮길 줄의 id */
export type ChoiceEnd =
  /** 고르지 않고 닫았다. 그 줄의 "비교해서 고르기"로 */
  | { kind: 'closed'; id: string }
  /** 줄을 지웠다. 이웃 줄의 버리기로(#236) */
  | { kind: 'removed'; id: string }
  /** 다른 곳에서 먼저 바뀌었다. 그 줄의 "비교해서 고르기"가 남아 있으면 그것, 없으면 이웃 줄로 */
  | { kind: 'changed'; id: string }
  /** 그 거부의 보낼 수 없음이 됐다. 그 줄(`id`)의 "고쳐서 보내기"로(designer #280 D1) */
  | { kind: 'refused'; id: string; from: string }
  /** 새 id의 대기가 됐다. 그 줄(`id`)의 버리기로 */
  | { kind: 'queued'; id: string; from: string }

export interface PendingChoice {
  /** 그 줄로 판을 연다 */
  start: (target: ChoiceTarget) => void
  dialog: {
    open: boolean
    choice: Choice | undefined
    mine: TransactionValues | undefined
    lists: ChoiceLists | undefined
    busy: ChoiceBusy
    online: boolean
    onClose: () => void
    onKeep: () => void
    onFix: () => void
    onSaveAsNew: () => void
  }
}

/**
 * 판의 상태와 세 선택. 처리 중에는 판을 닫을 수 없다(#239와 같다). 새 거래로 저장의 새 id는 판을 연 동안 같아 다시 시도가
 * 같은 거래를 두 번 만들지 않는다. 성공하면 그 장부의 목록·합계를 다시 받는다.
 */
export function usePendingChoice(onEnd: (end: ChoiceEnd) => void): PendingChoice {
  const queryClient = useQueryClient()
  const showToast = useToast()
  const online = useConnection() === 'online'
  const [target, setTarget] = useState<ChoiceTarget>()
  const [choice, setChoice] = useState<Choice>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ChoiceBusy>(false)
  const newId = useRef<string | undefined>(undefined)

  function start(next: ChoiceTarget) {
    newId.current = undefined
    setTarget(next)
    setChoice((last) => ({ current: next.current, today: todayOfDevice(), redraws: (last?.redraws ?? 0) + 1 }))
    setOpen(true)
  }

  function close() {
    if (busy || !target) return
    setOpen(false)
    onEnd({ kind: 'closed', id: target.seen.id })
  }

  async function choose(kind: Exclude<ChoiceBusy, false>, work: (target: ChoiceTarget) => Promise<ChoiceResult>) {
    if (busy || !target) return
    setBusy(kind)
    const result = await work(target)
    setBusy(false)
    finish(target, result, kind)
  }

  function finish(from: ChoiceTarget, result: ChoiceResult, kind: Exclude<ChoiceBusy, false>) {
    const id = from.seen.id
    switch (result.kind) {
      case 'failed':
        setChoice(
          (last) =>
            last && {
              ...last,
              failure: { message: result.message, count: (last.failure?.count ?? 0) + 1, on: kind === 'keep' ? 'keep' : undefined },
            },
        )
        return
      case 'redraw':
        setTarget({ ...from, seen: result.seen, current: result.current })
        setChoice((last) => ({ current: result.current, today: last?.today ?? todayOfDevice(), redraws: (last?.redraws ?? 0) + 1 }))
        return
      case 'removed':
        setOpen(false)
        if (kind === 'action') void queryClient.invalidateQueries({ queryKey: ledgerScope(from.seen.ledgerId) })
        showToast(result.toast)
        onEnd({ kind: 'removed', id })
        return
      case 'changed':
        setOpen(false)
        showToast(CHANGED_ELSEWHERE)
        onEnd({ kind: 'changed', id })
        return
      case 'refused':
        setOpen(false)
        onEnd({ kind: 'refused', id: result.id, from: id })
        return
      case 'queued':
        setOpen(false)
        showToast(QUEUED_TOAST)
        onEnd({ kind: 'queued', id: result.id, from: id })
    }
  }

  function chosenId(): string {
    newId.current ??= uuidV7()
    return newId.current
  }

  return {
    start,
    dialog: {
      open,
      choice,
      mine: target?.mine,
      lists: target?.lists,
      busy,
      online,
      onClose: close,
      onKeep: () => void choose('keep', ({ seen }) => keepSaved(seen)),
      onFix: () => void choose('action', ({ seen, current, mine, lists }) => fixSaved(seen, current, mine, lists)),
      onSaveAsNew: () => void choose('action', ({ seen, mine }) => saveAsNew(seen, mine, chosenId())),
    },
  }
}
