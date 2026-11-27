import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import MorePage from '../features/more/MorePage'
import { useLogout } from './useLogout'

/**
 * 더보기는 휴대폰 배치에만 있는 화면이다. 넓은 화면에서는 같은 항목이 사이드바에 있으므로 홈으로 보낸다.
 * 명세의 자리는 프로필(M-02)이고, 그 화면이 들어오면 맞춘다.
 */
export default function MoreRoute() {
  const navigate = useNavigate()
  const { onLogout, dialog } = useLogout()

  useEffect(() => {
    const wide = window.matchMedia('(width >= 1024px)')
    function leaveIfWide() {
      if (wide.matches) void navigate('/home', { replace: true })
    }
    leaveIfWide()
    wide.addEventListener('change', leaveIfWide)
    return () => wide.removeEventListener('change', leaveIfWide)
  }, [navigate])

  return (
    <>
      <MorePage onLogout={onLogout} />
      {dialog}
    </>
  )
}
