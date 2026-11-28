import type { MouseEvent, ReactNode } from 'react'
import { useLocation } from 'react-router'
import { Link } from '../components/Link'
import type { NavigationItem } from './navigation'

interface NavigationLinkProps {
  item: NavigationItem
  current: boolean
  className: string
  children: ReactNode
}

/** 하단 탭과 사이드바의 항목. 이미 그 항목의 첫 화면이면 맨 위로 스크롤한다. */
export default function NavigationLink({ item, current, className, children }: NavigationLinkProps) {
  const { pathname } = useLocation()

  function handleClick(event: MouseEvent) {
    const opensElsewhere = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    if (pathname !== item.to || opensElsewhere) return
    event.preventDefault()
    window.scrollTo(0, 0)
  }

  return (
    <Link to={item.to} aria-current={current ? 'page' : undefined} className={className} onClick={handleClick}>
      {children}
    </Link>
  )
}
