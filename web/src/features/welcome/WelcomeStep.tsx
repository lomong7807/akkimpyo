import type { ReactNode, Ref, SubmitEvent } from 'react'
import { keepFocusInField } from '../../components/keepFocusInField'
import layout from '../../components/layout.module.css'
import styles from './Welcome.module.css'

/** 1단계의 장 수. 초대 장(셋째 장)은 2단계에 더한다. */
const STEPS = 2

interface WelcomeStepProps {
  step: 1 | 2
  title: string
  /** 장을 옮기면 초점을 받는 제목 */
  heading: Ref<HTMLHeadingElement>
  /** 맨 아래에 고정하는 버튼과 그 위의 문구 */
  bottom: ReactNode
  /** 있으면 장 전체가 양식이고, 칸에서 엔터를 치면 부른다. */
  onSubmit?: () => void
  children: ReactNode
}

/** 첫 실행 안내(C-02)의 한 장. 위에서부터 진행 표시, 제목, 내용이고 버튼은 맨 아래에 고정한다. */
export default function WelcomeStep({ step, title, heading, bottom, onSubmit, children }: WelcomeStepProps) {
  const parts = (
    <>
      <div className={`${layout.contentWidth} ${styles.content}`}>
        <p className={styles.progress}>
          <span aria-hidden="true">{`${step}/${STEPS}`}</span>
          <span className={styles.spoken}>{`${STEPS}장 중 ${step}장`}</span>
        </p>
        <h1 ref={heading} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
        {children}
      </div>
      <div className={`${layout.contentWidth} ${styles.bottom}`}>{bottom}</div>
    </>
  )

  if (!onSubmit) return <div className={styles.screen}>{parts}</div>

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    onSubmit!()
  }

  return (
    <form className={styles.screen} noValidate onSubmit={handleSubmit} onMouseDown={keepFocusInField}>
      {parts}
    </form>
  )
}
