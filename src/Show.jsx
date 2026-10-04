import { useEffect, useMemo, useState } from 'react'
import { TEAMS, MISSIONS, VERSE } from './data.js'
import { doneByTeam, versePieces } from './logic.js'
import { useRemote, Photo } from './shared.jsx'

const SLIDE_MS = 5000

// 슬라이드쇼. 올라온 사진을 시간 순서로 넘기고 마지막에 말씀을 보여 준다.
export default function Show({ session, onLogout }) {
  const { data } = useRemote(session.code, onLogout)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  const slides = useMemo(() => {
    if (!data) return []
    const photos = [...data.submissions].reverse().map((sub) => ({ type: 'photo', sub }))
    return photos.length ? [...photos, { type: 'verse' }] : []
  }, [data])

  useEffect(() => {
    if (paused || slides.length < 2) return
    const timer = setInterval(() => setIndex((i) => i + 1), SLIDE_MS)
    return () => clearInterval(timer)
  }, [paused, slides.length])

  if (!data) return <main className="show"><p className="show-msg">불러오는 중입니다.</p></main>
  if (!slides.length) return <main className="show"><p className="show-msg">아직 올라온 사진이 없습니다.</p><a className="show-exit" href="#">닫기</a></main>

  const slide = slides[index % slides.length]
  return (
    <main className="show" onClick={() => setPaused(!paused)}>
      {slide.type === 'photo' ? <PhotoSlide code={session.code} sub={slide.sub} /> : <VerseSlide data={data} />}
      <p className="show-bar">
        {(index % slides.length) + 1} / {slides.length}
        {paused ? ' · 멈춤(화면을 누르면 다시 재생)' : ''}
      </p>
      <a className="show-exit" href="#" onClick={(e) => e.stopPropagation()}>닫기</a>
    </main>
  )
}

function PhotoSlide({ code, sub }) {
  const team = TEAMS.find((t) => t.id === sub.team_id)
  const mission = MISSIONS.find((m) => m.id === sub.mission_id)
  return (
    <>
      <Photo key={`${sub.team_id}:${sub.mission_id}:${sub.at}`} code={code} sub={sub} alt={mission?.title || '미션 사진'} className="show-photo" />
      <p className="show-caption">
        <b style={{ background: team?.color }}>{team?.name}</b> {mission?.icon} {mission?.title}
      </p>
    </>
  )
}

function VerseSlide({ data }) {
  const map = doneByTeam(data.submissions)
  const counts = Object.fromEntries(TEAMS.map((t) => [t.id, Object.keys(map[t.id]).length]))
  const words = versePieces(counts)
  return (
    <div className="show-verse">
      <p>{words.map((w) => (w.open ? w.text : '○○')).join(' ')}</p>
      <small>{VERSE.ref}</small>
    </div>
  )
}
