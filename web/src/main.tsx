import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import { restoreSession } from './api/session'
import App from './app/App'

// 확인하지 못하면 로그인하지 않은 상태로 시작한다. 다시 확인하려면 restoreSession을 다시 부른다.
restoreSession().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
