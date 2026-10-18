import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TEAMS, MISSIONS, SCORE } from './data.js'
import { rpc, BadCodeError, loadSession, saveSession, loadState, saveState, compressPhoto, report, lazyImport, QUIZ_ENDED_TEXT, QUIZ_CLOSED_TEXT } from './store.js'
import { boardFor, teamScore, doneByTeam, missionInfo, rushRank, completedLines, teacherNames, locationGroups, liveBattle, battleRule, serverNow, battleOrder } from './logic.js'
import { useRemote, usePhoto, Photo, Ranking, teamsOf, useLocationShare, LocationList, everlandMapUrl, TeamAvatar, teachersOf, teacherMap, withHere, HQ_TEAM, SplitNote, LocateButton, prefetchQuizPhoto } from './shared.jsx'
import { lazy, Suspense } from 'react'
import Games, { CountdownNumber } from './Games.jsx'
import { CelebrationLayer, celebrate, resultLook, unlockAudio, markShown, dismissCelebration } from './celebrate.jsx'

const TeamMap = lazy(lazyImport(() => import('./TeamMap.jsx')))
import Hq from './Hq.jsx'
import Show from './Show.jsx'

// 서버 상태를 받아 오는 간격(ms). 퀴즈 배틀이 열려 있으면 3초, 퀴즈 대결 탭을 보고 있으면 5초, 그 밖에는 15초.
// 배틀은 10초나 15초 카운트다운 뒤에 공개되므로, 퀴즈 탭을 열어 둔 팀은 공개 전에 시작을 알게 된다.
const POLL_BATTLE_MS = 3000
const POLL_GAMES_MS = 5000

const TABS = [
  { id: 'bingo', label: '빙고', icon: '🎯' },
  { id: 'games', label: '퀴즈 대결', icon: '🎲' },
  { id: 'together', label: '함께', icon: '🤝' },
  { id: 'map', label: '지도', icon: '🗺️' },
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

// QR 주소(…/#q=코드)로 열면 버스 퀴즈 코드로 바로 입장한다. 코드는 주소에서 지운다.
function takeQrCode() {
  const m = location.hash.match(/^#q=([^&]+)/)
  if (!m) return null
  history.replaceState(null, '', location.pathname + location.search)
  return decodeURIComponent(m[1]).trim().toLowerCase()
}

export default function App() {
  const [session, setSessionState] = useState(loadSession)
  const [notice, setNotice] = useState('') // 입장 화면 안내(버스 퀴즈가 끝났을 때 등)
  const [qrCode] = useState(takeQrCode)
  const route = useHashRoute()

  const setSession = useCallback((next) => {
    saveSession(next)
    setSessionState(next)
  }, [])
  // err가 있으면 서버가 코드를 거부한 것이다. 버스 퀴즈 입장이 닫혔으면 그 안내를 남긴다.
  const logout = useCallback((err) => {
    if (err?.ended) setNotice(QUIZ_ENDED_TEXT)
    setSession(null)
  }, [setSession])

  // QR로 연 경우: 선생님·본부 휴대폰은 지금 입장을 그대로 두고, 그 밖에는 버스 퀴즈로 입장한다.
  useEffect(() => {
    if (!qrCode || (session && session.role !== 'player')) return
    rpc('evm_login', { p_code: qrCode })
      .then((role) => {
        if (role === 'player') setSession({ code: qrCode, role, teamId: session?.code === qrCode ? session.teamId : null })
        else if (role === 'ended') setNotice(QUIZ_CLOSED_TEXT)
        else if (!role) setNotice('QR의 코드가 맞지 않습니다. 선생님께 확인합니다.')
      })
      .catch(() => setNotice('연결하지 못했습니다. 통신 상태를 확인한 뒤 QR을 다시 찍습니다.'))
    // 처음 한 번만 확인한다(qrCode는 바뀌지 않는다)
  }, [qrCode])

  if (!session) return <Login onLogin={(s) => { setNotice(''); setSession(s) }} notice={notice} />
  // 버스 퀴즈로 들어온 아이 휴대폰은 팀을 고른 뒤 퀴즈 화면만 사용한다(본부·슬라이드쇼·빙고·지도 없음).
  if (session.role === 'player') {
    if (!session.teamId) return <TeamSelect session={session} onSelect={(teamId) => setSession({ ...session, teamId })} onLogout={logout} />
    return <PlayerHome key={session.teamId} session={session} onLeave={() => setSession({ ...session, teamId: null })} onLogout={logout} />
  }
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

function Login({ onLogin, notice }) {
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
      if (role === 'ended') setError(QUIZ_CLOSED_TEXT)
      else if (role) onLogin({ code: value, role, teamId: null })
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
      {notice && !error && <p className="notice">{notice}</p>}
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
      <p className="sub">
        {session.role === 'player'
          ? '🚌 버스 퀴즈에 참여할 우리 팀을 고릅니다. 버튼에 적힌 담당 선생님 이름을 확인합니다.'
          : '우리 팀을 선택합니다. 팀이 A조, B조로 나뉘면 선생님마다 각자 휴대폰으로 입장합니다.'}
      </p>
      <div className="team-grid">
        {teamsOf(data).map((t) => (
          <button key={t.id} className="team-btn" style={{ background: t.color }} onClick={() => onSelect(t.id)}>
            {t.name}
            {data && teacherNames(teachersOf(data, t.id)).length > 0 && <small>{teacherNames(teachersOf(data, t.id)).join(' · ')}</small>}
          </button>
        ))}
      </div>
      <p className="select-links">
        {session.role === 'admin' && <a href="#hq">본부 화면</a>}
        {session.role !== 'player' && (
          <>
            <a href={EVERLAND_MAP} target="_blank" rel="noreferrer">🗺️ 에버랜드 지도</a>
            <a href="#show">슬라이드쇼</a>
          </>
        )}
        <button className="link" onClick={() => onLogout()}>코드 다시 입력</button>
      </p>
    </main>
  )
}

// 버스 퀴즈 화면(아이들 휴대폰, 2026-10-18). 퀴즈 대결과 팀 순위만 있다. 빙고·사진·지도·위치·팀 소개는 없다.
// 점수는 팀 단위이며, 팀에서 가장 먼저 맞힌 사람(선생님 휴대폰 포함)의 기록이 팀 기록이 된다.
// 본부가 입장을 닫으면 서버가 EVM_QUIZ_ENDED를 돌려주고, 입장 화면에 "버스 퀴즈가 끝났습니다"가 나온다.
function PlayerHome({ session, onLeave, onLogout }) {
  const { code, teamId } = session
  const team = TEAMS.find((t) => t.id === teamId)
  const [battleOn, setBattleOn] = useState(false)
  const [focusQuiz, setFocusQuiz] = useState(null)
  const { data, online, refresh } = useRemote(code, onLogout, battleOn ? POLL_BATTLE_MS : POLL_GAMES_MS)
  useEffect(() => setBattleOn(Boolean(liveBattle(data))), [data])
  const clearFocus = useCallback(() => setFocusQuiz(null), [])
  useBattleWatch(code, data, teamId)

  useEffect(() => {
    report('enter', `${team.name} 버스 퀴즈 입장 · 화면 ${window.innerWidth}x${window.innerHeight}`)
  }, [team.name])

  const total = data ? teamScore(teamId, data, doneByTeam(data.submissions)[teamId]) : null

  return (
    <div className="app player" style={{ '--team': team.color }}>
      <header className="top">
        <button className="team-chip" onClick={() => confirm('팀 선택 화면으로 돌아갑니다.') && onLeave()}>
          {team.name}
        </button>
        <div className="stats">
          <span>🚌 버스 퀴즈</span>
          <span className="score"><b>{total?.score ?? 0}</b>점</span>
        </div>
      </header>
      {!online && (
        <div className="status">
          <span className="net off">연결 끊김 · 다시 연결되면 이어집니다</span>
        </div>
      )}
      <BattleAlert data={data} teamId={teamId} onOpen={(id) => { setFocusQuiz(id); window.scrollTo(0, 0) }} />
      <CelebrationLayer teamName={team.name} />
      <main className="body">
        <Games
          code={code}
          teamId={teamId}
          data={data}
          refresh={refresh}
          focus={focusQuiz}
          onFocused={clearFocus}
          intro="본부가 문제를 내면 모든 팀이 함께 풉니다. 팀에서 가장 먼저 맞힌 사람의 기록이 팀 기록이 됩니다. 버스에서는 자리에 앉아서 참여합니다."
        />
        {data && (
          <>
            <h2 className="section">🏆 팀 순위</h2>
            <Ranking code={code} data={data} myTeamId={teamId} photos={false} />
          </>
        )}
      </main>
    </div>
  )
}

function TeamHome({ session, onLeave, onLogout }) {
  const { code, teamId } = session
  const team = TEAMS.find((t) => t.id === teamId)
  const board = boardFor()
  const [state, setState] = useState(() => loadState(teamId))
  const [tab, setTab] = useState('bingo')
  const [notice, setNotice] = useState('')
  const [inbox, setInbox] = useState(false)
  const [battleOn, setBattleOn] = useState(false) // 진행 중인 배틀이 있는지(받아 오는 간격을 줄인다)
  const [focusQuiz, setFocusQuiz] = useState(null) // 배틀 알림에서 고른 문제
  const { data, online, refresh } = useRemote(code, onLogout, battleOn ? POLL_BATTLE_MS : tab === 'games' ? POLL_GAMES_MS : undefined)
  useEffect(() => setBattleOn(Boolean(liveBattle(data))), [data])
  const clearFocus = useCallback(() => setFocusQuiz(null), [])

  useBattleWatch(code, data, teamId)
  const locate = useLocationShare(code, teamId)
  const locatePing = locate.ping
  // 퀴즈에 답할 때도 위치를 보낸다(위치 공유가 켜져 있을 때만).
  const refreshGames = useCallback(() => {
    locatePing()
    refresh()
  }, [locatePing, refresh])

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
          await rpc('evm_submit_at', {
            p_code: code, p_team: teamId, p_mission: id, p_photo: rec.photo,
            p_thumb: rec.thumb ?? null, p_lat: rec.lat ?? null, p_lng: rec.lng ?? null,
          })
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

  // 사진 저장. 카메라로 찍은 사진은 지금 위치를 함께 남긴다(위치 공유가 켜져 있을 때만).
  // 앨범에서 고른 사진은 언제 어디서 찍었는지 알 수 없으므로 위치를 남기지 않는다.
  async function capture(missionId, photo, { thumb = null, camera = false } = {}) {
    setNotice('')
    const where = camera ? await locate.positionNow() : null
    locate.ping()
    setState((p) => ({
      ...p,
      done: { ...p.done, [missionId]: { photo, thumb, lat: where?.lat ?? null, lng: where?.lng ?? null, at: Date.now(), synced: false } },
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

  const teachers = data ? teacherNames(teachersOf(data, teamId)) : []

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
        <button className="checkin" onClick={() => setInbox(true)}>
          🔔 알림{todo > 0 && <b className="badge">{todo}</b>}
        </button>
        {/* 위치 공유가 꺼져 있으면 지도 탭의 위치 공유 켜기로 간다. */}
        <LocateButton locate={locate} onOff={() => { setTab('map'); window.scrollTo(0, 0) }} />
        {/* 평소에는 숨기고, 올리는 중이거나 연결이 끊겼을 때만 알린다. */}
        {(!online || pending > 0) && (
          <span className={online ? 'net' : 'net off'}>
            {!online ? '연결 끊김 · 기록은 기기에 저장됩니다' : `올리는 중 ${pending}건`}
          </span>
        )}
      </div>

      {data?.notice?.body && <p className="hq-notice">📢 {data.notice.body}</p>}
      {notice && <p className="notice">{notice}</p>}
      <OrderAlert teamId={teamId} orders={data?.orders} onOpen={() => setTab('bingo')} />
      <BattleAlert data={data} teamId={teamId} onOpen={(id) => { setTab('games'); setFocusQuiz(id); window.scrollTo(0, 0) }} />
      <CelebrationLayer teamName={team.name} />
      {inbox && (
        <Inbox data={data} teamId={teamId} done={done} onClose={() => setInbox(false)} onGo={() => { setInbox(false); setTab('bingo'); window.scrollTo(0, 0) }} />
      )}

      <main className="body">
        {tab === 'bingo' && <LocatePrompt locate={locate} teachers={teachers} />}
        {tab === 'bingo' && (
          <Bingo code={code} teamId={teamId} board={board} done={done} data={data} refresh={() => { locate.ping(); refresh() }} onCapture={capture} onRemove={remove} setNotice={setNotice} />
        )}
        {tab === 'games' && <Games code={code} teamId={teamId} data={data} refresh={refreshGames} focus={focusQuiz} onFocused={clearFocus} />}
        {tab === 'together' && <Together code={code} data={data} teamId={teamId} refresh={refresh} />}
        {tab === 'map' && <MapTab code={code} data={data} teamId={teamId} locate={locate} />}
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

function Cell({ code, teamId, mission, rec, inLine, onClick }) {
  const src = usePhoto(code, teamId, mission.id, rec?.at, rec?.photo)
  const done = Boolean(rec)
  return (
    <button
      className={`cell ${done ? 'done' : ''} ${inLine ? 'in-line' : ''}`}
      style={done && src ? { backgroundImage: `url(${src})` } : undefined}
      onClick={onClick}
      aria-label={`${mission.title}${done ? ' (완료)' : ''}${inLine ? ' (빙고 줄)' : ''}`}
    >
      {done ? <span className="check">{inLine ? '★' : '✓'}</span> : <span className="cell-icon">{mission.icon}</span>}
      <span className="cell-title">{mission.title}</span>
    </button>
  )
}

function Bingo({ code, teamId, board, done, data, refresh, onCapture, onRemove, setNotice }) {
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const albumRef = useRef(null) // 앨범에서 고르기(스크린샷 포함)

  // 완성된 줄과 그 줄에 속한 칸. 줄이 새로 완성되면 잠깐 축하 표시를 띄운다.
  const lines = completedLines(board, done)
  const lineCells = new Set(lines.flat())
  const prevLines = useRef(null)
  useEffect(() => {
    // 처음 화면을 열 때는 띄우지 않고, 줄 수가 늘었을 때만 띄운다. 줄 하나가 30점이라 배틀 2등과 같은 크기로 축하한다.
    if (prevLines.current !== null && lines.length > prevLines.current) {
      celebrate({ tier: 'silver', title: '빙고!', points: (lines.length - prevLines.current) * SCORE.perLine, sub: `${lines.length}줄 완성` })
    }
    prevLines.current = lines.length
  }, [lines.length])
  const rec = selected && done[selected.id]

  async function onPhoto(e) {
    const camera = e.target === fileRef.current // 카메라로 찍었는지(앨범에서 고른 것이 아닌지)
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !selected) return
    setBusy(true)
    try {
      // 지도에 띄울 작은 사진(긴 변 160px)을 함께 만든다.
      const [photo, thumb] = await Promise.all([compressPhoto(file), compressPhoto(file, 160, 0.6)])
      await onCapture(selected.id, photo, { thumb, camera })
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
      {lines.length > 0 && (
        <p className="bingo-banner">🎉 빙고 {lines.length}줄 완성 · 줄 점수 +{lines.length * SCORE.perLine}점</p>
      )}
      <div className="board">
        {board.map((m, i) => (
          // 완료 여부가 바뀌면 사진을 새로 읽도록 key에 시각을 넣는다.
          <Cell key={`${m.id}:${done[m.id]?.at || 0}`} code={code} teamId={teamId} mission={m} rec={done[m.id]} inLine={lineCells.has(i)} onClick={() => setSelected(m)} />
        ))}
        {/* 완성된 줄 위에 선을 긋는다. 칸 한 개의 크기를 1로 본 좌표다. */}
        <svg className="board-lines" viewBox="0 0 4 4" aria-hidden="true">
          {lines.map((line) => {
            const [a, b] = [line[0], line[3]]
            return (
              <line key={line.join('-')} x1={(a % 4) + 0.5} y1={Math.floor(a / 4) + 0.5} x2={(b % 4) + 0.5} y2={Math.floor(b / 4) + 0.5} />
            )
          })}
        </svg>
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
  const [showDone, setShowDone] = useState(false)
  const all = data?.orders || []
  // 해야 할 지령(진행 중이고 아직 하지 않은 것)만 크게 보여 주고, 완료한 지령은 접어 둔다.
  const todo = all.filter((o) => o.open && !orderFinished(data, teamId, done, o))
  const finished = all.filter((o) => orderFinished(data, teamId, done, o))
  if (!todo.length && !finished.length) return null
  return (
    <section className="orders">
      {todo.length > 0 && <h2 className="section">📢 본부 지령</h2>}
      {todo.map((o) => (
        <div key={o.id} className="order">
          <p className="order-meta">{orderLabel(o)}</p>
          <p className="order-body">{o.body}</p>
          {o.kind === 'photo' && (
            <button className="primary" onClick={() => onSelect({ id: `order:${o.id}`, icon: '📢', title: o.body })}>사진 올리기</button>
          )}
          {o.kind === 'answer' && <AnswerForm code={code} teamId={teamId} order={o} refresh={refresh} />}
        </div>
      ))}
      {finished.length > 0 && (
        <div className="orders-done">
          <button className="orders-done-toggle" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            ✅ 완료한 지령 {finished.length}개 <span>{showDone ? '접기' : '보기'}</span>
          </button>
          {showDone &&
            finished.map((o) => (
              <div key={o.id} className="order-done">
                <p className="order-meta">
                  {orderLabel(o)} · <b>완료 ✓{o.rush && ` ${orderRank(data, teamId, o)}등`}</b>{!o.open && ' · 마감'}
                </p>
                <p className="order-body">{o.body}</p>
                {o.kind === 'photo' && o.open && (
                  <button className="link" onClick={() => onSelect({ id: `order:${o.id}`, icon: '📢', title: o.body })}>사진 확인·다시 찍기</button>
                )}
              </div>
            ))}
        </div>
      )}
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
                {orderLabel(o)} · {finished ? <b>완료 ✓</b> : o.open ? '진행 중' : '마감'}
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

// 배틀 결과 알림. 우리 팀이 다른 휴대폰으로 맞혔으면 이 휴대폰에서도 축하하고,
// 1등만 받는 배틀은 다른 팀이 가장 먼저 맞혔을 때 누가 맞혔는지 알린다. 1분 넘게 지난 결과는 알리지 않는다.
// 그림 배틀은 카운트다운 동안 그림을 미리 받아 둔다(공개 순간에 모든 휴대폰이 한꺼번에 받지 않게).
function useBattleWatch(code, data, teamId) {
  const live = liveBattle(data)
  useEffect(() => {
    if (live?.kind === 'image') prefetchQuizPhoto(code, live.id)
  }, [code, live?.id, live?.kind])
  useEffect(() => {
    if (!data) return
    const now = serverNow(data)
    for (const q of data.quizzes) {
      if (!q.battle) continue
      const order = battleOrder(data, q.id)
      const mine = order.findIndex((s) => s.team_id === teamId)
      if (mine >= 0) {
        // 우리 팀이 맞혔으면(늦게 맞힌 경우 포함) "다른 팀이 맞혔습니다" 띠가 축하 화면을 덮지 않게 한다.
        markShown(`win:${q.id}`)
        if (now - new Date(order[mine].at) < 60000) {
          celebrate({ key: `quiz:${q.id}`, ...resultLook(q, order[mine].score, mine + 1, TEAMS.find((t) => t.id === order[0].team_id)?.name) })
        }
      }
      const first = order[0]
      if (q.battle === 'first' && mine < 0 && first && first.team_id !== teamId && now - new Date(first.at) < 60000) {
        const name = TEAMS.find((t) => t.id === first.team_id)?.name || '다른 팀'
        // 객관식에서 이미 틀린 팀은 더 답할 수 없으므로 다음 배틀을 안내한다.
        const tried = data.scores.some((s) => s.team_id === teamId && s.game_id === `quiz:${q.id}`)
        celebrate({
          key: `win:${q.id}`, tier: 'rival', title: `${name}이 1등으로 맞혔습니다`,
          sub: tried ? '다음 배틀을 기다립니다.' : '지금 맞혀도 정답으로 기록됩니다. 점수는 없습니다.',
        })
      }
    }
  }, [data, teamId])
}

// 퀴즈 배틀이 시작되면 화면 전체로 한 번 알린다. 카운트다운을 함께 보여 주고, 누르면 그 문제로 간다.
function BattleAlert({ data, teamId, onOpen }) {
  const battle = liveBattle(data)
  const [seen, setSeen] = useState(0) // 이 화면에서 이미 확인한 배틀 문제 번호
  const [, setTick] = useState(0) // 카운트다운을 다시 그리기 위한 값
  const answered = battle && data.scores.some((s) => s.team_id === teamId && s.game_id === `quiz:${battle.id}`)
  const now = serverNow(data)
  // 공개 시각이 1분 넘게 지난 배틀(늦게 연 화면)은 알리지 않는다. 퀴즈 탭의 배틀 안내로 들어갈 수 있다.
  const stale = battle?.starts_at && now - new Date(battle.starts_at) > 60000
  // 1등만 받는 배틀을 다른 팀이 이미 맞혔으면 배틀 알림 대신 "○팀이 가장 먼저 맞혔습니다"만 보인다.
  const decided = battle?.battle === 'first' && battleOrder(data, battle.id).length > 0
  const show = battle && battle.id !== seen && !answered && !stale && !decided

  useEffect(() => {
    if (!show) return
    dismissCelebration() // 앞 문제의 축하 화면이 새 배틀 알림을 가리지 않게 닫는다
    navigator.vibrate?.([200, 100, 200])
    const timer = setInterval(() => setTick((t) => t + 1), 250)
    return () => clearInterval(timer)
  }, [show])

  if (!show) return null
  const left = battle.starts_at ? Math.max(0, Math.ceil((new Date(battle.starts_at) - now) / 1000)) : 0

  function go() {
    unlockAudio() // 이 버튼을 누를 때 소리 장치를 깨워 둔다(정답·다른 팀 알림 효과음)
    setSeen(battle.id)
    onOpen(battle.id)
  }

  return (
    <div className="alert-back">
      <div className="alert">
        <p className="alert-siren">⚡</p>
        <p className="alert-title">퀴즈 배틀</p>
        <p className="alert-meta">{battleRule(battle)}</p>
        {left > 0 ? <CountdownNumber quizId={battle.id} sec={left} /> : <p className="countdown">GO</p>}
        <p className="alert-body">{left > 0 ? '초 뒤에 문제가 공개됩니다' : '문제가 공개되었습니다'}</p>
        <button className="primary" onClick={go}>배틀로 가기</button>
      </div>
    </div>
  )
}

// 팀 소개: 처음에 팀 인증 사진과 담당 선생님 이름을 넣는다. 순위와 본부 화면에 표시된다.
function TeamProfile({ code, teamId, data, refresh }) {
  const team = TEAMS.find((t) => t.id === teamId)
  const profile = data?.teams?.find((t) => t.team_id === teamId)
  const [editing, setEditing] = useState(false)
  const [typed, setTeachers] = useState(null) // null이면 저장된 이름(본부가 미리 넣은 이름 포함)을 보여 준다
  const [photo, setPhoto] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  if (!data) return null
  const complete = Boolean(profile?.photo_at)
  const teachers = typed ?? profile?.teachers ?? ''

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

const hhmm = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

// 위치 공유 켜기·끄기. 팀이 나뉘었을 때 지도에 선생님 이름이 나오도록, 켜기 전에 이 휴대폰을 가진 선생님을 고른다.
function LocateSwitch({ locate, teachers }) {
  const [pickNote, setPickNote] = useState('')
  return (
    <>
      {teachers.length > 0 && (
        <div className="holder-pick" role="group" aria-label="이 휴대폰을 가진 선생님">
          이 휴대폰을 가진 선생님
          {teachers.map((name) => (
            <button key={name} className={locate.holder === name ? 'on' : ''} onClick={() => { locate.setHolder(name); setPickNote('') }}>
              {name}
            </button>
          ))}
        </div>
      )}
      {pickNote && <p className="error">{pickNote}</p>}
      <button
        className={locate.on ? 'ghost' : 'primary'}
        onClick={() => {
          if (!locate.on && teachers.length && !teachers.includes(locate.holder)) {
            setPickNote('이 휴대폰을 가진 선생님을 먼저 고릅니다.')
            return
          }
          locate.toggle(!locate.on)
        }}
      >
        {locate.on ? '위치 공유 끄기' : '위치 공유 켜기'}
      </button>
      {locate.on && teachers.length > 0 && !teachers.includes(locate.holder) && (
        <p className="error">이 휴대폰을 가진 선생님을 고르면 팀이 나뉘었을 때 지도에 이름이 표시됩니다.</p>
      )}
    </>
  )
}

// 위치 공유가 꺼져 있으면 빙고 탭 맨 위에 알리고 그 자리에서 켤 수 있게 한다.
function LocatePrompt({ locate, teachers }) {
  if (locate.on) return null
  return (
    <div className="locate locate-prompt">
      <p className="locate-prompt-title">📍 위치 공유가 꺼져 있습니다</p>
      <p className="guide">본부가 우리 팀 위치를 알 수 있도록 켭니다. 켜 두면 앱을 열어 둔 동안 1분마다 위치를 보냅니다.</p>
      <LocateSwitch locate={locate} teachers={teachers} />
    </div>
  )
}

// 함께 탭: 팀 순위와 모든 팀의 사진(응원하기). 친구초청잔치 주제 "함께"에서 이름을 땄다.
function Together({ code, data, teamId, refresh }) {
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
      <h2 className="section">🏆 팀 순위</h2>
      <Ranking code={code} data={data} myTeamId={teamId} />
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

// 지도 탭: 우리 위치(위치 공유 켜기)와 지도. 다른 팀 위치는 본부가 허용했을 때만 보인다.
// 위치 공유가 꺼져 있으면 켜기를 먼저, 켜져 있으면 지도를 먼저 보여 준다.
function MapTab({ code, data, teamId, locate }) {
  if (!data) return <p className="guide">지도를 불러오는 중입니다. 통신이 연결되어야 표시됩니다.</p>
  const teachers = teacherNames(teachersOf(data, teamId))
  const share = data.share_locations

  const mine = (
    <>
      <h2 className="section">📍 우리 위치</h2>
      <div className="locate">
        <p className="guide">
          위치 공유를 켜면 앱을 열 때와 미션을 완료할 때, 그리고 화면이 켜져 있는 동안 1분마다 본부에 우리 팀 위치를 보냅니다. 휴대폰 화면이 꺼져 있으면 보내지 못합니다.
          팀이 A조, B조로 나뉘면 선생님마다 각자 휴대폰에서 위치 공유를 켭니다. 휴대폰끼리 20m 넘게 떨어지면 지도에 조별로 표시됩니다.
        </p>
        <LocateSwitch locate={locate} teachers={teachers} />
        {locate.on && locate.lastSent && <p className="guide">마지막으로 보낸 시각 {hhmm(locate.lastSent)}</p>}
        {locate.error && <p className="error">{locate.error}</p>}
        {locate.on && locate.here && (
          <a className="primary map-link" href={everlandMapUrl(locate.here.lat, locate.here.lng)} target="_blank" rel="noreferrer">
            에버랜드 지도에서 우리 위치 보기
          </a>
        )}
        {locate.on && !locate.here && !locate.error && <p className="guide">위치를 찾는 중입니다.</p>}
        <a className="ghost map-link" href={EVERLAND_MAP} target="_blank" rel="noreferrer">🗺️ 에버랜드 공식 지도 열기</a>
      </div>
    </>
  )

  const map = (
    <>
      <h2 className="section">🗺️ {share ? '모든 팀 위치' : '지도'}</h2>
      {share && (
        <SplitNote groups={locationGroups(withHere(data.locations, teamId, locate.here, data.now), [HQ_TEAM, ...teamsOf(data)], teacherMap(data))} splits={data.splits} now={data.now} />
      )}
      <Suspense fallback={<p className="guide">지도를 불러오는 중입니다.</p>}>
        <TeamMap code={code} data={data} here={locate.here} myTeamId={teamId} />
      </Suspense>
      {share ? <LocationList data={data} myTeamId={teamId} here={locate.here} /> : <p className="guide">다른 팀 위치는 본부가 허용하면 이 지도에 표시됩니다.</p>}
    </>
  )

  return locate.on ? <>{map}{mine}</> : <>{mine}{map}</>
}
