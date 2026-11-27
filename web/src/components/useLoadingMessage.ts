import { useEffect, useState } from 'react'

/** 이보다 빨리 끝나면 아무것도 보이지 않아 깜빡이지 않는다(화면설계서 00-common 4.5) */
const SHOW_AFTER_MS = 300

/** 불러오는 중에 알릴 글. 300ms가 지나기 전에는 없다. */
export function useLoadingMessage(): string | undefined {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [])

  return shown ? '불러오고 있어요.' : undefined
}
