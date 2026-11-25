import Icon from './Icon'
import styles from './Notice.module.css'

/** 알림 띠. 화면 맨 위에서 이 화면에 오게 된 까닭을 알린다. */
export default function Notice({ children }: { children: string }) {
  return (
    <p role="status" className={styles.notice}>
      <Icon name="Info" size={20} />
      <span>{children}</span>
    </p>
  )
}
