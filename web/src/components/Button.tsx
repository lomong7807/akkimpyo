import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import Icon, { type IconSvg } from './Icon'
import { Link, type LinkProps } from './Link'
import styles from './Button.module.css'

type ButtonLook =
  | {
      /** 주, 보조, 글자, 지우거나 없애는 동작의 글자, 위험 */
      kind: 'primary' | 'secondary' | 'text' | 'text-danger' | 'danger'
      children: ReactNode
      icon?: never
      'aria-label'?: string
    }
  | {
      kind: 'icon'
      icon: IconSvg
      'aria-label': string
      children?: never
    }
  | {
      /** 짧은 기호를 적은 44x44px 보조 버튼 */
      kind: 'square'
      children: string
      icon?: never
      'aria-label': string
    }

// 모양은 종류로만 고른다. 화면에서 덮어쓸 수 있는 속성은 받지 않는다.
type WithoutLook<Props> = Omit<Props, 'className' | 'style' | 'children' | 'aria-label' | 'disabled'>

type ButtonProps = ButtonLook &
  WithoutLook<ComponentProps<'button'>> & {
    /** 비활성. 초점은 받지만 눌러도 동작하지 않는다. */
    disabled?: boolean
    /** 처리 중. 비활성이 되고 글자 자리에 돌아가는 원을 그린다. 폭은 그대로다. */
    busy?: boolean
  }

type ButtonLinkProps = ButtonLook & WithoutLook<LinkProps>

const kindClasses = {
  primary: styles.primary,
  secondary: styles.secondary,
  text: styles.text,
  'text-danger': styles.textDanger,
  danger: styles.danger,
  icon: styles.icon,
  square: `${styles.secondary} ${styles.square}`,
}

function classNameOf(kind: ButtonLook['kind']): string {
  return `${styles.button} ${kindClasses[kind]}`
}

/** 보내기 버튼이면 양식도 보내지 않는다. */
function ignoreClick(event: MouseEvent) {
  event.preventDefault()
}

export function Button({
  kind,
  icon,
  children,
  disabled = false,
  busy = false,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps) {
  const inactive = disabled || busy
  return (
    <button
      {...rest}
      type={type}
      className={classNameOf(kind)}
      aria-disabled={inactive || undefined}
      aria-busy={busy || undefined}
      onClick={inactive ? ignoreClick : onClick}
    >
      <span className={styles.content}>{icon ? <Icon icon={icon} size={24} /> : children}</span>
      {busy && <span className={`status-motion ${styles.spinner}`} aria-hidden="true" />}
    </button>
  )
}

/** 누르면 다른 주소로 가는 버튼. 링크(a)로 그린다. */
export function ButtonLink({ kind, icon, children, ...rest }: ButtonLinkProps) {
  return (
    <Link {...rest} className={classNameOf(kind)}>
      <span className={styles.content}>{icon ? <Icon icon={icon} size={24} /> : children}</span>
    </Link>
  )
}
