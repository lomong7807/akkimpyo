import { useEffect, useRef, useState, useSyncExternalStore, type SubmitEvent } from 'react'
import { connection } from '../../api/connection'
import { sessionUserId } from '../../api/session'
import { Button } from '../../components/Button'
import Field from '../../components/Field'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { keepComposingEnter } from '../transactions/composingKey'
import type { OneLineProblem } from './oneLineChunk'
import { loadChunk, loadedChunk, onChunkArrived, oneLinePreload, type OneLineChunk } from './oneLineLoader'
import type { OneLineRequest } from './OneLineResult'
import styles from './Home.module.css'

/*
 * C-01 (1) 한 줄 입력(F-114, #233). 첫 화면 묶음에는 입력칸과 조각을 받지 못했을 때의 문구만 둔다. 해석기, 해석하지 않을 때의 문구와
 * "자세히 입력", 결과 확인(D-05)은 따로 싣는 조각(oneLineChunk)이다. 조각은 입력칸이 초점을 받거나 글을 쓰기 시작하면, 그리고 홈이
 * 한가할 때(LedgerLayout) 받는다. 받지 못하면 오류 자리에 알리고 쓴 글은 그대로 둔다(designer #233). 해석은 기기에서 바로 끝나므로
 * 처리 중 표시가 없다(C-01 상태).
 */

/** 조각을 받지 못했다 */
const unloaded = {
  unloaded: '문제가 생겨 열지 못했어요. 잠시 후 다시 시도해 주세요.',
  'unloaded-offline': '연결이 없어 열지 못했어요. 연결되면 다시 시도해 주세요.',
}

type Unloaded = keyof typeof unloaded

function isUnloaded(problem: Unloaded | OneLineProblem): problem is Unloaded {
  return problem in unloaded
}

export default function OneLineInput() {
  const ledger = useCurrentLedger()
  const owner = { userId: sessionUserId(), ledgerId: ledger.id }
  // 거래 입력(D-04)에서 돌아오면 그 글(저장했으면 빈 글자)을 두고 커서를 준다(D-04 (1), 성공 뒤 표). 넘긴 값이 있으면 조각은 받아 있다
  const [returned] = useState(() => loadedChunk()?.oneLineReturnOf(owner))
  const [text, setText] = useState(returned ?? '')
  const [problem, setProblem] = useState<Unloaded | OneLineProblem>()
  const [request, setRequest] = useState<OneLineRequest>()
  // 조각이 오면 다시 그린다. 그리기와 듣기 사이에 온 조각도 놓치지 않는다
  const chunk = useSyncExternalStore(onChunkArrived, loadedChunk)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (returned === undefined) return
    loadedChunk()?.settleOneLineReturn(returned)
    const element = input.current!
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [returned])

  function preload() {
    if (!loadedChunk()) oneLinePreload.preload()
  }

  function change(next: string) {
    setText(next)
    preload()
    // 보인 문구는 그 까닭을 고치면 지운다. 조각을 받지 못한 문구는 다시 쓰기 시작하면 지운다
    if (problem && (isUnloaded(problem) || loadedChunk()?.isFixed(problem, next))) setProblem(undefined)
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
    const read = found.readOneLine(typed)
    if (typeof read === 'string') {
      setProblem(read)
      input.current?.focus()
      return
    }
    setProblem(undefined)
    seq.current += 1
    setRequest({ ...read, text: typed, seq: seq.current })
  }

  const message = problem && (isUnloaded(problem) ? unloaded[problem] : chunk?.problemMessages[problem])
  return (
    <div className={`${styles.section} ${styles.oneLine} ${styles.inset}`}>
      <form noValidate onSubmit={(event) => void submit(event)}>
        <Field label="한 줄 입력" help="예: 점심 12000" error={message}>
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
        {problem === 'not-found' && chunk && <chunk.DetailEntry text={text} />}
      </form>
      {chunk && <chunk.OneLineResult request={request} text={text} setText={setText} input={input} />}
    </div>
  )
}
