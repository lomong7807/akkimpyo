import type { ReactNode } from 'react'
import { Outlet } from 'react-router'
import layout from '../components/layout.module.css'
import styles from './PlainLayout.module.css'

/** 공통 틀이 없는 화면(로그인, 첫 실행 안내)의 틀 */
export default function PlainLayout({ children = <Outlet /> }: { children?: ReactNode }) {
  return <main className={`${layout.contentWidth} ${styles.content}`}>{children}</main>
}
