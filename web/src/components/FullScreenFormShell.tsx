import { use, useId, useLayoutEffect, type ReactNode } from 'react'
import { Button } from './Button'
import layout from './layout.module.css'
import { X } from './icons'
import { usePressShield } from './pressGuard'
import { markShellRise } from './shellShown'
import { ShellContext } from './ShellContext'
import { InPaneContext } from './sidePane'
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
 * 넓은 화면 오른쪽 칸에서는 FullScreenForm의 칸 모양과 같다(칸 제목 h2, main과 연결 없음 띠 없음, #244).
 */
export default function FullScreenFormShell({ title, parent, children }: FullScreenFormShellProps) {
  const goBack = useGoBack(parent)
  const { band } = use(ShellContext)
  // 닫기는 앞 화면의 "뒤로"와 같은 자리다(FullScreenForm과 같다)
  usePressShield(true)
  useLayoutEffect(markShellRise, [])
  const inPane = use(InPaneContext)
  const titleId = useId()
  const width = inPane ? '' : `${layout.contentWidth} ${layout.fullScreenForm} `
  const Title = inPane ? 'h2' : 'h1'
  const Main = inPane ? 'div' : 'main'
  return (
    <div
      className={inPane ? `${styles.screen} ${styles.inPane}` : styles.screen}
      {...(inPane && { role: 'region', 'aria-labelledby': titleId })}
    >
      <header className={`${width}${styles.head}`}>
        <div className={styles.close}>
          <Button kind="icon" icon={X} aria-label="닫기" onClick={goBack} />
        </div>
        <Title id={titleId} className={styles.title}>
          {title}
        </Title>
      </header>
      {!inPane && band}
      <Main className={styles.main}>
        <div className={styles.form}>
          <div className={`${width}${styles.fields}`}>{children}</div>
        </div>
      </Main>
    </div>
  )
}
