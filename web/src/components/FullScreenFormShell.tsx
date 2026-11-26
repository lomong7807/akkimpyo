import { useLayoutEffect, type ReactNode } from 'react'
import { Button } from './Button'
import layout from './layout.module.css'
import { usePressShield } from './pressGuard'
import { markShellRise } from './shellShown'
import { useGoBack } from './useGoBack'
import styles from './FullScreenForm.module.css'

interface FullScreenFormShellProps {
  title: string
  /** 앞서 본 화면이 없을 때(주소를 바로 연 경우) 닫으면 가는 주소 */
  parent: string
  /** 칸 자리에 두는 것: 뼈대나 불러오지 못한 안내 */
  children: ReactNode
}

/**
 * 전체 화면 입력의 코드를 받는 동안 그 화면 대신 그리는 틀(#251). 머리(닫기와 화면 이름)와 칸 자리가 FullScreenForm과 같고
 * 같이 올라온다. 바꾼 값이 없으므로 닫기는 묻지 않고 돌아간다. 저장 자리는 수정할 거래를 받는 동안처럼 숨긴다.
 */
export default function FullScreenFormShell({ title, parent, children }: FullScreenFormShellProps) {
  const goBack = useGoBack(parent)
  // 닫기는 앞 화면의 "뒤로"와 같은 자리다(FullScreenForm과 같다)
  usePressShield(true)
  useLayoutEffect(markShellRise, [])
  return (
    <div className={styles.screen}>
      <header className={`${layout.contentWidth} ${layout.fullScreenForm} ${styles.head}`}>
        <div className={styles.close}>
          <Button kind="icon" icon="X" aria-label="닫기" onClick={goBack} />
        </div>
        <h1 className={styles.title}>{title}</h1>
      </header>
      <main className={styles.main}>
        <div className={styles.form}>
          <div className={`${layout.contentWidth} ${layout.fullScreenForm} ${styles.fields}`}>{children}</div>
        </div>
      </main>
    </div>
  )
}
