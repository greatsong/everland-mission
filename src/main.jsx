import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import { report } from './store.js'

// 화면 오류를 점검 기록으로 보낸다.
window.addEventListener('error', (e) => report('error', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`))
window.addEventListener('unhandledrejection', (e) => report('error', `약속 거부: ${e.reason?.message || e.reason}`))

// 글자를 입력하는 동안(키보드가 올라온 동안) body에 typing을 붙인다. 아이폰은 키보드가 올라오면 위쪽 고정 줄이
// 화면 가운데에 떠서 문제를 가리므로, 입력하는 동안에는 고정을 풀고 그림을 줄인다(styles.css의 body.typing).
const isTextField = (el) => el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && !['radio', 'checkbox', 'button', 'submit', 'file'].includes(el.type))
document.addEventListener('focusin', (e) => { if (isTextField(e.target)) document.body.classList.add('typing') })
document.addEventListener('focusout', () => setTimeout(() => { if (!isTextField(document.activeElement)) document.body.classList.remove('typing') }, 100))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
