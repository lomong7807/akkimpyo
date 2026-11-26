import type { ReactNode } from 'react'
import { useParams } from 'react-router'
import FullScreenFormShell from '../components/FullScreenFormShell'
import { TitleBar } from '../components/Screen'
import styles from './screenFrames.module.css'

/* 따로 싣는 화면(screens.tsx)의 틀 가운데 주소나 배치가 다른 것 */

/** 거래 수정을 닫으면 그 거래의 상세로 간다 */
export function TransactionEditFrame({ children }: { children: ReactNode }) {
  const { id } = useParams()
  return (
    <FullScreenFormShell title="거래 수정" parent={`/transactions/${id}`}>
      {children}
    </FullScreenFormShell>
  )
}

/** 가입은 공통 틀이 없다. 기다림 글은 상단 바 아래 남은 영역의 가운데다(designer #257). */
export function SignupFrame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <TitleBar title="가입" parent="/login" />
      <main className={styles.content}>{children}</main>
    </div>
  )
}
