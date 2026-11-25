import { useEffect, useState } from 'react'
import styles from './Loading.module.css'

/** 이보다 빨리 끝나면 아무것도 보이지 않아 깜빡이지 않는다(화면설계서 00-common 4.5) */
const SHOW_AFTER_MS = 300

/** 보일 수 있는 것이 아직 하나도 없는 동안의 화면 */
export default function Loading() {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <p role="status" className={styles.loading}>
      {shown && '불러오고 있어요.'}
    </p>
  )
}
