import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { usePressShield } from '../../components/pressGuard'
import { useConnection } from '../connection/useConnection'
import CategoriesStep from './CategoriesStep'
import FirstAccountStep from './FirstAccountStep'
import { useFirstAccount } from './useFirstAccount'
import styles from './Welcome.module.css'

/** 안내는 연결이 필요하다(F-119). 들어올 때 연결이 없으면 안내 대신 이 한 줄만 화면 가운데에 둔다(C-02 네트워크 오류) */
const WAITING = '연결되면 시작할 수 있어요'

/**
 * C-02 첫 실행 안내. 장은 주소로 나눠(/welcome, /welcome?step=2) 브라우저의 뒤로가 앞 장으로 가고,
 * 새로 고쳐도 그 장이 열린다. 언제 여는지는 앱이 정한다(app/welcomeEntry, app/WelcomeRoute).
 * 들어올 때 연결이 없으면 "연결되면 시작할 수 있어요"만 보이고, 연결이 돌아오면 저절로 첫 장을 보인다. 쓰는 중에 끊기면 장은
 * 그대로이고 둘째 장의 버튼만 비활성이 된다(FirstAccountStep).
 */
export default function WelcomePage() {
  const online = useConnection() === 'online'
  // 들어온 때만 본다. 연결이 돌아오면 다시 기다리지 않는다
  const [waiting, setWaiting] = useState(!online)
  if (waiting && online) setWaiting(false)
  if (waiting) {
    return (
      <main className={styles.waiting}>
        <p role="status" className={styles.waitingText}>
          {WAITING}
        </p>
      </main>
    )
  }
  return <WelcomeSteps />
}

function WelcomeSteps() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const step = searchParams.get('step') === '2' ? 2 : 1
  const account = useFirstAccount()
  const heading = useStepHeading(step)
  // 버튼은 다음 화면의 같은 자리에 다른 것이 있다(안내를 떠나면 하단 탭, 첫 장의 "다음" 뒤에는 "계좌 만들기").
  // 안내를 떠날 때와 첫 장을 넘길 때 이어서 두드린 것이 거기 닿지 않게 잠깐 덮는다
  usePressShield(true)
  usePressShield(step === 1)
  return (
    <main className={styles.page}>
      {step === 1 ? (
        <CategoriesStep heading={heading} onNext={() => navigate({ search: '?step=2' })} />
      ) : (
        <FirstAccountStep heading={heading} account={account} />
      )}
    </main>
  )
}

/** 장을 옮기면 새 장의 제목에 초점을 둔다. 누른 버튼이 사라져 초점을 잃지 않게 하고, 화면 읽기가 새 장을 읽게 한다. */
function useStepHeading(step: number) {
  const heading = useRef<HTMLHeadingElement>(null)
  const shownStep = useRef(step)
  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    heading.current?.focus()
  }, [step])
  return heading
}
