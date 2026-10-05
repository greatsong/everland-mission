import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TEAMS, MISSIONS, SCORE } from './data.js'
import { rpc, BadCodeError, loadSession, saveSession, loadState, saveState, compressPhoto, report } from './store.js'
import { boardFor, teamScore, doneByTeam, missionInfo, minutesAgo, rushRank } from './logic.js'
import { useRemote, usePhoto, Photo, VerseView, Ranking, teamsOf, useLocationShare, LocationList, everlandMapUrl, TeamAvatar, teachersOf } from './shared.jsx'
import { lazy, Suspense } from 'react'
import Games from './Games.jsx'

const TeamMap = lazy(() => import('./TeamMap.jsx'))
import Hq from './Hq.jsx'
import Show from './Show.jsx'

const TABS = [
  { id: 'bingo', label: '빙고', icon: '🎯' },
  { id: 'games', label: '퀴즈 대결', icon: '🎲' },
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

// 입장 화면과 팀 선택 화면의 행사 제목
function EventTitle() {
  return (
    <header className="event-title">
      <p className="event-deco" aria-hidden="true">🍂 🎡 🍁</p>
      <p className="event-org">🌱 하늘씨앗 초등부 2026 가을 야유회</p>
      <h1>에버랜드 팀별 미션 🎯</h1>
    </header>
  )
}

const EVERLAND_MAP = 'https://www.everland.com/everland/map'

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
      <EventTitle />
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
      <EventTitle />
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
        <a href={EVERLAND_MAP} target="_blank" rel="noreferrer">🗺️ 에버랜드 지도</a>
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
  const [inbox, setInbox] = useState(false)
  const { data, online, refresh } = useRemote(code, onLogout)
  const locate = useLocationShare(code, teamId)

  // 접속 기록(어느 팀이 어떤 기기와 브라우저로 들어왔는지)
  useEffect(() => {
    report('enter', `${team.name} 입장 · 화면 ${window.innerWidth}x${window.innerHeight}`)
  }, [team.name])

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
        try {
          await rpc('evm_submit', { p_code: code, p_team: teamId, p_mission: id, p_photo: rec.photo })
        } catch (err) {
          if (!String(err.message).includes('EVM_ORDER_CLOSED')) throw err
          // 마감된 지령에 올린 사진은 기기에서 지운다.
          setState((p) => {
            const next = { ...p.done }
            delete next[id]
            return { ...p, done: next }
          })
          setNotice('마감된 지령입니다. 사진이 접수되지 않았습니다.')
          continue
        }
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
      if (s.team_id !== teamId || state.removed.includes(s.mission_id)) continue
      const local = merged[s.mission_id]
      // 같은 팀의 다른 기기가 나중에 다시 올렸으면 서버의 사진을 보여 준다.
      const newerOnServer = local?.synced && new Date(s.at).getTime() > local.synced + 5000
      if (!local || newerOnServer) merged[s.mission_id] = { at: s.at, remote: true }
    }
    return merged
  }, [state, data, teamId])

  // 점수: 빙고와 사진 지령은 기기 기록 기준, 퀴즈·정답 지령·타임어택은 서버 기록 기준.
  const total = teamScore(teamId, data, done)
  const { count, lines, score } = total
  const pending = Object.values(state.done).filter((r) => !r.synced).length + state.removed.length

  const counts = useMemo(() => {
    const map = doneByTeam(data?.submissions || [])
    const result = Object.fromEntries(TEAMS.map((t) => [t.id, MISSIONS.filter((m) => map[t.id][m.id]).length]))
    result[teamId] = count
    return result
  }, [data, teamId, count])

  function capture(missionId, photo) {
    setNotice('')
    locate.ping()
    setState((p) => ({
      ...p,
      done: { ...p.done, [missionId]: { photo, at: Date.now(), synced: false } },
      removed: p.removed.filter((x) => x !== missionId),
    }))
  }

  function remove(missionId) {
    setState((p) => {
      const next = { ...p.done }
      delete next[missionId]
      return { ...p, done: next, removed: p.removed.includes(missionId) ? p.removed : [...p.removed, missionId] }
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
  // 아직 하지 않은 진행 중 지령 수
  const todo = (data?.orders || []).filter((o) => o.open && !orderFinished(data, teamId, done, o)).length

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
        <button className="checkin" onClick={() => setInbox(true)}>
          🔔 알림{todo > 0 && <b className="badge">{todo}</b>}
        </button>
        <span className={online ? 'net' : 'net off'}>
          {!online ? '연결 끊김 · 기록은 기기에 저장됩니다' : pending ? `올리는 중 ${pending}건` : '저장 완료'}
        </span>
      </div>

      {data?.notice?.body && <p className="hq-notice">📢 {data.notice.body}</p>}
      {notice && <p className="notice">{notice}</p>}
      <OrderAlert teamId={teamId} orders={data?.orders} onOpen={() => setTab('bingo')} />
      {inbox && (
        <Inbox data={data} teamId={teamId} done={done} onClose={() => setInbox(false)} onGo={() => { setInbox(false); setTab('bingo'); window.scrollTo(0, 0) }} />
      )}

      <main className="body">
        {tab === 'bingo' && (
          <Bingo code={code} teamId={teamId} board={board} done={done} data={data} refresh={() => { locate.ping(); refresh() }} onCapture={capture} onRemove={remove} setNotice={setNotice} />
        )}
        {tab === 'games' && <Games code={code} teamId={teamId} data={data} refresh={() => { locate.ping(); refresh() }} />}
        {tab === 'verse' && (
          <>
            <p className="guide">
              미션을 완료하면 우리 팀의 말씀 조각이 열립니다. 테두리가 있는 칸이 우리 팀 조각입니다. 모든 팀이 조각을 모으면 말씀이 완성됩니다.
            </p>
            <VerseView counts={counts} myTeamId={teamId} teams={teamsOf(data)} />
          </>
        )}
        {tab === 'all' && <Everyone code={code} data={data} teamId={teamId} refresh={refresh} locate={locate} />}
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

function Bingo({ code, teamId, board, done, data, refresh, onCapture, onRemove, setNotice }) {
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const albumRef = useRef(null) // 앨범에서 고르기(스크린샷 포함)
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
      <TeamProfile code={code} teamId={teamId} data={data} refresh={refresh} />
      <Orders code={code} teamId={teamId} data={data} done={done} refresh={refresh} onSelect={setSelected} />
      <p className="guide">
        칸을 눌러 미션을 확인하고 사진을 찍습니다. 칸 하나는 {SCORE.perMission}점이고, 가로·세로·대각선 한 줄을 완성하면 {SCORE.perLine}점이 더해집니다.
        많이 채울수록 점수가 올라갑니다.
      </p>
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
            <input ref={albumRef} type="file" accept="image/*" hidden onChange={onPhoto} />
            <button className="primary" disabled={busy} onClick={() => fileRef.current.click()}>
              {busy ? '저장 중입니다' : rec ? '다시 찍기' : '사진 찍기'}
            </button>
            <button className="ghost" disabled={busy} onClick={() => albumRef.current.click()}>
              앨범에서 고르기
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

// 본부 지령 목록. 사진 미션은 사진을 올리고, 정답 미션은 낱말을 입력한다.
function Orders({ code, teamId, data, done, refresh, onSelect }) {
  const orders = (data?.orders || []).filter((o) => o.open || orderFinished(data, teamId, done, o))
  if (!orders.length) return null
  return (
    <section className="orders">
      <h2 className="section">📢 본부 지령</h2>
      {orders.map((o) => {
        const key = `order:${o.id}`
        const finished = orderFinished(data, teamId, done, o)
        return (
          <div key={o.id} className={`order ${finished ? 'finished' : ''}`}>
            <p className="order-meta">
              {orderLabel(o)}{!o.open && ' · 마감'}
              {finished && <b> · 완료 ✓{o.rush && ` ${orderRank(data, teamId, o)}등`}</b>}
            </p>
            <p className="order-body">{o.body}</p>
            {o.kind === 'photo' && o.open && (
              <button className="primary" onClick={() => onSelect({ id: key, icon: '📢', title: o.body })}>
                {finished ? '사진 확인·다시 찍기' : '사진 올리기'}
              </button>
            )}
            {o.kind === 'answer' && o.open && !finished && <AnswerForm code={code} teamId={teamId} order={o} refresh={refresh} />}
          </div>
        )
      })}
    </section>
  )
}

function orderLabel(o) {
  const kind = o.kind === 'photo' ? '사진 미션' : '정답 미션'
  return o.rush ? `⏱ 타임어택 ${kind} · 먼저 한 순서대로 30·20·10점` : `${kind} · ${o.points}점`
}

function orderFinished(data, teamId, done, o) {
  return o.kind === 'photo' ? Boolean(done[`order:${o.id}`]) : solved(data, teamId, o.id)
}

// 타임어택 지령에서 우리 팀의 순위. 아직 서버에 반영되지 않았으면 0.
function orderRank(data, teamId, o) {
  if (o.kind === 'photo') return rushRank(data, o.id, teamId)
  const mine = data?.scores.find((s) => s.team_id === teamId && s.game_id === `order:${o.id}`)
  return mine ? [30, 20, 10].indexOf(mine.score) + 1 || 4 : 0
}

// 알림함. 지나간 지령과 본부 알림을 다시 본다.
function Inbox({ data, teamId, done, onClose, onGo }) {
  const orders = data?.orders || []
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet inbox" onClick={(e) => e.stopPropagation()}>
        <h2>🔔 알림</h2>
        {data?.notice?.body && <p className="hq-notice">📢 {data.notice.body}</p>}
        {!orders.length && !data?.notice?.body && <p className="guide">받은 알림이 없습니다.</p>}
        {orders.map((o) => {
          const finished = orderFinished(data, teamId, done, o)
          return (
            <div key={o.id} className={`inbox-item ${finished ? 'finished' : ''}`}>
              <p className="order-meta">
                {orderLabel(o)} · {finished ? '완료 ✓' : o.open ? '진행 중' : '마감'}
              </p>
              <p className="order-body">{o.body}</p>
            </div>
          )
        })}
        {orders.some((o) => o.open) && <button className="primary" onClick={onGo}>지령 하러 가기</button>}
        <button className="ghost" onClick={onClose}>닫기</button>
      </div>
    </div>
  )
}

function solved(data, teamId, orderId) {
  return Boolean(data?.scores.some((s) => s.team_id === teamId && s.game_id === `order:${orderId}`))
}

function AnswerForm({ code, teamId, order, refresh }) {
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try {
      const ok = await rpc('evm_answer', { p_code: code, p_team: teamId, p_order: order.id, p_text: text })
      if (ok) refresh()
      else setMessage('정답이 아닙니다. 다시 생각합니다.')
    } catch (err) {
      setMessage(String(err.message).includes('EVM_ORDER_CLOSED') ? '마감된 지령입니다.' : '보내지 못했습니다. 통신 상태를 확인합니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form className="login answer-form" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="정답 낱말" aria-label="정답" autoComplete="off" />
        <button className="primary" disabled={busy}>제출</button>
      </form>
      <p className="hint">낱말 하나로 답합니다. 띄어쓰기는 상관없습니다.</p>
      {message && <p className="error">{message}</p>}
    </>
  )
}

// 새 지령이 도착하면 화면 전체로 한 번 알린다.
function OrderAlert({ teamId, orders, onOpen }) {
  const key = `evm:v2:seen:${teamId}`
  const [seen, setSeen] = useState(() => {
    try {
      return Number(localStorage.getItem(key)) || 0
    } catch {
      return 0
    }
  })
  const fresh = (orders || []).filter((o) => o.open && o.id > seen)
  const newest = fresh[0]

  useEffect(() => {
    if (newest) navigator.vibrate?.([200, 100, 200])
  }, [newest?.id])

  if (!newest) return null

  function close() {
    try {
      localStorage.setItem(key, String(newest.id))
    } catch {
      /* 저장이 막히면 다음에 다시 표시된다 */
    }
    setSeen(newest.id)
    onOpen()
  }

  return (
    <div className="alert-back">
      <div className="alert">
        <p className="alert-siren">🚨</p>
        <p className="alert-title">본부 지령 도착</p>
        <p className="alert-meta">{orderLabel(newest)}</p>
        <p className="alert-body">{newest.body}</p>
        <button className="primary" onClick={close}>확인</button>
      </div>
    </div>
  )
}

// 팀 소개: 처음에 팀 인증 사진과 담당 선생님 이름을 넣는다. 순위와 본부 화면에 표시된다.
function TeamProfile({ code, teamId, data, refresh }) {
  const team = TEAMS.find((t) => t.id === teamId)
  const profile = data?.teams?.find((t) => t.team_id === teamId)
  const [editing, setEditing] = useState(false)
  const [teachers, setTeachers] = useState('')
  const [photo, setPhoto] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  if (!data) return null
  const complete = Boolean(profile?.photo_at)

  if (complete && !editing) {
    return (
      <div className="profile done">
        <TeamAvatar code={code} data={data} team={team} />
        <span><b>{team.name}</b>{teachersOf(data, teamId) && ` · ${teachersOf(data, teamId)}`}</span>
        <button className="link" onClick={() => { setTeachers(profile.teachers || ''); setPhoto(null); setEditing(true) }}>수정</button>
      </div>
    )
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setPhoto(await compressPhoto(file, 200, 0.7))
    } catch (err) {
      setMessage(err.message)
    }
  }

  async function save() {
    if (!photo && !complete) {
      setMessage('팀 인증 사진을 먼저 찍습니다.')
      return
    }
    setBusy(true)
    try {
      await rpc('evm_team_set', { p_code: code, p_team: teamId, p_teachers: teachers, p_photo: photo })
      setEditing(false)
      setMessage('')
      refresh()
    } catch {
      setMessage('저장하지 못했습니다. 통신 상태를 확인합니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="profile">
      <p className="order-meta">우리 팀 소개 · 순위와 본부 화면에 표시됩니다</p>
      <div className="profile-row">
        <button className="profile-photo" onClick={() => fileRef.current.click()} aria-label="팀 인증 사진 찍기">
          {photo ? <img src={photo} alt="찍은 팀 사진" /> : <span>📸<small>팀 사진</small></span>}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        <input value={teachers} onChange={(e) => setTeachers(e.target.value)} maxLength={40} placeholder="담당 선생님 이름(예: 김○○, 이○○)" aria-label="담당 선생님 이름" />
      </div>
      {message && <p className="error">{message}</p>}
      <div className="row">
        {complete && <button className="ghost" onClick={() => setEditing(false)}>취소</button>}
        <button className="primary" disabled={busy} onClick={save}>{busy ? '저장 중입니다' : '저장'}</button>
      </div>
    </div>
  )
}

function SheetPhoto({ code, teamId, missionId, rec }) {
  const src = usePhoto(code, teamId, missionId, rec.at, rec.photo)
  return src ? <img className="sheet-photo" src={src} alt="올린 사진" /> : null
}

const FEED_STEP = 6

function Everyone({ code, data, teamId, refresh, locate }) {
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
      <Ranking code={code} data={data} myTeamId={teamId} />
      <h2 className="section">📍 우리 위치</h2>
      <div className="locate">
        <p className="guide">
          위치 공유를 켜면 미션을 완료할 때마다, 그리고 이 화면이 열려 있는 동안 3분마다 본부에 우리 팀 위치를 보냅니다.
        </p>
        <button className={locate.on ? 'ghost' : 'primary'} onClick={() => locate.toggle(!locate.on)}>
          {locate.on ? '위치 공유 끄기' : '위치 공유 켜기'}
        </button>
        {locate.error && <p className="error">{locate.error}</p>}
        {locate.on && locate.here && (
          <a className="primary map-link" href={everlandMapUrl(locate.here.lat, locate.here.lng)} target="_blank" rel="noreferrer">
            에버랜드 지도에서 우리 위치 보기
          </a>
        )}
        {locate.on && !locate.here && !locate.error && <p className="guide">위치를 찾는 중입니다.</p>}
        <a className="ghost map-link" href={EVERLAND_MAP} target="_blank" rel="noreferrer">🗺️ 에버랜드 공식 지도 열기</a>
      </div>
      {data.share_locations && (
        <>
          <h2 className="section">📍 모든 팀 위치</h2>
          <Suspense fallback={<p className="guide">지도를 불러오는 중입니다.</p>}>
            <TeamMap data={data} here={locate.here} myTeamId={teamId} />
          </Suspense>
          <LocationList data={data} myTeamId={teamId} here={locate.here} />
        </>
      )}
      <h2 className="section">모든 팀의 사진</h2>
      {!feed.length && <p className="guide">아직 올라온 사진이 없습니다.</p>}
      <div className="photos">
        {feed.map((sub) => {
          const team = TEAMS.find((t) => t.id === sub.team_id)
          const mission = missionInfo(sub.mission_id, data.orders)
          return (
            <figure key={`${sub.team_id}:${sub.mission_id}:${sub.at}`}>
              <Photo code={code} sub={sub} alt={mission.title} />
              <figcaption>
                <span>
                  <b style={{ color: team?.color }}>{team?.name}</b> {mission.icon} {mission.title}
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
