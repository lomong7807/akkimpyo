import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import App from './app/App'
import { registerServiceWorker } from './app/registerServiceWorker'

// 연결 없이도 앱을 열게 service worker를 등록한다(F-120, #234 C). 배포 빌드에서만, 첫 화면을 받은 뒤에 한다.
// 등록 코드는 작아(gzip 0.1kB) 따로 싣지 않는다. 따로 실으면 미리 싣기 도우미가 붙어 첫 묶음이 오히려 0.7kB 커졌다
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => registerServiceWorker())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
