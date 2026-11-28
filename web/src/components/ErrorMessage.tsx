import type { ComponentProps } from 'react'
import Icon from './Icon'
import { WarningCircle } from './icons'
import styles from './ErrorMessage.module.css'

type ErrorMessageProps = Pick<ComponentProps<'p'>, 'id' | 'role'> & { children: string }

/** 오류 문구(화면설계서 00-common 4.3, 4.4). 입력칸 아래와 버튼 위에 쓴다. */
export default function ErrorMessage({ children, ...rest }: ErrorMessageProps) {
  return (
    <p {...rest} className={styles.message}>
      <Icon icon={WarningCircle} size={20} />
      <span>{children}</span>
    </p>
  )
}
