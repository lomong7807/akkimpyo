import { ButtonLink } from '../../components/Button'
import styles from './AuthLink.module.css'

interface AuthLinkProps {
  question: string
  to: '/login' | '/signup'
  /** 쓴 이메일. 이것 말고 다른 값은 넘기지 않는다. */
  email: string
  children: string
}

/** 로그인과 가입 화면이 서로에게 가는 줄 */
export default function AuthLink({ question, to, email, children }: AuthLinkProps) {
  return (
    <p className={styles.row}>
      <span>{question}</span>{' '}
      <span className={styles.link}>
        <ButtonLink kind="text" to={to} state={{ email }}>
          {children}
        </ButtonLink>
      </span>
    </p>
  )
}
