import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TEAMS, MISSIONS } from './data.js'
import { rpc, BadCodeError, loadSession, saveSession, loadState, saveState, compressPhoto } from './store.js'
import { boardFor, scoreOf, doneByTeam, minutesAgo } from './logic.js'
import { useRemote, usePhoto, Photo, VerseView, Ranking, teamsOf } from './shared.jsx'
import Games from './Games.jsx'
import Hq from './Hq.jsx'
import Show from './Show.jsx'

const TABS = [
  { id: 'bingo', label: '빙고', icon: '🎯' },
  { id: 'games', label: '줄 게임', icon: '🎲' },
  { id: 'verse', label: '말씀', icon: '📖' },
  { id: 'all', label: '모두', icon: '🏆' },
]

function useHashRoute() {
  const [route, setRoute] = useState(() => location.hash.replace('#', ''))
  useEffect(() => {
    const onChange = () => setRoute(location.hash.replace('#', ''))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export default function App() {
  const [session, setSessionState] = useState(loadSession)
  const route = useHashRoute()

  const setSession = useCallback((next) => {
    saveSession(next)
    setSessionState(next)
  }, [])
  const logout = useCallback(() => setSession(null), [setSession])

  if (!session) return <Login onLogin={setSession} />
  if (route === 'hq') return <Hq session={session} onLogout={logout} />
  if (route === 'show') return <Show session={session} onLogout={logout} />
  if (!session.teamId) return <TeamSelect session={session} onSelect={(teamId) => setSession({ ...session, teamId })} onLogout={logout} />
  return (
    <TeamHome
      key={session.teamId}
      session={session}
      onLeave={() => setSession({ ...session, teamId: null })}
      onLogout={logout}
    />
  )
}

function Login({ onLogin }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const value = code.trim().toLowerCase()
    if (!value) return
    setBusy(true)
    setError('')
    try {
      const role = await rpc('evm_login', { p_code: value })
      if (role) onLogin({ code: value, role, teamId: null })
      else setError('코드가 맞지 않습니다.')
    } catch {
      setError('연결하지 못했습니다. 통신 상태를 확인한 뒤 다시 시도합니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="select">
      <p className="select-emoji">🎡</p>
      <h1>에버랜드 미션</h1>
      <p className="sub">선생님께 받은 입장 코드를 입력합니다.</p>
      <form className="login" onSubmit={submit}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="입장 코드"
          aria-label="입장 코드"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
        />
        <button className="primary" disabled={busy}>{busy ? '확인 중입니다' : '입장'}</button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  )
}

function TeamSelect({ session, onSelect, onLogout }) {
  const { data } = useRemote(session.code, onLogout)
  return (
    <main className="select">
      <p className="select-emoji">🎡</p>
      <h1>에버랜드 미션</h1>
      <p className="sub">우리 팀을 선택합니다. 선생님 휴대폰 한 대로 진행합니다.</p>
      <div className="team-grid">
        {teamsOf(data).map((t) => (
          <button key={t.id} className="team-btn" style={{ background: t.color }} onClick={() => onSelect(t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      <p className="select-links">
        {session.role === 'admin' && <a href="#hq">본부 화면</a>}
        <a href="#show">슬라이드쇼</a>
        <button className="link" onClick={onLogout}>코드 다시 입력</button>
      </p>
    </main>
  )
}

function TeamHome({ session, onLeave, onLogout }) {
  const { code, teamId } = session
  const team = TEAMS.find((t) => t.id === teamId)
  const board = useMemo(() => boardFor(teamId), [teamId])
  const [state, setState] = useState(() => loadState(teamId))
  const [tab, setTab] = useState('bingo')
  const [notice, setNotice] = useState('')
  const { data, online, refresh } = useRemote(code, onLogout)

  const stateRef = useRef(state)
  stateRef.current = state
  const syncing = useRef(false)

  useEffect(() => {
    if (!saveState(teamId, state)) setNotice('기기 저장 공간이 부족합니다. 통신이 연결되면 사진은 서버에 보관됩니다.')
  }, [teamId, state])

  // 밀린 삭제와 업로드를 서버에 올린다.
  const sync = useCallback(async () => {
    if (syncing.current) return
    syncing.current = true
    let changed = false
    try {
      for (const id of stateRef.current.removed) {
        await rpc('evm_remove', { p_code: code, p_team: teamId, p_mission: id })
        setState((p) => ({ ...p, removed: p.removed.filter((x) => x !== id) }))
        changed = true
      }
      for (const [id, rec] of Object.entries(stateRef.current.done)) {
        if (rec.synced) continue
        await rpc('evm_submit', { p_code: code, p_team: teamId, p_mission: id, p_photo: rec.photo })
        setState((p) =>
          p.done[id]?.at === rec.at ? { ...p, done: { ...p.done, [id]: { ...rec, synced: Date.now() } } } : p,
        )
        changed = true
      }
    } catch (err) {
      if (err instanceof BadCodeError) onLogout()
    } finally {
      syncing.current = false
    }
    if (changed) refresh()
  }, [code, teamId, onLogout, refresh])

  useEffect(() => {
    sync()
  }, [state, data, sync])

  // 본부가 지운 사진은 기기에서도 지운다(올린 뒤에 받은 서버 상태에 없을 때만).
  useEffect(() => {
    if (!data) return
    const remote = doneByTeam(data.submissions)[teamId]
    setState((p) => {
      const gone = Object.entries(p.done).filter(
        ([id, rec]) => rec.synced && rec.synced < data.startedAt && !remote[id] && !p.removed.includes(id),
      )
      if (!gone.length) return p
      const done = { ...p.done }
      gone.forEach(([id]) => delete done[id])
      return { ...p, done }
    })
  }, [data, teamId])

  // 우리 팀 완료 목록: 기기 기록에, 다른 기기에서 올린 서버 기록을 더한다.
  const done = useMemo(() => {
    const merged = { ...state.done }
    for (const s of data?.submissions || []) {
      if (s.team_id === teamId && !merged[s.mission_id] && !state.removed.includes(s.mission_id)) {
        merged[s.mission_id] = { at: s.at, remote: true }
      }
    }
    return merged
  }, [state, data, teamId])

  const { count, lines, score } = scoreOf(board, done)
  const pending = Object.values(state.done).filter((r) => !r.synced).length + state.removed.length

  const counts = useMemo(() => {
    const map = doneByTeam(data?.submissions || [])
    const result = Object.fromEntries(TEAMS.map((t) => [t.id, Object.keys(map[t.id]).length]))
    result[teamId] = count
    return result
  }, [data, teamId, count])

  function capture(missionId, photo) {
    setNotice('')
    setState((p) => ({
      done: { ...p.done, [missionId]: { photo, at: Date.now(), synced: false } },
      removed: p.removed.filter((x) => x !== missionId),
    }))
  }

  function remove(missionId) {
    setState((p) => {
      const next = { ...p.done }
      delete next[missionId]
      return { done: next, removed: p.removed.includes(missionId) ? p.removed : [...p.removed, missionId] }
    })
  }

  async function checkin() {
    if (!confirm('팀 전원이 함께 있습니까?')) return
    try {
      await rpc('evm_checkin', { p_code: code, p_team: teamId })
      refresh()
    } catch {
      setNotice('인원 확인을 보내지 못했습니다. 통신 상태를 확인한 뒤 다시 누릅니다.')
    }
  }

  const myCheckin = data?.checkins.find((c) => c.team_id === teamId)

  return (
    <div className="app" style={{ '--team': team.color }}>
      <header className="top">
        <button className="team-chip" onClick={() => confirm('팀 선택 화면으로 돌아갑니다. 기록은 그대로 남습니다.') && onLeave()}>
          {team.name}
        </button>
        <div className="stats">
          <span>미션 <b>{count}</b>/{MISSIONS.length}</span>
          <span>빙고 <b>{lines}</b>줄</span>
          <span className="score"><b>{score}</b>점</span>
        </div>
      </header>

      <div className="status">
        <button className="checkin" onClick={checkin}>
          ✅ 인원 확인{myCheckin && data ? ` · ${minutesAgo(myCheckin.at, data.now)}분 전` : ''}
        </button>
        <span className={online ? 'net' : 'net off'}>
          {!online ? '연결 끊김 · 기록은 기기에 저장됩니다' : pending ? `올리는 중 ${pending}건` : '저장 완료'}
        </span>
      </div>

      {data?.notice?.body && <p className="hq-notice">📢 {data.notice.body}</p>}
      {notice && <p className="notice">{notice}</p>}

      <main className="body">
        {tab === 'bingo' && (
          <Bingo code={code} teamId={teamId} board={board} done={done} onCapture={capture} onRemove={remove} setNotice={setNotice} />
        )}
        {tab === 'games' && <Games />}
        {tab === 'verse' && (
          <>
            <p className="guide">
              미션을 완료하면 우리 팀의 말씀 조각이 열립니다. 테두리가 있는 칸이 우리 팀 조각입니다. 모든 팀이 조각을 모으면 말씀이 완성됩니다.
            </p>
            <VerseView counts={counts} myTeamId={teamId} teams={teamsOf(data)} />
          </>
        )}
        {tab === 'all' && <Everyone code={code} data={data} teamId={teamId} refresh={refresh} />}
      </main>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <span className="tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function Cell({ code, teamId, mission, rec, onClick }) {
  const src = usePhoto(code, teamId, mission.id, rec?.at, rec?.photo)
  const done = Boolean(rec)
  return (
    <button
      className={`cell ${done ? 'done' : ''}`}
      style={done && src ? { backgroundImage: `url(${src})` } : undefined}
      onClick={onClick}
      aria-label={`${mission.title}${done ? ' (완료)' : ''}`}
    >
      {done ? <span className="check">✓</span> : <span className="cell-icon">{mission.icon}</span>}
      <span className="cell-title">{mission.title}</span>
    </button>
  )
}

function Bingo({ code, teamId, board, done, onCapture, onRemove, setNotice }) {
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const rec = selected && done[selected.id]

  async function onPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selected) return
    setBusy(true)
    try {
      onCapture(selected.id, await compressPhoto(file))
    } catch (err) {
      setNotice(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="guide">칸을 눌러 미션을 확인하고 사진을 찍습니다. 가로·세로·대각선 한 줄을 채우면 빙고입니다.</p>
      <div className="board">
        {board.map((m) => (
          // 완료 여부가 바뀌면 사진을 새로 읽도록 key에 시각을 넣는다.
          <Cell key={`${m.id}:${done[m.id]?.at || 0}`} code={code} teamId={teamId} mission={m} rec={done[m.id]} onClick={() => setSelected(m)} />
        ))}
      </div>
      <p className="safety">뛰지 않습니다. 사진은 안전한 곳에 멈춰서 찍습니다.</p>

      {selected && (
        <div className="sheet-back" onClick={() => !busy && setSelected(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <p className="sheet-icon">{selected.icon}</p>
            <h2>{selected.title}</h2>
            {rec && <SheetPhoto key={rec.at} code={code} teamId={teamId} missionId={selected.id} rec={rec} />}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
            <button className="primary" disabled={busy} onClick={() => fileRef.current.click()}>
              {busy ? '저장 중입니다' : rec ? '다시 찍기' : '사진 찍기'}
            </button>
            {rec && (
              <button className="link" disabled={busy} onClick={() => confirm('이 사진을 지웁니까? 빙고 칸도 비워집니다.') && onRemove(selected.id)}>
                사진 지우기
              </button>
            )}
            <button className="ghost" disabled={busy} onClick={() => setSelected(null)}>닫기</button>
          </div>
        </div>
      )}
    </>
  )
}

function SheetPhoto({ code, teamId, missionId, rec }) {
  const src = usePhoto(code, teamId, missionId, rec.at, rec.photo)
  return src ? <img className="sheet-photo" src={src} alt="올린 사진" /> : null
}

const FEED_STEP = 6

function Everyone({ code, data, teamId, refresh }) {
  const [limit, setLimit] = useState(FEED_STEP)
  if (!data) return <p className="guide">다른 팀의 기록을 불러오는 중입니다. 통신이 연결되어야 표시됩니다.</p>

  async function cheer(sub) {
    try {
      await rpc('evm_cheer', { p_code: code, p_team: sub.team_id, p_mission: sub.mission_id })
      refresh()
    } catch {
      /* 응원은 실패해도 다시 누르면 된다 */
    }
  }

  const feed = data.submissions.slice(0, limit)
  return (
    <>
      <h2 className="section">팀 순위</h2>
      <Ranking data={data} myTeamId={teamId} />
      <h2 className="section">모든 팀의 사진</h2>
      {!feed.length && <p className="guide">아직 올라온 사진이 없습니다.</p>}
      <div className="photos">
        {feed.map((sub) => {
          const team = TEAMS.find((t) => t.id === sub.team_id)
          const mission = MISSIONS.find((m) => m.id === sub.mission_id)
          return (
            <figure key={`${sub.team_id}:${sub.mission_id}:${sub.at}`}>
              <Photo code={code} sub={sub} alt={mission?.title || '미션 사진'} />
              <figcaption>
                <span>
                  <b style={{ color: team?.color }}>{team?.name}</b> {mission?.icon} {mission?.title}
                </span>
                <button className="cheer" onClick={() => cheer(sub)} aria-label="응원하기">👏 {sub.cheers}</button>
              </figcaption>
            </figure>
          )
        })}
      </div>
      {data.submissions.length > limit && (
        <button className="ghost more" onClick={() => setLimit(limit + FEED_STEP)}>사진 더 보기</button>
      )}
    </>
  )
}
