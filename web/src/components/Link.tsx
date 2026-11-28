import type { AnchorHTMLAttributes, MouseEvent, Ref } from 'react'
import { matchPath, useHref, useLinkClickHandler, useLocation, useResolvedPath, type To } from 'react-router'

/*
 * 앱 안 주소로 가는 링크(#355). react-router의 Link·NavLink 대신 쓴다. 그 둘은 앱이 쓰지 않는 prefetch·discover
 * (프레임워크 모드) 부품을 함께 끌어와 첫 화면 JS를 키운다. react-router의 공개 훅만 쓰고 앱이 쓰는 속성만 받는다.
 * 누름은 react-router의 Link와 같이 useLinkClickHandler가 다룬다. 보조 키(⌘, Ctrl, Shift, Alt)를 누른 누름,
 * 왼쪽이 아닌 단추, target이 _self가 아닌 링크는 가로채지 않고 브라우저에 맡긴다(새 탭·새 창으로 열기).
 * replace를 주지 않으면 지금 주소와 같은 곳으로 갈 때만 방문 기록을 바꿔 쓴다(react-router와 같다).
 * react-router의 Link·NavLink를 다시 불러오면 줄인 양이 사라지므로 ESLint가 막는다.
 */

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** 앱 안 주소. 다른 사이트의 주소는 <a href>로 쓴다 */
  to: To
  replace?: boolean
  /** 옮겨 간 화면이 location.state로 읽는 값 */
  state?: unknown
  /** 옮겨 갈 때 스크롤 위치를 되살리거나 맨 위로 옮기지 않는다(ScrollRestoration) */
  preventScrollReset?: boolean
  ref?: Ref<HTMLAnchorElement>
}

export function Link({ to, replace, state, preventScrollReset, target, onClick, ...rest }: LinkProps) {
  const href = useHref(to)
  const navigate = useLinkClickHandler<HTMLAnchorElement>(to, { replace, state, target, preventScrollReset })

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (!event.defaultPrevented) navigate(event)
  }

  return <a {...rest} href={href} target={target} onClick={handleClick} />
}

export interface NavLinkProps extends Omit<LinkProps, 'aria-current'> {
  /** 참이면 주소가 꼭 같을 때만 지금 화면으로 본다. 거짓이면 그 아래 주소에서도 지금 화면이다 */
  end?: boolean
}

/** 지금 화면이면 aria-current="page"를 다는 링크. 지금 화면 표시의 모양은 CSS의 [aria-current]로 준다 */
export function NavLink({ end = false, ...rest }: NavLinkProps) {
  const { pathname } = useLocation()
  const destination = useResolvedPath(rest.to)
  const current = matchPath({ path: destination.pathname, end }, pathname) !== null
  return <Link {...rest} aria-current={current ? 'page' : undefined} />
}
