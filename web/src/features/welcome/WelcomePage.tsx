import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { usePressShield } from '../../components/pressGuard'
import CategoriesStep from './CategoriesStep'
import FirstAccountStep from './FirstAccountStep'
import { useFirstAccount } from './useFirstAccount'
import styles from './Welcome.module.css'

/**
 * C-02 첫 실행 안내. 장은 주소로 나눠(/welcome, /welcome?step=2) 브라우저의 뒤로가 앞 장으로 가고,
 * 새로 고쳐도 그 장이 열린다. 언제 여는지는 앱이 정한다(app/welcomeEntry, app/WelcomeRoute).
 */
export default function WelcomePage() {
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
