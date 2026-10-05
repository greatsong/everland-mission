import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import { report } from './store.js'

// 화면 오류를 점검 기록으로 보낸다.
window.addEventListener('error', (e) => report('error', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`))
window.addEventListener('unhandledrejection', (e) => report('error', `약속 거부: ${e.reason?.message || e.reason}`))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
