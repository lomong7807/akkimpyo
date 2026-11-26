import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
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
