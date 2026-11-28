import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SubmitEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { useBlocker, useLocation, useNavigate } from 'react-router'
import { sessionUserId } from '../../api/session'
import AmountField from '../../components/AmountField'
import { Button } from '../../components/Button'
import DateField from '../../components/DateField'
import FullScreenForm from '../../components/FullScreenForm'
import { isModalOpen } from '../../components/openModal'
import Overlay from '../../components/Overlay'
import SegmentedChoice from '../../components/SegmentedChoice'
import { TextField } from '../../components/TextField'
import TimeField from '../../components/TimeField'
import { useToast } from '../../components/ToastContext'
import { useWideScreen } from '../../components/wideScreen'
import type { OneLine } from '../../lib/oneLine'
import { useKeepDraft } from '../drafts/useKeepDraft'
import { useRestoredDraft } from '../drafts/restoreDraft'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { EntryCopiesContext, useEntryAccounts, useEntryCategories } from '../transactions/entryLists'
import { enterToNext, isComposingKey, keepComposingEnter } from '../transactions/fieldKeys'
import { categoryKindOf, defaultAccountOf } from '../transactions/formDefaults'
import { handOffToEntry, newMark } from '../transactions/oneLineHandoff'
import { DuplicateWarningDialog, SaveChoiceDialog, SaveFailureMessages } from '../transactions/SaveParts'
import { oneLineDraftOf, type OneLineDraft } from '../transactions/transactionDraft'
import {
  newTransactionValues,
  PAYEE_MAX,
  payeeLength,
  typeChange,
  type TransactionValues,
} from '../transactions/transactionForm'
import { AccountField, CategoryField } from '../transactions/TransactionPickers'
import type { TransactionType } from '../transactions/transactions'
import { useCategorySuggestion, type CategorySuggestion, type SuggestionState } from '../transactions/categorySuggestion'
import { useNewTransactionSave, type Sender } from '../transactions/useNewTransactionSave'
import { useTransactionForm, type TransactionForm } from '../transactions/useTransactionForm'
import styles from './OneLineResult.module.css'

/*
 * D-05 한 줄 입력 결과 확인(F-211, #233). 홈의 한 줄 입력(OneLineInput)이 해석에 성공하면 연다. 따로 싣는 조각이다.
 * - 휴대폰 배치는 아래에서 올라오는 전체 화면(모달), 넓은 화면은 입력칸 바로 아래에 펼친 구역이다. 같은 주인이 그리므로 창 폭이
 *   바뀌어도 값과 보내는 중인 저장이 이어진다(architect #233 2)
 * - 주소가 없다(00-common 12.1). 열 때 같은 주소에 방문 기록 항목 하나를 쌓아 브라우저 뒤로 가기가 판만 닫게 한다. 판이 보이는
 *   조건은 "지금 항목의 표시 == 메모리의 표시"다. 닫은 뒤나 저장한 뒤의 앞으로 가기·새로고침은 메모리의 표시가 없어 열리지 않는다
 *   (architect #233 4)
 * - "저장"은 누른 처리 안에서 판을 닫고 입력칸을 비워 초점을 준 뒤 보낸다(iPhone 키보드). 실패하면 같은 값으로 다시 연다.
 *   보내는 동안에는 홈을 떠나는 이동을 막고(architect #233 1), 새 "입력"은 저장이 끝난 뒤에 연다(designer #233 6)
 * - 로그인이 풀리면 입력칸의 글과 열려 있거나 보내는 중인 값을 기기에 남기고, 같은 계정으로 홈에 돌아오면 다시 연다(architect #233 3)
 * - 카테고리는 열 때 해석한 가맹점으로 제안한다(P-219, useCategorySuggestion). 가맹점을 고쳐 벗어나면 다시 제안하고, 직접 고른
 *   뒤에는 하지 않는다. 1B 임시: 연결이 없으면 제안 없이 미분류다
 * - 중복 경고(F-209, #241)는 "저장"으로 판을 닫은 뒤 묻는다. 맞는 거래가 있으면 실패할 때처럼 같은 값으로 다시 열고 그 위에 경고
 *   판을 띄운다. "그래도 저장"은 저장을 누른 것과 같이 판을 닫고 입력칸에 초점을 준 뒤 보낸다(designer #241 D5)
 */

const TITLE = '한 줄 입력 확인'

/** 해석한 한 줄. "입력"을 누를 때마다 seq가 늘어난다 */
export interface OneLineRequest extends OneLine {
  text: string
  seq: number
}

export interface OneLineResultProps {
  /** 마지막으로 낸 해석 */
  request: OneLineRequest | undefined
  /** 입력칸의 지금 글 */
  text: string
  setText: (text: string) => void
  input: RefObject<HTMLInputElement | null>
}

/** 열린 판 하나의 값. 열 때마다 key가 바뀌어 칸과 저장 상태를 새로 만든다 */
interface Session {
  key: number
  /** 입력한 글(D-05 (2)) */
  text: string
  values: Partial<TransactionValues>
  /** 되살린 쓰던 값의 거래 id */
  id?: string
}

type ResultDraft = NonNullable<OneLineDraft['result']>

/** 방문 기록 항목의 표시 */
function markOf(state: unknown): unknown {
  return (state as { oneLineResult?: unknown } | null)?.oneLineResult
}

/** 판의 주인. 열림, 방문 기록, 보내는 중, 쓰던 값을 갖는다. 홈에 한 번만 그린다 */
export default function OneLineResult({ request, text, setText, input }: OneLineResultProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const showToast = useToast()
  const [session, setSession] = useState<Session>()
  const [mark, setMark] = useState<string>()
  // 쌓은 항목이 아직 지금 항목이 되기 전이다. 그동안도 보인다(실패해 다시 열면 같은 처리 안에서 칸이 있어야 초점을 준다)
  const [pushing, setPushing] = useState<string>()
  // "저장"을 눌러 판을 닫고 보내는 중이다(뒷일: 입력칸, 다시 열기)
  const [sending, setSending] = useState(false)
  // 판의 어느 버튼이든(저장, 다시 시도, 선택 판의 두 보내기) 요청이 나가 있다. 판의 save.busy를 따른다(architect #350)
  const [sessionBusy, setSessionBusy] = useState(false)
  const busy = sending || sessionBusy
  const keys = useRef(0)
  const handled = useRef(0)
  // 보내는 동안 낸 새 해석. 저장이 끝나면 연다(designer #233 6)
  const deferred = useRef<OneLineRequest>(undefined)
  // 열려 있거나 보내는 중인 판의 쓰던 값
  const draft = useRef<() => ResultDraft>(undefined)
  const here = markOf(location.state)
  if (pushing !== undefined && here === pushing) setPushing(undefined)
  const shown = session !== undefined && mark !== undefined && (here === mark || pushing === mark)
  // 저장의 뒷일(응답 뒤)은 그때의 값으로 한다
  const latest = useRef({ text, mark, here, session })
  useLayoutEffect(() => {
    latest.current = { text, mark, here, session }
  })

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => busy && currentLocation.pathname !== nextLocation.pathname,
  )
  useEffect(() => {
    if (blocker.state === 'blocked') blocker.reset()
  }, [blocker])

  useKeepDraft('one-line', () => {
    const result = draft.current?.()
    const typed = latest.current.text
    return typed !== '' || result ? { text: typed, ...(result && { result }) } : undefined
  })
  useRestoredDraft('one-line', (saved) => {
    const restored = oneLineDraftOf(saved)
    if (!restored) return
    if (latest.current.text === '') setText(restored.text)
    if (restored.result) open({ text: restored.result.text, values: restored.result.values, id: restored.result.id })
  })

  /**
   * 판을 연다. 이미 보이면 그 자리(같은 방문 기록 항목)에서 내용만 바꾼다. 저장의 뒷일(응답 뒤)에서도 부르므로 그린 때의 값이 아니라
   * 지금의 표시로 본다
   */
  function open(next: Omit<Session, 'key'>) {
    keys.current += 1
    setSession({ ...next, key: keys.current })
    if (latest.current.mark === undefined) pushMark()
  }

  /**
   * 새 표시로 방문 기록 항목을 쌓아 판을 보인다. `now`면 그 처리 안에서 바로 그린다(실패해 다시 열 때 저장의 뒷일이 칸에 초점을
   * 준다). 리액트가 그리는 중(effect)에는 쓰지 않는다
   */
  function pushMark(now = false) {
    const fresh = newMark()
    const show = () => {
      setMark(fresh)
      setPushing(fresh)
    }
    if (now) flushSync(show)
    else show()
    void navigate(
      { pathname: location.pathname, search: location.search },
      { state: { oneLineResult: fresh }, preventScrollReset: true },
    )
  }

  const take = useEffectEvent((next: OneLineRequest) => {
    if (sending) {
      deferred.current = next
      return
    }
    open({ text: next.text, values: { amount: next.amount, payee: next.payee } })
  })
  useEffect(() => {
    if (!request || request.seq === handled.current) return
    handled.current = request.seq
    take(request)
  }, [request])

  /** 입력칸에 초점과 끝의 커서를 둔다. `restore`가 있으면 그 글을 먼저 넣는다 */
  function focusInput(restore?: string) {
    if (restore !== undefined) flushSync(() => setText(restore))
    const element = input.current
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }

  /** 판을 닫는다. 지금 항목이 그 판의 것이면 한 번만 뒤로 가 항목을 뺀다 */
  function hide() {
    const { mark: closing, here: now } = latest.current
    flushSync(() => setMark(undefined))
    if (closing !== undefined && now === closing) void navigate(-1)
  }

  /** 저장 없이 닫는다(닫기, X, Esc, 끌어내리기). 입력칸이 비었으면(저장하다 실패해 다시 연 판) 글을 되돌린다 */
  function close() {
    const { mark: closing, session: closed, text: typed } = latest.current
    if (closing === undefined || !closed) return
    hide()
    setSession(undefined)
    focusInput(typed === '' ? closed.text : undefined)
  }

  // 브라우저 뒤로 가기로 지금 항목이 바뀌면 닫은 것이다. 요청이 나가 있는 동안에는 닫지 않고 판을 다시 쌓는다: 판이 사라지면
  // 요청의 뒷일(기기에 쌓기, 실패 문구)을 하지 못한다(D-04가 보내는 동안 떠나는 길을 막는 것과 같다, architect #350)
  const wasShown = useRef(false)
  const backPressed = useEffectEvent(() => {
    if (busy) {
      pushMark()
      return
    }
    const { session: closed, text: typed } = latest.current
    setMark(undefined)
    setSession(undefined)
    if (closed) focusInput(typed === '' ? closed.text : undefined)
  })
  useEffect(() => {
    if (wasShown.current && !shown && mark !== undefined) backPressed()
    wasShown.current = shown
  }, [shown, mark])

  /** 검증을 지나 보내기 바로 앞. "저장"이면 판을 닫고 입력칸을 비워 커서를 준다. 그사이 입력칸에 쓴 새 글은 둔다 */
  function startSending(from: Sender) {
    flushSync(() => setSending(true))
    if (from !== 'save') return
    const { session: sent, text: typed } = latest.current
    hide()
    focusInput(sent && typed === sent.text ? '' : undefined)
  }

  /** 저장을 마쳤다. 판이 보이면(다시 시도) 닫고, 보내는 동안 낸 새 해석이 있으면 연다 */
  function finish(toast: string) {
    showToast(toast)
    const { mark: shownMark, session: done, text: typed } = latest.current
    if (shownMark !== undefined) {
      hide()
      focusInput(done && typed === done.text ? '' : undefined)
    }
    setSending(false)
    setSession(undefined)
    const next = deferred.current
    deferred.current = undefined
    if (next) open({ text: next.text, values: { amount: next.amount, payee: next.payee } })
  }

  /** 실패를 보인다. 저장을 누르며 닫았으면 같은 값으로 다시 연다. 보내는 동안 낸 새 해석은 버린다(글은 입력칸에 있다) */
  function fail() {
    deferred.current = undefined
    flushSync(() => setSending(false))
    if (latest.current.mark === undefined) pushMark(true)
  }

  /** "자세히": 지금 값(유형 포함)을 채운 거래 입력(D-04)을 연다. 이 판의 방문 기록 항목을 그 화면으로 바꾼다 */
  function detail(
    values: TransactionValues,
    owner: { userId: string | undefined; ledgerId: string },
    suggestion: SuggestionState,
  ) {
    const { session: opened, mark: closing, here: now } = latest.current
    if (!opened) return
    const state = handOffToEntry(owner, { text: opened.text, values, suggestion })
    void navigate('/transactions/new', { replace: closing !== undefined && now === closing, state })
  }

  if (!session) return null
  return (
    <OneLineSession
      key={session.key}
      session={session}
      shown={shown}
      draftRef={draft}
      onClose={close}
      onSending={startSending}
      onDone={finish}
      onFailed={fail}
      onBusyChange={setSessionBusy}
      onDetail={detail}
    />
  )
}

interface SessionProps {
  session: Session
  shown: boolean
  draftRef: RefObject<(() => ResultDraft) | undefined>
  onClose: () => void
  onSending: (from: Sender) => void
  onDone: (toast: string) => void
  onFailed: () => void
  /** 판의 요청이 나가 있는지(save.busy). 판이 사라지면 아니다 */
  onBusyChange: (busy: boolean) => void
  onDetail: (
    values: TransactionValues,
    owner: { userId: string | undefined; ledgerId: string },
    suggestion: SuggestionState,
  ) => void
}

/** 판 하나: 칸과 저장. 판이 닫혀도(보내는 중) 남아 있다가 실패하면 같은 값으로 다시 그린다 */
function OneLineSession({
  session,
  shown,
  draftRef,
  onClose,
  onSending,
  onDone,
  onFailed,
  onBusyChange,
  onDetail,
}: SessionProps) {
  const ledger = useCurrentLedger()
  const navigate = useNavigate()
  const wide = useWideScreen()
  // 기기에 있는 계좌·카테고리로 바로 열고 서버의 목록이 오면 바꾼다(#234). 연결이 없어도 된다(F-114)
  const accounts = useEntryAccounts(true)
  const categories = useEntryCategories(true)
  const [owner] = useState(() => ({ userId: sessionUserId(), ledgerId: ledger.id }))
  const [defaultAccountId, setDefaultAccountId] = useState<string>()
  if (defaultAccountId === undefined && accounts.data) setDefaultAccountId(defaultAccountOf(owner, accounts.data))
  // 기본값: 지출, 기기의 지금, 마지막으로 쓴 계좌, 미분류(D-05 해석 규칙 5~7, 1B 임시)
  const form = useTransactionForm(defaultAccountId ?? '', () => ({ ...newTransactionValues(), ...session.values }))
  const save = useNewTransactionSave({
    form,
    owner,
    accounts: accounts.data,
    categories: categories.data,
    initialId: session.id,
    onSending,
    onDone,
    onFailed,
  })
  useLayoutEffect(() => {
    onBusyChange(save.busy)
    return () => onBusyChange(false)
  }, [save.busy, onBusyChange])
  // 되살린 판의 카테고리는 직접 골랐을 수 있어 덮어쓰지 않는다(P-502)
  const restoredCategory = session.id !== undefined && (session.values.categoryId ?? '') !== ''
  const suggestion = useCategorySuggestion({
    form,
    owner,
    categories: categories.data,
    frozen: save.busy,
    initial: { picked: restoredCategory },
  })
  // 열 때 해석한 가맹점으로 제안한다(D-05 해석 규칙 5). 되살린 판은 남긴 값 그대로다
  const suggestAtOpen = useEffectEvent(() => {
    if (session.id === undefined) suggestion.suggest(session.values.payee ?? '')
  })
  useEffect(() => suggestAtOpen(), [])
  // 수입으로 바꾸기 전의 지출 카테고리
  const expenseCategory = useRef<string>(undefined)

  /** 수입으로 바꾸면 카테고리가 수입의 미분류가 되고 제안 도움말이 사라진다. 지출로 돌아오면 그때의 카테고리로 돌아간다(D-05 (3)) */
  function changeType(type: TransactionType) {
    const { values, change } = form
    if (values.type === 'EXPENSE') expenseCategory.current = values.categoryId
    const back = type === 'EXPENSE' && expenseCategory.current !== undefined ? { categoryId: expenseCategory.current } : {}
    change({ ...typeChange(values, type, (id) => categoryKindOf(categories.data, id)), ...back })
  }
  const saveButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    draftRef.current = () => ({ id: save.id, text: session.text, values: form.values })
    return () => {
      draftRef.current = undefined
    }
  })

  // 열리면 초점이 저장에 있다(넓은 화면은 엔터 한 번으로 저장). 서버가 거부한 칸으로 옮긴 초점은 둔다
  useEffect(() => {
    if (shown && document.activeElement?.getAttribute('aria-invalid') !== 'true') saveButton.current?.focus()
  }, [shown])

  function closeIfIdle() {
    if (!save.busy) onClose()
  }

  function detail() {
    if (!save.busy) onDetail(form.effective, owner, suggestion.state)
  }

  /** "저장된 거래 보기"(current를 읽지 못한 409). 확인 창 없이 입력을 버리고 그 거래로 간다(planner #102) */
  function viewSaved(event: MouseEvent<HTMLAnchorElement>, path: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (!save.busy) void navigate(path)
  }

  const fields = (
    <OneLineFields
      form={form}
      readOnly={save.busy}
      text={session.text}
      suggestion={suggestion}
      onTypeChange={changeType}
    />
  )
  const messages = <SaveFailureMessages save={save} onViewSaved={viewSaved} />
  const saveAction = (
    <Button ref={saveButton} kind="primary" type="submit" busy={save.saveBusy} disabled={save.messageBusy}>
      저장
    </Button>
  )
  const detailAction = (
    <Button kind="secondary" onClick={detail}>
      자세히
    </Button>
  )

  return (
    <EntryCopiesContext value>
      {wide ? (
        shown && (
          <WideResult onSubmit={save.submit} onClose={closeIfIdle}>
            {fields}
            {messages}
            <div className={styles.wideActions}>
              <Button kind="secondary" onClick={closeIfIdle}>
                닫기
              </Button>
              {detailAction}
              <div className={styles.end}>{saveAction}</div>
            </div>
          </WideResult>
        )
      ) : (
        <Overlay open={shown} instantClose aria-label={TITLE} onClose={closeIfIdle}>
          <FullScreenForm
            title={TITLE}
            guard={{ busy: save.busy, asking: false, close: closeIfIdle, keep() {}, discard() {} }}
            onSubmit={save.submit}
            dragToClose
            bottom={
              <>
                {messages}
                <div className={styles.actions}>
                  <div className={styles.detail}>{detailAction}</div>
                  <div className={styles.save}>{saveAction}</div>
                </div>
              </>
            }
          >
            {fields}
          </FullScreenForm>
        </Overlay>
      )}
      <SaveChoiceDialog save={save} form={form} />
      <DuplicateWarningDialog save={save} />
    </EntryCopiesContext>
  )
}

interface WideResultProps {
  onSubmit: () => void
  onClose: () => void
  children: ReactNode
}

/** 넓은 화면: 입력칸 바로 아래에 펼친 구역. 홈의 나머지는 아래로 밀린다. Esc는 닫기와 같다 */
function WideResult({ onSubmit, onClose, children }: WideResultProps) {
  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    onSubmit()
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || isComposingKey(event) || event.repeat || isModalOpen()) return
    event.preventDefault()
    onClose()
  }

  return (
    <section aria-label={TITLE} className={styles.wide} onKeyDown={handleKeyDown}>
      <form className={styles.wideForm} noValidate onSubmit={handleSubmit}>
        {children}
      </form>
    </section>
  )
}

const typeOptions: { value: TransactionType; label: string }[] = [
  { value: 'EXPENSE', label: '지출' },
  { value: 'INCOME', label: '수입' },
]

interface FieldsProps {
  form: TransactionForm
  readOnly: boolean
  /** 입력한 글 */
  text: string
  suggestion: Pick<CategorySuggestion, 'help' | 'suggest' | 'pick'>
  onTypeChange: (type: TransactionType) => void
}

/** D-05 (2)~(8). 모양과 검증은 D-04의 같은 칸과 같다. 넓은 화면은 (4)~(6)이 한 줄, (7)~(8)이 한 줄이다 */
function OneLineFields({ form, readOnly, text, suggestion, onTypeChange }: FieldsProps) {
  const { values, effective, change, control, check } = form
  const dateTimeId = useId()
  // 금액은 해석한 값으로 열린다. 고친 뒤에만 벗어날 때 검사한다(D-04와 같다)
  const amountTouched = useRef(false)
  const { error: accountError, ref: accountRef } = control('accountId')
  const { error: categoryError, ref: categoryRef } = control('categoryId')

  return (
    <>
      <p className={styles.typed}>입력한 글: {text}</p>
      <div className={styles.fieldRow}>
        <SegmentedChoice label="유형" options={typeOptions} value={values.type} onChange={onTypeChange} readOnly={readOnly} />
      </div>
      <div className={styles.fieldRow}>
        <AmountField
          {...control('amount')}
          label="금액"
          size="title"
          readOnly={readOnly}
          onChange={(amount) => {
            amountTouched.current = true
            change({ amount })
          }}
          onBlur={() => {
            if (amountTouched.current) check('amount')
          }}
          onKeyDown={(event) => enterToNext(event, '[data-field="payee"]')}
        />
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
          onBlur={() => {
            check('payee')
            suggestion.suggest(values.payee)
          }}
          onKeyDown={keepComposingEnter}
        />
        <CategoryField
          ref={categoryRef}
          kind={values.type === 'INCOME' ? 'INCOME' : 'EXPENSE'}
          value={values.categoryId}
          error={categoryError}
          help={suggestion.help}
          readOnly={readOnly}
          onChange={(categoryId) => {
            suggestion.pick()
            change({ categoryId }, { check: ['categoryId'] })
          }}
        />
      </div>
      <div className={styles.fieldRow}>
        <AccountField
          ref={accountRef}
          label={values.type === 'INCOME' ? '들어온 계좌' : '계좌'}
          value={effective.accountId}
          error={accountError}
          readOnly={readOnly}
          onChange={(accountId) => {
            if (accountId !== effective.accountId) change({ accountId }, { check: ['accountId'] })
          }}
        />
        <div role="group" aria-labelledby={dateTimeId} className={styles.dateTime}>
          <span id={dateTimeId} className={styles.groupLabel}>
            날짜·시각
          </span>
          <div className={styles.pair}>
            <div className={styles.date}>
              <DateField
                {...control('occurredOn')}
                label="날짜"
                labelHidden
                readOnly={readOnly}
                onChange={(occurredOn) => change({ occurredOn })}
              />
            </div>
            <div className={styles.time}>
              <TimeField
                {...control('occurredTime')}
                label="시각"
                optional
                labelHidden
                readOnly={readOnly}
                onChange={(occurredTime) => change({ occurredTime })}
                onBlur={() => check('occurredTime')}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
