import { Outlet } from 'react-router'
import layout from '../components/layout.module.css'
import styles from './PlainLayout.module.css'

/** 공통 틀이 없는 화면(로그인, 가입, 첫 실행 안내)의 틀 */
export default function PlainLayout() {
  return (
    <main className={`${layout.contentWidth} ${styles.content}`}>
      <Outlet />
    </main>
  )
}
