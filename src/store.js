// 저장소. 팀의 기록은 기기(localStorage)에 먼저 저장하고 서버(Supabase 함수)와 맞춘다.
// 에버랜드 안에서 통신이 끊겨도 빙고는 계속 진행되고, 연결되면 밀린 것이 올라간다.

const URL_BASE = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_KEY

const SESSION_KEY = 'evm:v2:session'
const stateKey = (teamId) => `evm:v2:state:${teamId}`

export class BadCodeError extends Error {}

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
    report('rpc', `${fn}: ${String(message).slice(0, 200)}`)
    if (String(message).includes('EVM_BAD_CODE')) throw new BadCodeError('코드가 맞지 않습니다.')
    throw new Error(message || `요청 실패(${res.status})`)
  }
  return text ? JSON.parse(text) : null
}

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
export const loadSession = () => read(SESSION_KEY, null)
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
