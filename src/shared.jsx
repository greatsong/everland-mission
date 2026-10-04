import { useCallback, useEffect, useState } from 'react'
import { VERSES, TEAMS } from './data.js'
import { rpc, fetchPhoto, BadCodeError } from './store.js'
import { versePieces, ranking, minutesAgo } from './logic.js'

const POLL_MS = 15000
const TEAM_COUNT_KEY = 'evm:v2:teamCount'

// 참가 팀 목록. 팀 수는 본부가 정하고, 통신이 끊겼을 때는 마지막으로 받은 값을 사용한다.
export function teamsOf(data) {
  let count = data?.team_count
  try {
    if (count) localStorage.setItem(TEAM_COUNT_KEY, String(count))
    else count = Number(localStorage.getItem(TEAM_COUNT_KEY))
  } catch {
    /* 저장이 막힌 브라우저에서는 기본값을 사용한다 */
  }
  return TEAMS.slice(0, count || TEAMS.length)
}

// 서버 상태를 주기적으로 받아 온다. 화면이 다시 보일 때도 받아 온다.
export function useRemote(code, onBadCode) {
  const [data, setData] = useState(null)
  const [online, setOnline] = useState(true)

  const refresh = useCallback(async () => {
    const startedAt = Date.now()
    try {
      const next = await rpc('evm_state', { p_code: code })
      setData({ ...next, startedAt })
      setOnline(true)
    } catch (err) {
      if (err instanceof BadCodeError) onBadCode()
      else setOnline(false)
    }
  }, [code, onBadCode])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return { data, online, refresh }
}

// 기기에 사진이 있으면 그것을 사용하고, 없으면 서버에서 받는다.
export function usePhoto(code, teamId, missionId, at, local) {
  const [src, setSrc] = useState(local || null)
  useEffect(() => {
    if (local) {
      setSrc(local)
      return
    }
    let alive = true
    setSrc(null)
    fetchPhoto(code, teamId, missionId, at)
      .then((photo) => alive && setSrc(photo))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [code, teamId, missionId, at, local])
  return src
}

export function Photo({ code, sub, alt, className }) {
  const src = usePhoto(code, sub.team_id, sub.mission_id, sub.at)
  if (!src) return <div className={`photo-wait ${className || ''}`}>사진을 불러오는 중입니다</div>
  return <img className={className} src={src} alt={alt} />
}

export function VerseView({ counts, myTeamId, teams }) {
  const words = versePieces(counts, teams)
  const openCount = words.filter((w) => w.open).length
  return (
    <>
      {VERSES.map((verse, part) => (
        <div key={verse.ref} className="verse-block">
          <div className="verse">
            {words.filter((w) => w.part === part).map((w, i) => (
              <span key={i} className={`piece ${w.teamId === myTeamId ? 'mine' : ''} ${w.open ? 'open' : ''}`}>
                {w.open ? w.text : '？'}
              </span>
            ))}
          </div>
          <p className="verse-ref">{verse.ref}</p>
        </div>
      ))}
      <p className="verse-count">
        전체 조각 <b>{openCount}</b>/{words.length}
        {openCount === words.length && ' · 말씀이 완성되었습니다 🎉'}
      </p>
    </>
  )
}

export function Ranking({ data, myTeamId, showCheckin }) {
  const rows = ranking(data, teamsOf(data))
  const checkins = Object.fromEntries(data.checkins.map((c) => [c.team_id, c.at]))
  return (
    <ol className="ranking">
      {rows.map((r, i) => (
        <li key={r.team.id} className={r.team.id === myTeamId ? 'me' : ''}>
          <span className="rank">{i + 1}</span>
          <span className="rank-team" style={{ background: r.team.color }}>{r.team.name}</span>
          <span className="rank-detail">
            미션 {r.count} · 빙고 {r.lines}줄
            <small>지령 {r.order}점 · 대결 {r.quiz}점</small>
            {showCheckin && (
              <small>
                {checkins[r.team.id] ? `인원 확인 ${minutesAgo(checkins[r.team.id], data.now)}분 전` : '인원 확인 기록 없음'}
              </small>
            )}
          </span>
          <b className="rank-score">{r.score}점</b>
        </li>
      ))}
    </ol>
  )
}
