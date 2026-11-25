import { use, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button } from './Button'
import layout from './layout.module.css'
import { LedgerNameContext } from './LedgerNameContext'
import styles from './Screen.module.css'

/** 주 화면: 탭의 첫 화면과 N 그룹. 상단 바에 장부 이름을 둔다. */
export function MainScreen({ children }: { children: ReactNode }) {
  const ledgerName = use(LedgerNameContext)
  return (
    <>
      <header className={`${layout.contentWidth} ${styles.topBar} ${styles.ledgerBar}`}>
        {ledgerName && <p className={styles.ledgerName}>{ledgerName}</p>}
      </header>
      <main className={`${layout.contentWidth} ${styles.content}`}>{children}</main>
    </>
  )
}

interface SubScreenProps {
  title: string
  /** 앞서 본 화면이 없을 때(주소를 바로 연 경우) "뒤로"가 가는 주소 */
  parent: string
  children: ReactNode
}

/** 하위 화면: 목록에서 들어간 상세, 설정, 관리 화면. 상단 바에 "뒤로"와 화면 이름을 둔다. */
export function SubScreen({ title, parent, children }: SubScreenProps) {
  const navigate = useNavigate()

  function goBack() {
    if (hasPreviousScreen()) navigate(-1)
    else navigate(parent, { replace: true })
  }

  return (
    <>
      <header className={`${layout.contentWidth} ${styles.topBar} ${styles.titleBar}`}>
        <div className={styles.back}>
          <Button kind="icon" icon="CaretLeft" aria-label="뒤로" onClick={goBack} />
        </div>
        <h1 className={styles.title}>{title}</h1>
      </header>
      <main className={`${layout.contentWidth} ${styles.content}`}>{children}</main>
    </>
  )
}

/**
 * react-router는 앱 안에서 쌓은 방문 기록의 순번을 history.state.idx에 적는다. 앱을 연 첫 화면이 0이다.
 * location.key가 'default'인지로는 알 수 없다. 첫 화면에서 주소의 달만 바꿔도 key가 바뀐다.
 * idx는 공개 API가 아니므로 react-router를 올리는 PR에서는 SubScreen.test.tsx 결과를 PR 본문에 적는다.
 */
function hasPreviousScreen(): boolean {
  return window.history.state?.idx > 0
}
