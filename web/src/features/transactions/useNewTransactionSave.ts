import { useEffect, useMemo, useRef, useState } from 'react'
import { connection } from '../../api/connection'
import type { FieldErrors } from '../../components/useFormFields'
import { today as todayOfDevice } from '../../lib/calendarDate'
import { uuidV7 } from '../../lib/uuid'
import type { Account } from '../accounts/accounts'
import type { Category } from '../categories/categories'
import { useConnection } from '../connection/useConnection'
import type { PanelFailure } from './ConflictPanel'
import { duplicateQueryOf, findDuplicates, type DuplicateQuery } from './duplicates'
import { isUncategorized } from './formDefaults'
import { nameBookOf } from './listedText'
import { isConnectionLoss, QUEUED_TOAST, queueNewTransaction } from './pendingTransactions'
import {
  hasSameContent,
  savedTransactionValues,
  toNewTransaction,
  toTransactionUpdate,
  validateTransaction,
  type TransactionField,
} from './transactionForm'
import { rejectedFields } from './transactionRejection'
import type { CreateResult, NewTransaction, TransactionDetail } from './transactions'
import { idConflictOf, needsResendNotice, staleVersionOf } from './transactionWrites'
import { useCreateTransaction } from './useCreateTransaction'
import type { TransactionForm } from './useTransactionForm'
import { useUpdateTransaction } from './useUpdateTransaction'

/*
 * 새 거래 저장(D-04 새 입력, D-05 한 줄 입력 결과 확인 #233). 두 화면이 같은 규칙으로 저장한다.
 * - 거래 id는 화면을 열 때 만들고, 실패한 뒤 다시 시도하거나 값을 고쳐 다시 저장해도 같은 id로 보낸다(ADR 006). 앞 요청이 서버에
 *   저장됐을 수 있기 때문이다. 새 id는 그 id를 쓸 수 없다는 거부(current 없는 409)에서, 그리고 선택 판에서 유형이 달라
 *   "새 거래로 저장"을 누를 때만 만든다
 * - 같은 id로 앞서 저장된 내 거래와 내용이 다르면(current 있는 409 ID_CONFLICT) 선택 판을 띄워 사용자가 고른다(ADR 006 결정 3)
 * - 연결이 없으면 요청 없이 기기에 쌓고, 요청 중에 연결이 끊기면 같은 id로 쌓는다(F-103, P-904). 서버 오류와 15초 지연은 쌓지
 *   않는다. 저장 버튼은 연결과 관계없이 누를 수 있다
 * - 저장 버튼으로 보낼 때는 기기 검증 다음, 보내거나 쌓기 전에 같은 날짜·금액·가맹점의 거래를 묻는다(F-209, #241). 맞는 거래가
 *   있으면 멈추고 중복 경고 판을 띄운다. "그래도 저장"은 묻지 않고 그대로 이어 간다. 실패 문구의 버튼과 선택 판의 버튼은 이미 물은
 *   저장을 다시 보내는 것이라 묻지 않는다
 * 화면을 떠나거나 닫는 것은 화면이 정한다(onDone). 저장을 마치기 전에 화면이 사라지면 뒷일(쌓기, 실패 문구)을 하지 못하므로
 * 화면은 보내는 동안 떠나는 길을 막는다(D-04 useLeaveGuard, D-05 architect #233).
 */

/** 같은 id로 다시 보낸 거래가 이미 고쳐졌거나 휴지통·취소였을 때(200, ADR 006 결정 3)의 토스트(designer #239) */
const RESEND_NOTICE = '이미 저장된 거래라 저장된 내용으로 두었어요'

/* 선택 판(ADR 006 결정 3)의 문구(designer #239, #102). 화면에 "서버"라는 말을 쓰지 않는다 */
export const CHOICE_TITLE = '이미 저장된 거래가 있어요'
export const CHOICE_DESCRIPTION = '먼저 저장된 내용과 지금 입력이 달라요. 어느 쪽으로 할지 골라 주세요.'
const KEPT_TOAST = '저장된 내용으로 두었어요'
export const KEPT_NOTICE = '저장된 거래는 그대로 남아요'
/* 선택 판의 실패와 비활성 문구는 D-04 저장의 것을 쓴다(designer #239 D1) */
export const SAVE_FAILED = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const SAVE_LOST = '연결이 끊겨 저장하지 못했어요. 연결되면 다시 시도해 주세요.'
export const SAVE_OFFLINE = '연결되면 저장할 수 있어요'

/** 저장 버튼(중복 경고 판의 "그래도 저장" 포함), 실패 문구의 버튼("다시 시도", "새 거래로 저장"), 또는 선택 판의 주 버튼 */
export type Sender = 'save' | 'message' | 'choice'

type Failure =
  /** 서버 오류, 지연, 연결 실패, 모르는 거부. 같은 id로 다시 보낸다 */
  | { kind: 'retry' }
  /**
   * 같은 id로 앞서 저장한 내 거래가 있는데 내용이 다르고(current 있는 409) current를 읽을 수 없다. 선택 판을 그릴 수 없어
   * 1A처럼 그 거래를 보러 가게만 한다
   */
  | { kind: 'saved-differently'; savedId: string }
  /** 그 id를 쓸 수 없다(current 없는 409). 새 id로 만든다 */
  | { kind: 'id-unusable' }
  /** 연결이 없는데 기기에 쌓지 못했다(저장소를 쓸 수 없음). "다시 시도"는 연결이 없는 동안 비활성이다 */
  | { kind: 'not-queued' }

/** 선택 판에 보이는 저장된 거래와 그 판의 실패 */
export interface Choice {
  current: TransactionDetail
  /** 판을 연 때의 기기의 오늘 */
  today: string
  /** 새 저장된 내용으로 다시 그린 횟수 */
  redraws: number
  failure?: PanelFailure
}

interface NewTransactionSaveOptions {
  form: TransactionForm
  /** 입력의 주인(sessionUserId)과 장부. 보내는 순간의 사용자(토큰의 sub)와 같은지 요청 계층이 본다(#234) */
  owner: { userId: string | undefined; ledgerId: string }
  /** 선택 판의 비교에 쓰는 계좌와 카테고리. 없으면 선택 판 대신 "저장된 거래 보기"다 */
  accounts: Account[] | undefined
  categories: Category[] | undefined
  /** 되살린 쓰던 값의 거래 id(ADR 006). 없으면 새로 만든다 */
  initialId?: string
  /** 보일 오류가 접힌 칸에 있으면 먼저 펼친다(D-04 더 보기) */
  unfoldFor?: (errors: FieldErrors<TransactionField>) => void
  /**
   * 검증을 통과해 보내거나 기기에 쌓기 바로 앞이다. 누른 처리 안에서 동기로 부른다. D-05는 저장을 누른 것이면 여기서 판을 닫고
   * 입력칸에 초점을 준다(iPhone은 누른 그 처리 안에서 초점을 줘야 키보드가 올라온다)
   */
  onSending?: (from: Sender) => void
  /** 저장을 마쳤다(서버에 저장, 기기에 쌓음, 저장된 내용 그대로 둠). 보일 토스트와 남은 거래의 id. 화면이 떠나거나 닫는다 */
  onDone: (toast: string, savedId: string) => void
  /** 실패나 판을 보이기 시작했다(실패 문구, 칸 거부, 선택 판, 중복 경고 판). D-05는 저장을 누르며 닫은 판을 같은 값으로 다시 연다 */
  onFailed?: () => void
}

/** 중복 경고 판(F-209, D-04 (30))에 보이는 맞는 거래 */
export interface DuplicateWarning {
  /** 서버(또는 기기 사본)가 준 순서(최근 저장 순)의 맞는 거래. 5건까지다 */
  items: TransactionDetail[]
  /** 판을 연 때의 기기의 오늘(날짜 표기, 00-common 3.2) */
  today: string
  /** 판을 연 횟수. 열 때마다 처음 초점을 판 제목에 둔다 */
  openings: number
}

export type NewTransactionSave = ReturnType<typeof useNewTransactionSave>

/**
 * 새 거래 하나의 저장 상태. 화면은 버튼과 문구(SaveFailureMessages), 선택 판(SaveChoiceDialog), 중복 경고 판(DuplicateWarningDialog,
 * SaveParts.tsx)을 그린다
 */
export function useNewTransactionSave({
  form,
  owner,
  accounts,
  categories,
  initialId,
  unfoldFor,
  onSending,
  onDone,
  onFailed,
}: NewTransactionSaveOptions) {
  const creation = useCreateTransaction()
  const [id, setId] = useState(() => initialId ?? uuidV7())
  // "내 입력으로 고치기"는 같은 id의 거래를 고친다
  const updating = useUpdateTransaction(id)
  // 저장 위의 실패. 다시 보내는 동안에도 남기고, 실패마다 count를 올려 새로 그려 다시 읽히게 한다
  const [shown, setShown] = useState<{ failure: Failure; count: number }>()
  // 보내는 동안 도는 표시를 둘 버튼. 누른 버튼만 돌고 다른 버튼은 누를 수 없다(00-common 4.5, designer 검토 2026-11-26)
  const [sender, setSender] = useState<Sender>('save')
  // 기기에 쌓는 중이거나 쌓았다. 쌓았으면 화면을 떠날 때까지 그대로다
  const [queueing, setQueueing] = useState(false)
  const online = useConnection() === 'online'
  // 선택 판. 닫히는 움직임 동안 내용이 남도록 열림을 따로 둔다
  const [choice, setChoice] = useState<Choice>()
  const [choiceOpen, setChoiceOpen] = useState(false)
  // 중복 경고를 묻는 중이다. 저장 버튼에 처리 중 표시를 두고 칸을 잠근다(D-04 중복 경고)
  const [checking, setChecking] = useState(false)
  // 중복 경고 판. 닫히는 움직임 동안 내용이 남도록 열림을 따로 둔다
  const [warning, setWarning] = useState<DuplicateWarning>()
  const [warningOpen, setWarningOpen] = useState(false)
  // 묻는 동안 화면이 사라지면 답이 와도 보내지 않는다(떠난 화면의 입력이 저장되지 않게)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const lists = useMemo(() => {
    if (!accounts || !categories) return undefined
    return {
      names: nameBookOf(accounts, categories),
      valuesOf: (saved: TransactionDetail) =>
        savedTransactionValues(saved, (categoryId) => isUncategorized(categories, categoryId)),
    }
  }, [accounts, categories])

  const busy =
    checking || creation.isPending || creation.isSuccess || queueing || updating.isPending || updating.isSuccess

  /**
   * 검증하고 보낸다. 저장 버튼(`from` 'save')이면 보내기 전에 중복 경고를 묻는다. `confirmed`는 중복 경고 판의 "그래도 저장"이다.
   * D-05는 onSending에서 판을 닫으므로 묻는 동안 판이 없고, 맞는 거래가 있으면 onFailed로 같은 값의 판을 다시 연다
   * (iPhone은 누른 처리 안에서 입력칸에 초점을 줘야 키보드가 올라온다, #233).
   */
  function submit(transactionId = id, from: Sender = 'save', confirmed = false) {
    if (busy) return
    unfoldFor?.(validateTransaction(form.effective))
    if (!form.checkAll()) {
      creation.reset()
      setShown(undefined)
      return
    }
    setSender(from)
    const transaction = toNewTransaction(form.effective, transactionId)
    onSending?.(from)
    const query = from === 'save' && !confirmed ? duplicateQueryOf(transaction) : undefined
    if (query) {
      void checkThenSend(transaction, query)
      return
    }
    send(transaction)
  }

  /** 기기에 쌓거나 보낸다 */
  function send(transaction: NewTransaction) {
    if (connection() === 'offline') {
      void queue(transaction)
      return
    }
    creation.mutate(
      { transaction, user: owner.userId },
      {
        onSuccess: finish,
        onError: (error) => (isConnectionLoss(error) ? void queue(transaction) : showFailure(error, transaction.id)),
      },
    )
  }

  /**
   * 같은 거래를 묻고(findDuplicates), 없으면 보낸다. 있으면 보내지 않고 판을 띄운다. 묻는 중에 연결이 끊겼으면 기기 사본으로 본
   * 뒤 send가 기기에 쌓는다. 묻지 못하면 없는 것과 같다(planner #241 P3).
   */
  async function checkThenSend(transaction: NewTransaction, query: DuplicateQuery) {
    setChecking(true)
    const found = await findDuplicates(owner, query)
    if (!mounted.current) return
    setChecking(false)
    if (found.length === 0) {
      send(transaction)
      return
    }
    onFailed?.()
    setWarning((last) => ({ items: found, today: todayOfDevice(), openings: (last?.openings ?? 0) + 1 }))
    setWarningOpen(true)
  }

  /** 중복 경고 판의 "그래도 저장": 판을 닫고 저장 버튼을 누른 것과 같이 이어 간다(묻지 않는다, designer #241 D4) */
  function saveAnyway() {
    if (busy) return
    setWarningOpen(false)
    submit(id, 'save', true)
  }

  /** 기기에 쌓는다. 쌓지 못하면 저장 위에 문구를 보이고 값을 둔다(designer Q8). */
  async function queue(transaction: NewTransaction) {
    setQueueing(true)
    try {
      await queueNewTransaction(owner, transaction)
    } catch {
      setQueueing(false)
      creation.reset()
      setShown((last) => ({ failure: { kind: 'not-queued' }, count: (last?.count ?? 0) + 1 }))
      onFailed?.()
      return
    }
    onDone(QUEUED_TOAST, transaction.id)
  }

  // 화면이 사라진 뒤에 온 응답으로는 불리지 않는다
  function finish(result: CreateResult) {
    onDone(needsResendNotice(result) ? RESEND_NOTICE : '저장했어요', result.transaction.id)
  }

  function showFailure(error: Error, transactionId: string) {
    onFailed?.()
    const current = idConflictOf(error, transactionId)?.current
    if (current && lists) {
      setShown(undefined)
      openChoice(current)
      return
    }
    const rejected = rejectedFields(error)
    if (rejected) {
      unfoldFor?.(rejected)
      form.reject(rejected)
    }
    const next = failureOf(error)
    setShown((last) => next && { failure: next, count: (last?.count ?? 0) + 1 })
  }

  function retry() {
    submit(id, 'message')
  }

  function saveAsNew() {
    const next = uuidV7()
    setId(next)
    submit(next, 'message')
  }

  /** 선택 판을 저장된 거래로 연다. 이미 떠 있으면 새 저장된 내용으로 다시 그린다 */
  function openChoice(current: TransactionDetail) {
    setChoice((last) => ({ current, today: todayOfDevice(), redraws: (last?.redraws ?? 0) + 1 }))
    setChoiceOpen(true)
  }

  /** 판에 실패 문구를 보인다. 실패마다 count를 올려 같은 문구여도 다시 알린다 */
  function failInChoice(message: string) {
    setChoice((last) => last && { ...last, failure: { message, count: (last.failure?.count ?? 0) + 1 } })
  }

  /** 내 입력을 버리고 저장된 거래를 그대로 둔다. 보내지 않는다. 저장 성공과 같이 마친다(planner #239 P1) */
  function keepSaved(current: TransactionDetail) {
    if (busy) return
    onDone(KEPT_TOAST, current.id)
  }

  /**
   * "내 입력으로 고치기": 그 거래의 수정을 저장된 거래의 version과 함께 보낸다(ADR 006 결정 3). 그사이 또 고쳐졌으면 같은 판을
   * 새 저장된 내용으로 다시 그리고, 그 내용이 내 입력과 같으면 저장에 성공한 것이다(planner #239 P2).
   */
  function fixSaved(current: TransactionDetail) {
    if (busy || !lists) return
    setSender('choice')
    updating.mutate(
      { update: toTransactionUpdate(form.effective, current.version), user: owner.userId },
      {
        onSuccess: (saved) => onDone('저장했어요', saved.id),
        onError: (error) => {
          const latest = staleVersionOf(error, current.id)?.current
          if (latest) {
            if (latest.deletedAt === null && hasSameContent(form.effective, lists.valuesOf(latest))) {
              onDone('저장했어요', latest.id)
              return
            }
            openChoice(latest)
            return
          }
          const rejected = rejectedFields(error)
          if (rejected) {
            setChoiceOpen(false)
            unfoldFor?.(rejected)
            form.reject(rejected)
            return
          }
          failInChoice(isConnectionLoss(error) ? SAVE_LOST : SAVE_FAILED)
        },
      },
    )
  }

  /**
   * 유형이 달라 고칠 수 없을 때(P-213)의 "새 거래로 저장": 새 id로 만든다. 다시 시도는 그 새 id를 쓴다. 연결이 없거나 요청 중에
   * 끊기면 새 입력과 같이 기기에 쌓는다(F-103, P-904). 먼저 저장된 거래는 그대로 남는다(판의 안내).
   */
  function saveChosenAsNew() {
    if (busy) return
    const next = id === choice?.current.id ? uuidV7() : id
    setId(next)
    setSender('choice')
    const transaction = toNewTransaction(form.effective, next)
    if (connection() === 'offline') {
      setChoiceOpen(false)
      void queue(transaction)
      return
    }
    creation.mutate(
      { transaction, user: owner.userId },
      {
        onSuccess: finish,
        onError: (error) => {
          if (isConnectionLoss(error)) {
            setChoiceOpen(false)
            void queue(transaction)
          } else if (rejectedFields(error) || idConflictOf(error)) {
            setChoiceOpen(false)
            showFailure(error, next)
          } else {
            failInChoice(SAVE_FAILED)
          }
        },
      },
    )
  }

  return {
    /** 지금 거래 id. 쓰던 값에 남기고, 되살릴 때 그 id로 바꾼다(ADR 006) */
    id,
    setId,
    busy,
    online,
    /** 누른 버튼만 도는 표시다 */
    saveBusy: busy && sender === 'save',
    messageBusy: busy && sender === 'message',
    choiceBusy: busy && sender === 'choice',
    failure: shown?.failure,
    failures: shown?.count,
    submit: () => submit(),
    retry,
    saveAsNew,
    choice,
    choiceOpen,
    lists,
    closeChoice: () => setChoiceOpen(false),
    /** 중복 경고 판(F-209). "닫기"는 판만 닫고 입력으로 돌아간다. 값은 그대로다 */
    warning,
    warningOpen,
    closeWarning: () => setWarningOpen(false),
    saveAnyway,
    /** 판의 "입력한 사람: 나"를 가르는 사용자(입력의 주인) */
    me: owner.userId,
    keepSaved,
    fixSaved,
    saveChosenAsNew,
  }
}

/** 저장 위에 보일 실패. 칸에 보인 거부와 실패가 없으면 없다. */
function failureOf(error: Error): Failure | undefined {
  if (rejectedFields(error)) return undefined
  const conflict = idConflictOf(error)
  if (!conflict) return { kind: 'retry' }
  return conflict.savedId ? { kind: 'saved-differently', savedId: conflict.savedId } : { kind: 'id-unusable' }
}
