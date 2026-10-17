import { useEffect, useRef, useState } from 'react'

// 정답 축하 효과(2026-10-17). 상황에 따라 크기를 다르게 한다. 배틀 1등이 가장 크고, 2등·3등·보통 정답 순서로 작아진다.
// 화면 전체 알림, 색종이, 짧은 효과음, 진동을 함께 사용한다. 효과음은 휴대폰이 무음이면 나지 않는다.
// 1등만 받는 배틀에서는 다른 팀에도 누가 가장 먼저 맞혔는지 알린다(rival).

const LOOKS = {
  gold: { icon: '🏆', confetti: 180, ms: 4000, vibrate: [120, 60, 120, 60, 400] },
  silver: { icon: '🥈', confetti: 90, ms: 3000, vibrate: [120, 60, 250] },
  bronze: { icon: '🥉', confetti: 60, ms: 2800, vibrate: [200] },
  ok: { icon: '🎉', confetti: 40, ms: 2400, vibrate: [150] },
  late: { icon: '👍', confetti: 0, ms: 3000, vibrate: [80] },
  rival: { icon: '🏁', confetti: 0, ms: 3500, vibrate: [60, 60, 60] },
}

// 채점 결과로 축하 모양을 정한다. points와 rank는 서버가 돌려준 값, winner는 1등 팀 이름(1등만 배틀에서 늦게 맞혔을 때).
export function resultLook(quiz, points, rank, winner) {
  if (quiz.battle && rank === 1 && points > 0) return { tier: 'gold', title: '1등!', sub: `+${points}점 · 가장 먼저 맞혔습니다` }
  if (quiz.battle === 'first') return { tier: 'late', title: '정답입니다', sub: `1등은 ${winner || '다른 팀'}입니다. 이번 문제는 점수가 없습니다.` }
  if (quiz.battle && rank === 2) return { tier: 'silver', title: '2등!', sub: `+${points}점` }
  if (quiz.battle && rank === 3) return { tier: 'bronze', title: '3등!', sub: `+${points}점` }
  if (quiz.battle && rank) return { tier: 'ok', title: '정답!', sub: `${rank}등 · +${points}점` }
  return { tier: 'ok', title: '정답!', sub: `+${points}점` }
}

const listeners = new Set()
const shown = new Set() // 이미 알린 것(같은 문제를 두 번 축하하지 않는다)

export const markShown = (key) => shown.add(key)

// 축하를 띄운다. key가 같으면 한 번만 띄운다. detail: { key, tier, title, sub }
export function celebrate(detail) {
  if (detail.key) {
    if (shown.has(detail.key)) return
    shown.add(detail.key)
  }
  listeners.forEach((fn) => fn(detail))
}

// 효과음. 아이폰은 화면을 누를 때 소리 장치를 깨워 두어야 채점 결과가 온 뒤에 소리를 낼 수 있다.
let audio = null
export function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)()
    if (audio.state === 'suspended') audio.resume()
  } catch {
    audio = null
  }
}

// [주파수(Hz), 시작(초), 길이(초)]
const TUNES = {
  gold: [[523, 0, 0.13], [659, 0.13, 0.13], [784, 0.26, 0.13], [1047, 0.39, 0.5], [784, 0.55, 0.12], [1047, 0.68, 0.6]],
  silver: [[587, 0, 0.13], [740, 0.13, 0.13], [880, 0.26, 0.4]],
  bronze: [[523, 0, 0.13], [784, 0.14, 0.35]],
  ok: [[880, 0, 0.1], [1175, 0.1, 0.28]],
  late: [[660, 0, 0.25]],
  rival: [[392, 0, 0.18], [330, 0.2, 0.32]],
}

function play(tier) {
  if (!audio || !TUNES[tier]) return
  try {
    const t0 = audio.currentTime + 0.02
    for (const [freq, at, len] of TUNES[tier]) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + at)
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len)
      osc.connect(gain).connect(audio.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + len + 0.05)
    }
  } catch {
    /* 소리를 내지 못해도 화면 효과는 그대로 보인다 */
  }
}

// 색종이. 화면 가운데에서 터져 떨어진다. 움직임 줄이기를 켠 휴대폰에서는 그리지 않는다.
function Confetti({ count }) {
  const ref = useRef(null)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = (canvas.width = window.innerWidth * dpr)
    const h = (canvas.height = window.innerHeight * dpr)
    const colors = ['#ffd43b', '#ff6b6b', '#51cf66', '#339af0', '#cc5de8', '#ff922b']
    const parts = Array.from({ length: count }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.42,
      vx: (Math.random() - 0.5) * 20 * dpr,
      vy: (-Math.random() * 20 - 6) * dpr,
      size: (7 + Math.random() * 7) * dpr,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.35,
      color: colors[Math.floor(Math.random() * colors.length)],
    }))
    const LIFE = 3200
    const start = performance.now()
    let frame
    const tick = (now) => {
      const t = now - start
      ctx.clearRect(0, 0, w, h)
      ctx.globalAlpha = Math.max(0, 1 - t / LIFE)
      for (const p of parts) {
        p.vy += 0.5 * dpr
        p.vx *= 0.99
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vr
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        ctx.restore()
      }
      if (t < LIFE) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [count])
  return <canvas ref={ref} className="confetti" aria-hidden="true" />
}

// 축하 화면. 팀 화면에 하나 두고, celebrate()가 부르면 잠깐 띄운다. 누르면 바로 닫힌다.
export function CelebrationLayer() {
  const [item, setItem] = useState(null)
  useEffect(() => {
    const on = (detail) => setItem({ ...detail, id: Date.now() })
    listeners.add(on)
    return () => listeners.delete(on)
  }, [])
  useEffect(() => {
    if (!item) return
    const look = LOOKS[item.tier] || LOOKS.ok
    play(item.tier)
    navigator.vibrate?.(look.vibrate)
    const timer = setTimeout(() => setItem(null), look.ms)
    return () => clearTimeout(timer)
  }, [item])
  if (!item) return null
  const look = LOOKS[item.tier] || LOOKS.ok
  return (
    <div className={`celebrate ${item.tier}`} onClick={() => setItem(null)} role="status" aria-live="assertive">
      {look.confetti > 0 && <Confetti key={item.id} count={look.confetti} />}
      <div className="celebrate-box">
        <p className="celebrate-icon">{look.icon}</p>
        <p className="celebrate-title">{item.title}</p>
        {item.sub && <p className="celebrate-sub">{item.sub}</p>}
      </div>
    </div>
  )
}
