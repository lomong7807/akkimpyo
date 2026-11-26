import { useSyncExternalStore } from 'react'

/** 넓은 화면인지(화면설계서 00-common 2.5). CSS로 나눌 수 없는 곳에서만 쓴다. */
export function wideScreen(): MediaQueryList {
  return window.matchMedia('(width >= 1024px)')
}

export function useWideScreen(): boolean {
  return useSyncExternalStore(subscribe, () => wideScreen().matches)
}

function subscribe(onChange: () => void) {
  const wide = wideScreen()
  wide.addEventListener('change', onChange)
  return () => wide.removeEventListener('change', onChange)
}
