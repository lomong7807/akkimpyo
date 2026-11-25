import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import { restoreSession } from './api/session'
import App from './app/App'

// 확인하지 못해도 화면을 막지 않는다. 로그인이 필요한 요청이 401을 받으면 그때 다시 갱신한다.
restoreSession().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
