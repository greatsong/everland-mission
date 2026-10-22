// 저장소. 팀의 기록은 기기(localStorage)에 먼저 저장하고 서버(Supabase 함수)와 맞춘다.
// 에버랜드 안에서 통신이 끊겨도 빙고는 계속 진행되고, 연결되면 밀린 것이 올라간다.

const URL_BASE = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_KEY

// 휴대폰 기록 지우기(2026-10-22, 화면을 그리기 전에 실행되도록 이 모듈에 둔다): 주소 끝에 #reset을 붙여 열면 이 휴대폰에 남은 예전 기록(입장 코드와 팀, 이 휴대폰을 가진 선생님,
// 버스 퀴즈 입장, 아직 올리지 못한 사진)을 모두 지우고 입장 화면을 연다. 예전 시험 때 들어간 팀으로 계속 열리는 휴대폰에 쓴다.
if (location.hash === '#reset') {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('evm:')).forEach((k) => localStorage.removeItem(k))
    sessionStorage.setItem('evm:reset', '1')
  } catch {
    /* 저장이 막힌 브라우저에는 지울 기록이 없다 */
  }
  history.replaceState(null, '', location.pathname + location.search)
}

const SESSION_KEY = 'evm:v2:session'
const stateKey = (teamId) => `evm:v2:state:${teamId}`

export class BadCodeError extends Error {}

// 버스 퀴즈 입장(아이들 휴대폰, 2026-10-18) 문구. 퀴즈를 하던 중에 본부가 닫으면 ENDED,
// 닫혀 있을 때 QR이나 코드로 들어오려 하면 CLOSED(아직 열리기 전일 수도 있다).
export const QUIZ_ENDED_TEXT = '버스 퀴즈가 끝났습니다. 현장에서는 선생님 휴대폰으로 진행합니다.'
export const QUIZ_CLOSED_TEXT = '버스 퀴즈 입장이 닫혀 있습니다. 선생님이 입장을 열면 QR을 다시 찍습니다.'

// 점검 보고. 접속과 오류를 서버에 남겨 시험·행사 중 문제를 추적한다.
// 같은 내용은 1분에 한 번만, 한 화면에서 최대 40건까지 보낸다. 통신이 끊겼을 때의 보고는 모아 두었다가 연결되면 보낸다.
const reported = new Map()
let reportCount = 0
const waiting = []

function post(event) {
  return fetch(`${URL_BASE}/rest/v1/rpc/evm_report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(event),
  })
}

export function report(kind, message) {
  const text = String(message ?? '').slice(0, 300)
  const key = `${kind}:${text}`
  const now = Date.now()
  if (reportCount >= 40 || now - (reported.get(key) || 0) < 60000) return
  reported.set(key, now)
  reportCount += 1
  let teamId = null
  try {
    teamId = JSON.parse(localStorage.getItem(SESSION_KEY))?.teamId ?? null
  } catch {
    /* 세션을 읽지 못하면 팀 없이 보낸다 */
  }
  const event = { p_team: teamId, p_kind: kind, p_message: text, p_ua: navigator.userAgent }
  post(event).catch(() => waiting.length < 20 && waiting.push({ ...event, p_message: `[지연] ${text}`.slice(0, 300) }))
}

function flushWaiting() {
  while (waiting.length) post(waiting.shift()).catch(() => {})
}

export async function rpc(fn, args) {
  let res
  try {
    res = await rpcFetch(fn, args)
  } catch (err) {
    report('offline', `${fn}: ${err.message}`)
    throw err
  }
  flushWaiting()
  return rpcRead(fn, res)
}

function rpcFetch(fn, args) {
  return fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(args),
  })
}

async function rpcRead(fn, res) {
  const text = await res.text()
  if (!res.ok) {
    let message = text
    try {
      message = JSON.parse(text).message || text
    } catch {
      /* JSON이 아닌 오류 본문은 그대로 사용한다 */
    }
    if (String(message).includes('EVM_QUIZ_WAITING')) {
      // 버스 퀴즈를 아직 시작하지 않았다(출발 전 닫힘). 미리 들어와 둔 휴대폰은 준비 중 화면에서 기다린다.
      const err = new BadCodeError(QUIZ_CLOSED_TEXT)
      err.ended = true
      err.waiting = true
      throw err
    }
    if (String(message).includes('EVM_QUIZ_ENDED')) {
      // 본부가 버스 퀴즈 입장을 닫았다. 아이들 휴대폰 수십 대가 보내므로 점검 기록에는 남기지 않는다.
      const err = new BadCodeError(QUIZ_ENDED_TEXT)
      err.ended = true
      throw err
    }
    report('rpc', `${fn}: ${String(message).slice(0, 200)}`)
    if (String(message).includes('EVM_BAD_CODE')) throw new BadCodeError('코드가 맞지 않습니다.')
    throw new Error(message || `요청 실패(${res.status})`)
  }
  return text ? JSON.parse(text) : null
}

// 배포 뒤 예전 화면이 열려 있으면 바뀐 화면 파일(지도 등)을 불러오지 못한다(2026-10-12 점검 기록).
// 그럴 때 화면을 새로 고친다. 계속 실패할 때 끝없이 새로 고치지 않도록 1분에 한 번까지만 한다.
export function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem('evm:reloaded')) || 0
    if (Date.now() - last < 60000) return false
    sessionStorage.setItem('evm:reloaded', String(Date.now()))
  } catch {
    return false
  }
  location.reload()
  return true
}

// 나중에 불러오는 화면(React.lazy)에 사용한다. 불러오지 못하면 새로 고치고, 새로 고치는 동안은 기다린다.
export const lazyImport = (load) => () =>
  load().catch((err) => {
    report('error', `화면 파일 불러오기 실패: ${err.message}`)
    if (reloadOnce()) return new Promise(() => {})
    throw err
  })

// 문제 추천(본부 전용). Supabase 서버 함수가 본부 코드를 확인한 뒤 Claude에 요청한다.
export async function suggestQuiz(code, kind, topic, count) {
  const res = await fetch(`${URL_BASE}/functions/v1/evm-suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ code, kind, topic, count }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.message || `추천 실패(${res.status})`)
  return body.items || []
}

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

// 세션: { code, role: 'team' | 'admin', teamId }
// 연습(practice)으로 저장된 입장 정보는 아이 화면(player)으로 읽는다. 연습을 배포한 직후 예전 화면이 practice를 그대로 저장해
// 선생님 팀 화면이 연습 자료를 읽다가 멈춘 일이 있었다(2026-10-18).
export const loadSession = () => {
  const s = read(SESSION_KEY, null)
  return s?.role === 'practice' ? { ...s, role: 'player' } : s
}
export const saveSession = (session) => write(SESSION_KEY, session)

// 팀 기록: { done: { [missionId]: { photo, at, synced } }, removed: [missionId],
//           contest: { [gameId]: { index, correct, synced } } }
export function loadState(teamId) {
  const state = { done: {}, removed: [], contest: {}, ...read(stateKey(teamId), {}) }
  // 점수 칸(points)이 없는 대결 기록은 문제당 5점으로 환산한다.
  for (const rec of Object.values(state.contest)) {
    if (typeof rec.points !== 'number') rec.points = (rec.correct || 0) * 5
  }
  return state
}
export const saveState = (teamId, state) => write(stateKey(teamId), state)

// 서버에서 받은 사진은 메모리에만 둔다. 사진을 다시 찍으면 시각(at)이 바뀌어 새로 받는다.
const photoCache = new Map()

export function fetchPhoto(code, teamId, missionId, at) {
  const key = `${teamId}:${missionId}:${at}`
  if (!photoCache.has(key)) {
    const pending = rpc('evm_photo', { p_code: code, p_team: teamId, p_mission: missionId }).catch((err) => {
      photoCache.delete(key)
      throw err
    })
    photoCache.set(key, pending)
  }
  return photoCache.get(key)
}

// 사진을 긴 변 720px JPEG로 줄여 dataURL로 돌려준다.
export function compressPhoto(file, maxSide = 720, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      report('photo', `읽기 실패: ${file.type || '종류 모름'} ${Math.round(file.size / 1024)}KB`)
      reject(new Error('사진을 읽지 못했습니다.'))
    }
    img.src = url
  })
}
