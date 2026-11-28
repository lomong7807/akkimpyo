import Icon from './Icon'
import { Info } from './icons'
import styles from './Notice.module.css'

/** 알림 띠. 화면 맨 위에서 이 화면에 오게 된 까닭을 알린다. 덧붙일 말(`detail`)은 다음 줄에 같은 글자로 둔다. */
export default function Notice({ children, detail }: { children: string; detail?: string }) {
  return (
    <p role="status" className={styles.notice}>
      <Icon icon={Info} size={20} />
      <span>
        {children}
        {detail && <span className={styles.detail}>{detail}</span>}
      </span>
    </p>
  )
}
