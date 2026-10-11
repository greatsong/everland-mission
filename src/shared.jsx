import { useCallback, useEffect, useRef, useState } from 'react'
import { TEAMS } from './data.js'
import { rpc, fetchPhoto, BadCodeError, report } from './store.js'
import { ranking, agoText, distanceM, teacherNames, locationGroups } from './logic.js'

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
    // 아직 사진이 없는 칸(기록 시각이 없음)은 서버에 묻지 않는다.
    if (!at) {
      setSrc(null)
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

export const teachersOf = (data, teamId) => data.teams?.find((t) => t.team_id === teamId)?.teachers || ''

// 팀별 담당 선생님 이름 목록 { [teamId]: [이름] }
export const teacherMap = (data) => Object.fromEntries((data.teams || []).map((t) => [t.team_id, teacherNames(t.teachers)]))

// 지도와 위치 목록에서 본부는 팀 번호 0으로 표시한다.
export const HQ_TEAM = { id: 0, name: '본부', color: '#1f2a24' }

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

export function Ranking({ code, data, myTeamId }) {
  const rows = ranking(data, teamsOf(data))
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
const DEVICE_KEY = 'evm:v2:device'
const holderKey = (teamId) => `evm:v2:holder:${teamId}`

// 휴대폰 번호. 처음 한 번 만들어 기기에 저장한다. 한 팀이 휴대폰 여러 대로 위치를 보내도 서로 덮어쓰지 않는다.
let memoryDevice = null
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = Math.random().toString(36).slice(2, 10)
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    memoryDevice ??= Math.random().toString(36).slice(2, 10)
    return memoryDevice
  }
}

// 위치 공유. 선생님이 켠 뒤에만 동작한다. 앱을 열 때, 다른 앱에서 돌아올 때, 통신이 다시 연결될 때 바로 보내고,
// 화면이 열려 있는 동안 1분마다 본부로 보낸다. 화면이 꺼져 있으면 브라우저가 위치를 주지 않는다.
// 전송 시각을 시계의 1분 단위에 맞추어, 같은 팀의 휴대폰들이 거의 같은 때 위치를 기록하게 한다.
// holder: 이 휴대폰을 가진 선생님. 팀이 A조, B조로 나뉘면 지도에 이 이름이 표시된다.
export function useLocationShare(code, teamId) {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(LOCATE_KEY) === 'on'
    } catch {
      return false
    }
  })
  const [holder, setHolderState] = useState(() => {
    try {
      return localStorage.getItem(holderKey(teamId)) || ''
    } catch {
      return ''
    }
  })
  const [here, setHere] = useState(null) // { lat, lng, acc }
  const [error, setError] = useState('')
  const [lastSent, setLastSent] = useState(null) // 마지막으로 본부에 보낸 시각(ms)
  const [sending, setSending] = useState(false)
  const sendRef = useRef(null)

  const toggle = useCallback(
    (next) => {
      try {
        localStorage.setItem(LOCATE_KEY, next ? 'on' : 'off')
      } catch {
        /* 저장이 막혀도 이번 화면에서는 동작한다 */
      }
      setError('')
      setOn(next)
      if (!next) {
        // 끄면 이 휴대폰의 마지막 위치를 지도에서 지운다.
        setHere(null)
        rpc('evm_locate_off', { p_code: code, p_team: teamId, p_device: deviceId() }).catch(() => {})
      }
    },
    [code, teamId],
  )

  const setHolder = useCallback(
    (name) => {
      try {
        localStorage.setItem(holderKey(teamId), name)
      } catch {
        /* 저장이 막혀도 이번 화면에서는 동작한다 */
      }
      setHolderState(name)
    },
    [teamId],
  )

  useEffect(() => {
    if (!on) return
    if (!navigator.geolocation) {
      report('geo', '위치 기능 없음')
      setError('이 브라우저에서는 위치를 사용할 수 없습니다.')
      return
    }
    report('geo', '위치 공유 켬')
    let alive = true
    const send = () => {
      if (document.visibilityState !== 'visible') return
      setSending(true)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!alive) return
          const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) }
          setHere(next)
          rpc('evm_locate_phone', {
            p_code: code, p_team: teamId, p_device: deviceId(), p_holder: holder || null,
            p_lat: next.lat, p_lng: next.lng, p_acc: next.acc,
          })
            .then(() => {
              if (!alive) return
              setLastSent(Date.now())
              setError('')
            })
            .catch(() => alive && setError('위치를 보내지 못했습니다. 통신이 연결되면 다시 보냅니다.'))
            .finally(() => alive && setSending(false))
        },
        (err) => {
          report('geo', `위치 실패 code=${err.code} ${err.message}`)
          if (!alive) return
          setSending(false)
          setError(err.code === 1 ? '위치 권한이 꺼져 있습니다. 브라우저 설정에서 위치를 허용합니다.' : '위치를 찾지 못했습니다.')
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
      )
    }
    sendRef.current = send
    send()
    // 1분 단위가 바뀔 때마다 보낸다(5초마다 확인).
    let slot = Math.floor(Date.now() / LOCATE_MS)
    const timer = setInterval(() => {
      const now = Math.floor(Date.now() / LOCATE_MS)
      if (now !== slot) {
        slot = now
        send()
      }
    }, 5000)
    document.addEventListener('visibilitychange', send)
    window.addEventListener('online', send)
    return () => {
      alive = false
      sendRef.current = null
      clearInterval(timer)
      document.removeEventListener('visibilitychange', send)
      window.removeEventListener('online', send)
    }
  }, [on, code, teamId, holder])

  // 미션 완료, 위치 버튼을 누를 때 불러 위치를 바로 보낸다(공유가 켜져 있을 때만).
  const ping = useCallback(() => sendRef.current?.(), [])

  // 사진을 찍을 때 부른다. 위치 공유가 켜져 있으면 지금 위치(1분 안에 잰 값은 그대로 사용)를, 아니면 null을 돌려준다.
  const positionNow = useCallback(
    () =>
      new Promise((resolve) => {
        if (!on || !navigator.geolocation) return resolve(null)
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 },
        )
      }),
    [on],
  )

  return { on, toggle, here, error, ping, positionNow, holder, setHolder, lastSent, sending }
}

// 서버의 위치 목록에 이 휴대폰이 방금 기록한 위치를 반영한다. 아직 서버에 없으면 더한다.
export function withHere(locations, teamId, here, now) {
  if (!here || teamId == null) return locations
  const device = deviceId()
  const mine = locations.find((l) => l.team_id === teamId && l.device === device)
  const rest = locations.filter((l) => l !== mine)
  return [...rest, { team_id: teamId, device, holder: mine?.holder || null, ...here, at: now }]
}

const clockOf = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

// 팀이 A조, B조로 나뉘어 있으면 알린다. 예: "1팀 12분 전부터 조별 활동 중" 아래에 "A조 안은미 · B조 이민철 · 약 360m"
// 나뉜 시각(splits)은 서버가 위치를 받을 때마다 판단해 기록한다. 아직 기록이 없으면 시간 없이 알린다.
export function SplitNote({ groups, splits = [], now }) {
  const teams = [...new Set(groups.filter((g) => g.split).map((g) => g.team))]
  if (!teams.length) return null
  return (
    <ul className="split-note">
      {teams.map((team) => {
        const parts = groups.filter((g) => g.team === team)
        const far = Math.max(...parts.flatMap((a) => parts.map((b) => distanceM(a.loc, b.loc))))
        const since = splits.find((s) => s.team_id === team.id)?.since
        const who = parts.map((g) => `${g.letter}조${g.holders.length ? ` ${g.holders.join('·')}` : ''}`).join(' · ')
        return (
          <li key={team.id}>
            <span><b style={{ color: team.color }}>{team.name}</b> {since ? `${agoText(since, now)}부터 ` : ''}조별 활동 중</span>
            <small>{who} · 약 {far}m</small>
          </li>
        )
      })}
    </ul>
  )
}

// 위치 목록. 팀이 나뉘면 조마다 한 줄로 보여 준다. 이름을 누르면 에버랜드 공식 지도가 그 위치에서 열린다.
export function LocationList({ data, myTeamId, here }) {
  const teams = [HQ_TEAM, ...teamsOf(data)]
  const groups = locationGroups(data.locations, teams, teacherMap(data))
  if (!groups.length) return <p className="guide">아직 위치를 보낸 팀이 없습니다.</p>
  const device = deviceId()
  return (
    <ul className="loc-list">
      {teams.map((team) => {
        const parts = groups.filter((g) => g.team === team)
        if (!parts.length) {
          return (
            <li key={team.id}>
              <span className="rank-team" style={{ background: team.color }}>{team.name}</span>
              <span className="rank-detail">위치 기록 없음</span>
            </li>
          )
        }
        return parts.map((g) => {
          const mine = g.team.id === myTeamId && g.rows.some((r) => r.device === device)
          return (
            <li key={g.key}>
              <span className="rank-team" style={{ background: team.color }}>{g.name}</span>
              <span className="rank-detail">
                {g.split && g.holders.length > 0 && <small className="loc-holder">{g.holders.join('·')}</small>}
                <b>{clockOf(g.loc.at)}</b> 기록 · {agoText(g.loc.at, data.now)}{g.loc.acc ? ` · 오차 약 ${Math.round(g.loc.acc)}m` : ''}
                {here && !mine && <small>우리 위치에서 약 {distanceM(here, g.loc)}m</small>}
              </span>
              <a href={everlandMapUrl(g.loc.lat, g.loc.lng)} target="_blank" rel="noreferrer">지도에서 보기</a>
            </li>
          )
        })
      })}
    </ul>
  )
}
