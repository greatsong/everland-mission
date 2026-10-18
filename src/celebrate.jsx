import { useEffect, useRef, useState } from 'react'
import { josa } from './logic.js'

// 정답 축하 효과(2026-10-17, UI/UX 검토 반영 2026-10-18). 상황에 따라 크기를 다르게 한다.
// 배틀 1등(gold)이 가장 크고 2등(silver)·3등(bronze)·그 밖의 정답(ok)·늦은 정답(late) 순서로 작아진다.
// 1등만 받는 배틀에서 다른 팀이 맞히면 화면을 막지 않는 위쪽 띠(rival)로 소리 없이 알린다.
// 같은 팀의 다른 휴대폰(다른 친구·다른 선생님)이 맞혔을 때도 화면을 가리지 않는 위쪽 띠(mate)로만 알린다(2026-10-18 사용자 요청).
// 큰 축하는 답을 보낸 그 휴대폰에만 띄운다.
// 아이폰은 진동이 되지 않고 무음이면 소리도 나지 않으므로, 화면(불투명 배경·점수 숫자·팀 이름)만으로도 구분되게 한다.
// 화면을 흔들거나 번쩍이는 효과는 넣지 않는다(버스 멀미, 광과민).

// hold: 이 시간이 지나야 눌러서 닫을 수 있다(신난 아이들이 바로 닫지 않게). ms: 자동으로 닫히는 시간.
const LOOKS = {
  gold: { icon: '🏆', team: true, confetti: 180, mode: 'cannon', ms: 6000, hold: 1200, vibrate: [120, 60, 120, 60, 400], sound: true },
  silver: { icon: '🥈', team: true, confetti: 70, mode: 'rain', ms: 3500, hold: 700, vibrate: [120, 60, 250], sound: true },
  bronze: { icon: '🥉', team: true, confetti: 45, mode: 'rain', ms: 3000, hold: 700, vibrate: [200], sound: true },
  ok: { icon: '🎉', confetti: 25, mode: 'burst', ms: 2500, hold: 400, vibrate: [150], sound: true },
  late: { icon: '✅', confetti: 15, mode: 'burst', ms: 3000, hold: 400, vibrate: [80], sound: true },
  rival: { icon: '🏁', confetti: 0, ms: 4500, hold: 0, vibrate: [40], sound: false },
  mate: { icon: '🎉', confetti: 0, ms: 4000, hold: 0, vibrate: [40], sound: false },
}

// 채점 결과로 축하 모양을 정한다. points와 rank는 서버가 돌려준 값, winner는 1등 팀 이름(1등만 배틀에서 늦게 맞혔을 때),
// who는 맞힌 사람 이름(버스 퀴즈). 돌려주는 값: { tier, title, points, sub, note }
export function resultLook(quiz, points, rank, winner, who) {
  if (quiz.round === 'ot') return { tier: 'ok', title: '정답!', sub: who ? `${josa(who)} 맞혔습니다` : undefined }
  if (quiz.battle && rank === 1 && points > 0) return { tier: 'gold', title: '1등!', points, sub: who ? `${josa(who)} 가장 먼저 맞혔습니다` : '가장 먼저 맞혔습니다' }
  if (quiz.battle === 'first') {
    return { tier: 'late', title: '정답!', sub: '정답으로 기록되었습니다.', note: `점수는 가장 먼저 맞힌 ${winner || '팀'}이 받았습니다.` }
  }
  const by = who ? `${josa(who)} 맞혔습니다` : undefined
  if (quiz.battle && rank === 2) return { tier: 'silver', title: '2등!', points, sub: by }
  if (quiz.battle && rank === 3) return { tier: 'bronze', title: '3등!', points, sub: by }
  if (quiz.battle && rank) return { tier: 'ok', title: '정답!', points, sub: `${rank}등${who ? ` · ${who}` : ''}` }
  return { tier: 'ok', title: '정답!', points, sub: by }
}

const listeners = new Set()
const shown = new Set() // 이미 알린 것(같은 문제를 두 번 축하하지 않는다)

export const markShown = (key) => shown.add(key)
// 이 휴대폰이 답을 보내는 중인 문제. 채점 응답보다 상태가 먼저 와도 띠(mate)가 큰 축하를 가로채지 않게 한다.
export const answering = new Set()

// 같은 팀 다른 휴대폰이 맞혔을 때의 띠 알림 내용. rank·points는 서버 기록, who는 맞힌 사람 이름(없으면 선생님 휴대폰).
export function mateLook(quiz, points, rank, who) {
  const icon = quiz.battle && points > 0 ? ['🏆', '🥈', '🥉'][rank - 1] || '🎉' : '🎉'
  const title = who ? `${josa(who)} 맞혔습니다` : '우리 팀이 맞혔습니다'
  const sub = quiz.battle && points > 0 ? `${rank}등 · +${points}점` : points > 0 ? `+${points}점` : '정답으로 기록되었습니다'
  return { tier: 'mate', icon, title, sub }
}

// 축하를 띄운다. key가 같으면 한 번만 띄운다. detail: { key, tier, title, points, sub, note }
export function celebrate(detail) {
  if (detail.key) {
    if (shown.has(detail.key)) return
    shown.add(detail.key)
  }
  listeners.forEach((fn) => fn(detail))
}

// 떠 있는 축하를 바로 닫는다(새 배틀이 시작될 때).
export function dismissCelebration() {
  listeners.forEach((fn) => fn(null))
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// 효과음. 아이폰은 화면을 누를 때 소리 장치를 깨워 두어야 채점 결과가 온 뒤에 소리를 낼 수 있다.
// 축하 화면이 있는 동안 화면을 누를 때마다 깨우고, 처음 한 번은 소리 없는 짧은 음을 재생해 장치를 연다.
let audio = null
let primed = false
export function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)()
    if (audio.state !== 'running') audio.resume()
    if (!primed) {
      const s = audio.createBufferSource()
      s.buffer = audio.createBuffer(1, 1, 22050)
      s.connect(audio.destination)
      s.start(0)
      primed = true
    }
  } catch {
    audio = null
  }
}

// [주파수(Hz), 시작(초), 길이(초), 크기(기본 0.25)]
const TUNES = {
  gold: [[523, 0, 0.13], [659, 0.13, 0.13], [784, 0.26, 0.13], [1047, 0.39, 0.5], [784, 0.55, 0.12], [1047, 0.68, 0.3],
    [1047, 0.95, 0.7, 0.12], [1319, 0.95, 0.7, 0.12], [1568, 0.95, 0.7, 0.12]],
  silver: [[587, 0, 0.13], [740, 0.13, 0.13], [880, 0.26, 0.4]],
  bronze: [[523, 0, 0.13], [784, 0.14, 0.35]],
  ok: [[880, 0, 0.1], [1175, 0.1, 0.28]],
  late: [[784, 0, 0.12], [988, 0.12, 0.25]],
  tick: [[880, 0, 0.06, 0.1]],
  go: [[1175, 0, 0.2, 0.15]],
}

export function play(name) {
  if (!audio || audio.state !== 'running' || !TUNES[name]) return
  try {
    const t0 = audio.currentTime + 0.02
    for (const [freq, at, len, vol = 0.25] of TUNES[name]) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len)
      osc.connect(gain).connect(audio.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + len + 0.05)
    }
  } catch {
    /* 소리를 내지 못해도 화면 효과는 그대로 보인다 */
  }
}

// 배틀 카운트다운 소리. 배틀 알림과 문제 카드가 함께 떠 있어도 1초에 한 번만 낸다.
// 휴대폰마다 같은 서버 시각을 사용하므로 같은 버스의 휴대폰들이 함께 울린다.
const ticked = new Set()
export function countdownSound(quizId, sec) {
  if (sec > 3) return
  const key = `${quizId}:${sec}`
  if (ticked.has(key)) return
  ticked.add(key)
  play(sec > 0 ? 'tick' : 'go')
}

// 색종이. cannon은 아래 양쪽 모서리에서 두 번 쏘아 올리고(1등), rain은 위에서 떨어지고(2·3등), burst는 가운데에서 터진다.
// 시간 기준으로 움직여 느린 휴대폰에서도 같은 속도로 떨어진다. 사양이 낮은 휴대폰은 개수를 절반으로 줄인다.
function Confetti({ count, mode }) {
  const ref = useRef(null)
  useEffect(() => {
    if (reduced()) return
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    let w = (canvas.width = window.innerWidth)
    let h = (canvas.height = window.innerHeight)
    const onResize = () => {
      w = canvas.width = window.innerWidth
      h = canvas.height = window.innerHeight
    }
    window.addEventListener('resize', onResize)
    const low = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 2
    const n = low ? Math.round(count / 2) : count
    const colors = ['#ffd43b', '#ff6b6b', '#51cf66', '#339af0', '#cc5de8', '#ff922b']
    const rand = (a, b) => a + Math.random() * (b - a)
    const gravity = mode === 'rain' ? 0.12 : 0.5
    const parts = Array.from({ length: n }, (_, i) => {
      const base = { size: rand(7, 14), rot: rand(0, 6), vr: rand(-0.2, 0.2), color: colors[i % colors.length], delay: 0 }
      if (mode === 'cannon') {
        const left = i % 2 === 0
        return { ...base, x: left ? 0 : w, y: h, vx: (left ? 1 : -1) * rand(5, 14), vy: -rand(20, 32), delay: i % 4 > 1 ? 450 : 0 }
      }
      if (mode === 'rain') return { ...base, x: rand(0, w), y: -rand(20, h * 0.4), vx: rand(-1.2, 1.2), vy: rand(2, 4) }
      return { ...base, x: w / 2 + rand(-w * 0.15, w * 0.15), y: h * 0.42, vx: rand(-10, 10), vy: -rand(6, 18) }
    })
    const LIFE = mode === 'cannon' ? 3400 : 2600
    const start = performance.now()
    let last = start
    let frame
    const tick = (now) => {
      const t = now - start
      const k = Math.min(2, (now - last) / 16.7)
      last = now
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.globalAlpha = Math.max(0, Math.min(1, (LIFE - t) / 600))
      let alive = false
      for (const p of parts) {
        if (t < p.delay) {
          alive = true
          continue
        }
        p.vy += gravity * k
        p.vx *= mode === 'rain' ? 1 : 0.99
        p.x += (p.vx + (mode === 'rain' ? Math.sin((t + p.size * 40) / 300) * 0.8 : 0)) * k
        p.y += p.vy * k
        p.rot += p.vr * k
        if (p.y < h + 40) alive = true
        const c = Math.cos(p.rot)
        const s = Math.sin(p.rot)
        ctx.setTransform(c, s, -s, c, p.x, p.y)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      }
      if (alive && t < LIFE) frame = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, w, h)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [count, mode])
  return <canvas ref={ref} className="confetti" aria-hidden="true" />
}

// 1등 점수는 0부터 올라가며 보인다(0.7초).
function CountUp({ to, run }) {
  const [n, setN] = useState(run && !reduced() ? 0 : to)
  useEffect(() => {
    if (!run || reduced()) return
    const start = performance.now()
    let frame
    const step = (now) => {
      const p = Math.min(1, (now - start) / 700)
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))))
      if (p < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [to, run])
  return n
}

// 축하 화면. 팀 화면에 하나 두고, celebrate()가 부르면 잠깐 띄운다. teamName은 1·2·3등 축하에 표시한다.
export function CelebrationLayer({ teamName }) {
  const [item, setItem] = useState(null)
  const [closable, setClosable] = useState(false)
  useEffect(() => {
    const on = (detail) => setItem(detail ? { ...detail, id: Date.now() } : null)
    listeners.add(on)
    const wake = () => unlockAudio()
    window.addEventListener('touchend', wake, { passive: true })
    window.addEventListener('click', wake, { passive: true })
    return () => {
      listeners.delete(on)
      window.removeEventListener('touchend', wake)
      window.removeEventListener('click', wake)
    }
  }, [])
  useEffect(() => {
    if (!item) return
    const look = LOOKS[item.tier] || LOOKS.ok
    setClosable(false)
    if (look.sound) play(item.tier)
    navigator.vibrate?.(look.vibrate)
    const hold = setTimeout(() => setClosable(true), look.hold)
    const timer = setTimeout(() => setItem(null), look.ms)
    return () => {
      clearTimeout(hold)
      clearTimeout(timer)
    }
  }, [item])
  if (!item) return null
  const look = LOOKS[item.tier] || LOOKS.ok
  const banner = item.tier === 'rival' || item.tier === 'mate'
  return (
    <div className={`celebrate ${item.tier}`} onClick={() => closable && setItem(null)} role="alert">
      {look.confetti > 0 && <Confetti key={item.id} count={look.confetti} mode={look.mode} />}
      <div className="celebrate-box">
        {look.team && teamName && <p className="celebrate-team">{teamName}</p>}
        <p className="celebrate-icon">{item.icon || look.icon}</p>
        <div className="celebrate-text">
          <p className="celebrate-title">{item.title}</p>
          {item.points > 0 && (
            <p className="celebrate-points">
              +<CountUp to={item.points} run={item.tier === 'gold'} />점
            </p>
          )}
          {item.sub && <p className="celebrate-sub">{item.sub}</p>}
          {item.note && <p className="celebrate-note">{item.note}</p>}
        </div>
      </div>
      {closable && !banner && <p className="celebrate-close">화면을 누르면 닫힙니다</p>}
    </div>
  )
}
