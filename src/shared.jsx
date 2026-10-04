import { useCallback, useEffect, useRef, useState } from 'react'
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

export const teachersOf = (data, teamId) => data.teams?.find((t) => t.team_id === teamId)?.teachers || ''

// 팀 인증 사진은 바뀔 때만 다시 받는다(받은 시각별로 기억).
const avatarCache = new Map()

export function TeamAvatar({ code, data, team }) {
  const profile = data.teams?.find((t) => t.team_id === team.id)
  const key = profile?.photo_at ? `${team.id}:${profile.photo_at}` : null
  const [src, setSrc] = useState(key ? avatarCache.get(key) : null)
  useEffect(() => {
    if (!key) {
      setSrc(null)
      return
    }
    if (avatarCache.has(key)) {
      setSrc(avatarCache.get(key))
      return
    }
    let alive = true
    rpc('evm_team_photo', { p_code: code, p_team: team.id })
      .then((photo) => {
        avatarCache.set(key, photo)
        if (alive) setSrc(photo)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [code, key, team.id])
  if (src) return <img className="avatar" src={src} alt={`${team.name} 인증 사진`} style={{ borderColor: team.color }} />
  return <span className="avatar empty" style={{ background: team.color }}>{team.id}</span>
}

export function Ranking({ code, data, myTeamId, showCheckin }) {
  const rows = ranking(data, teamsOf(data))
  const checkins = Object.fromEntries(data.checkins.map((c) => [c.team_id, c.at]))
  return (
    <ol className="ranking">
      {rows.map((r, i) => (
        <li key={r.team.id} className={r.team.id === myTeamId ? 'me' : ''}>
          <span className="rank">{i + 1}</span>
          <TeamAvatar code={code} data={data} team={r.team} />
          <span className="rank-detail">
            <b className="rank-name" style={{ color: r.team.color }}>{r.team.name}</b>
            {teachersOf(data, r.team.id) && <span className="rank-teachers"> {teachersOf(data, r.team.id)}</span>}
            <br />
            미션 {r.count} · 빙고 {r.lines}줄
            <small>지령 {r.order}점 · 퀴즈 {r.quiz}점</small>
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

// 에버랜드 공식 지도를 해당 좌표에 맞춰 연다.
export const everlandMapUrl = (lat, lng) => `https://www.everland.com/everland/map?lat=${lat}&lng=${lng}`

const LOCATE_MS = 60000
const LOCATE_KEY = 'evm:v2:locate'

// 위치 공유. 선생님이 켠 뒤에만 동작하고, 앱 화면이 열려 있는 동안 1분마다 본부로 보낸다.
export function useLocationShare(code, teamId) {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(LOCATE_KEY) === 'on'
    } catch {
      return false
    }
  })
  const [here, setHere] = useState(null) // { lat, lng, acc }
  const [error, setError] = useState('')
  const sendRef = useRef(null)

  const toggle = useCallback((next) => {
    try {
      localStorage.setItem(LOCATE_KEY, next ? 'on' : 'off')
    } catch {
      /* 저장이 막혀도 이번 화면에서는 동작한다 */
    }
    setError('')
    setOn(next)
  }, [])

  useEffect(() => {
    if (!on) return
    if (!navigator.geolocation) {
      setError('이 브라우저에서는 위치를 사용할 수 없습니다.')
      return
    }
    let alive = true
    const send = () => {
      if (document.visibilityState !== 'visible') return
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!alive) return
          const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) }
          setHere(next)
          setError('')
          rpc('evm_locate', { p_code: code, p_team: teamId, p_lat: next.lat, p_lng: next.lng, p_acc: next.acc }).catch(() => {})
        },
        (err) => alive && setError(err.code === 1 ? '위치 권한이 꺼져 있습니다. 브라우저 설정에서 위치를 허용합니다.' : '위치를 찾지 못했습니다.'),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
      )
    }
    sendRef.current = send
    send()
    const timer = setInterval(send, LOCATE_MS)
    document.addEventListener('visibilitychange', send)
    return () => {
      alive = false
      sendRef.current = null
      clearInterval(timer)
      document.removeEventListener('visibilitychange', send)
    }
  }, [on, code, teamId])

  // 미션을 완료할 때마다 불러 위치를 바로 갱신한다(공유가 켜져 있을 때만).
  const ping = useCallback(() => sendRef.current?.(), [])

  return { on, toggle, here, error, ping }
}

// 두 좌표 사이 거리(미터)
export function distanceM(a, b) {
  const rad = Math.PI / 180
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.round(Math.sqrt(x * x + y * y) * 6371000)
}

// 팀 위치 목록. 팀 이름을 누르면 에버랜드 공식 지도가 그 위치에서 열린다.
export function LocationList({ data, myTeamId, here }) {
  const teams = teamsOf(data)
  const rows = [{ id: 0, name: '본부', color: '#1f2a24' }, ...teams].map((t) => ({ team: t, loc: data.locations.find((l) => l.team_id === t.id) }))
  if (!rows.some((r) => r.loc)) return <p className="guide">아직 위치를 보낸 팀이 없습니다.</p>
  return (
    <ul className="loc-list">
      {rows.map(({ team, loc }) => (
        <li key={team.id}>
          <span className="rank-team" style={{ background: team.color }}>{team.name}</span>
          {loc ? (
            <>
              <span className="rank-detail">
                {minutesAgo(loc.at, data.now)}분 전{loc.acc ? ` · 오차 약 ${Math.round(loc.acc)}m` : ''}
                {here && team.id !== myTeamId && <small>우리 팀에서 약 {distanceM(here, loc)}m</small>}
              </span>
              <a href={everlandMapUrl(loc.lat, loc.lng)} target="_blank" rel="noreferrer">지도에서 보기</a>
            </>
          ) : (
            <span className="rank-detail">위치 기록 없음</span>
          )}
        </li>
      ))}
    </ul>
  )
}
