import { useEffect, useRef, useState, type MouseEvent, type SubmitEvent } from 'react'
import { useNavigate } from 'react-router'
import { connection } from '../../api/connection'
import { sessionUserId } from '../../api/session'
import { Button, ButtonLink } from '../../components/Button'
import Field from '../../components/Field'
import { holdKeyboard } from '../../components/keyboardBridge'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { keepComposingEnter } from '../transactions/fieldKeys'
import { handOffToEntry, oneLineReturnOf, settleOneLineReturn } from '../transactions/oneLineHandoff'
import { loadChunk, loadedChunk, onChunkArrived, oneLinePreload, type OneLineChunk } from './oneLineLoader'
import type { OneLineRequest } from './OneLineResult'
import styles from './Home.module.css'

/*
 * C-01 (1) 한 줄 입력(F-114, #233). 첫 화면 묶음에는 입력칸만 두고, 해석기와 결과 확인(D-05)은 따로 싣는 조각(oneLineChunk)이다.
 * 조각은 입력칸이 초점을 받거나 글을 쓰기 시작하면, 그리고 홈이 한가할 때(LedgerLayout) 받는다. 받지 못하면 오류 자리에 알리고
 * 쓴 글은 그대로 둔다(designer #233). 해석은 기기에서 바로 끝나므로 처리 중 표시가 없다(C-01 상태).
 */

const messages = {
  empty: '입력할 내용을 적어 주세요. 예: 점심 12000',
  'too-long': '100자까지 쓸 수 있어요',
  'not-found': '금액을 찾지 못했어요. 예: 점심 12000',
  unloaded: '문제가 생겨 열지 못했어요. 잠시 후 다시 시도해 주세요.',
  'unloaded-offline': '연결이 없어 열지 못했어요. 연결되면 다시 시도해 주세요.',
}

type Problem = keyof typeof messages

/** 보인 문구의 까닭을 고쳤는지. 고치는 동안 다른 까닭의 새 문구는 띄우지 않는다(00-common 4.4) */
function isFixed(problem: Problem, text: string): boolean {
  const chunk = loadedChunk()
  if (problem === 'not-found') return chunk?.parseOneLine(text) !== undefined
  if (problem === 'empty' || problem === 'too-long') return chunk?.oneLineProblem(text) !== problem
  return true
}

export default function OneLineInput() {
  const navigate = useNavigate()
  const ledger = useCurrentLedger()
  const owner = { userId: sessionUserId(), ledgerId: ledger.id }
  // 거래 입력(D-04)에서 돌아오면 그 글(저장했으면 빈 글자)을 두고 커서를 준다(D-04 (1), 성공 뒤 표)
  const [returned] = useState(() => oneLineReturnOf(owner))
  const [text, setText] = useState(returned ?? '')
  const [problem, setProblem] = useState<Problem>()
  const [request, setRequest] = useState<OneLineRequest>()
  const [chunk, setChunk] = useState(loadedChunk)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (returned === undefined) return
    settleOneLineReturn(returned)
    const element = input.current!
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [returned])

  useEffect(() => (chunk ? undefined : onChunkArrived(setChunk)), [chunk])

  function preload() {
    if (!loadedChunk()) oneLinePreload.preload()
  }

  function change(next: string) {
    setText(next)
    preload()
    if (problem && isFixed(problem, next)) setProblem(undefined)
  }

  /** 기기에서 해석한다. 비었거나 100자를 넘거나 금액을 찾지 못하면 D-05를 열지 않고 문구를 보이며 글을 둔다(F-210) */
  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const typed = text
    let found: OneLineChunk
    try {
      found = loadedChunk() ?? (await loadChunk())
    } catch {
      setProblem(connection() === 'offline' ? 'unloaded-offline' : 'unloaded')
      input.current?.focus()
      return
    }
    const checked = found.oneLineProblem(typed)
    const parsed = checked ? undefined : found.parseOneLine(typed)
    const next = checked ?? (parsed ? undefined : 'not-found')
    setProblem(next)
    if (!parsed) {
      input.current?.focus()
      return
    }
    seq.current += 1
    setRequest({ ...parsed, text: typed, seq: seq.current })
  }

  /** "자세히 입력": 글 전체(100자까지)를 가맹점/내용에 채운 거래 입력(D-04)을 연다 */
  function openDetail(event: MouseEvent<HTMLAnchorElement>) {
    const found = loadedChunk()
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !found) return
    event.preventDefault()
    holdKeyboard(event)
    const state = handOffToEntry(owner, { text, values: { payee: found.detailPayeeOf(text) } })
    void navigate('/transactions/new', { state })
  }

  return (
    <div className={`${styles.section} ${styles.oneLine} ${styles.inset}`}>
      <form noValidate onSubmit={(event) => void submit(event)}>
        <Field label="한 줄 입력" help="예: 점심 12000" error={problem && messages[problem]}>
          {(control) => (
            <div className={styles.oneLineRow}>
              <input
                {...control}
                ref={input}
                type="text"
                className={`${control.className} ${styles.oneLineInput}`}
                value={text}
                enterKeyHint="done"
                autoComplete="off"
                aria-invalid={problem ? true : undefined}
                onChange={(event) => change(event.target.value)}
                onFocus={preload}
                onKeyDown={keepComposingEnter}
              />
              <Button kind="secondary" type="submit">
                입력
              </Button>
            </div>
          )}
        </Field>
        {problem === 'not-found' && (
          <div className={styles.detailEntry}>
            <ButtonLink kind="text" to="/transactions/new" onClick={openDetail}>
              자세히 입력
            </ButtonLink>
          </div>
        )}
      </form>
      {chunk && <chunk.OneLineResult request={request} text={text} setText={setText} input={input} />}
    </div>
  )
}
