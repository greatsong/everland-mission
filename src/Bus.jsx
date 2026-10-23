import { useCallback, useEffect, useRef, useState } from 'react'
import { TEAMS } from './data.js'
import { rpc, report, QUIZ_CLOSED_TEXT } from './store.js'
import { useRemote, teamsOf, deviceId, prefetchQuizPhoto, useTeamsView } from './shared.jsx'
import { teacherNames, teacherLabel, liveBattle, battleOrder, serverNow, busRanking, busPoints, currentBusQuestion, busList, josa, busMvp } from './logic.js'
import { QuizCard, answerOf } from './Games.jsx'
import { CelebrationLayer, celebrate, mateLook, markShown, answering } from './celebrate.jsx'

// 버스 퀴즈(아이들 휴대폰, 2026-10-18 개편). 입장(이름·팀) → 대기실 → OT(아이마다 답하고 점수 없음) → 팀 대항 → 결과.
// 화면은 본부가 연 문제 하나만 보여 준다(목록 없음). 본부가 입장을 닫으면 결과 화면으로 바뀐다.
// 맞힌 사람 이름만 보이고, 틀린 사람 이름은 보이지 않는다. 이름은 행사 뒤 evm_wipe로 지운다.

const POLL_BATTLE_MS = 3000 // 배틀이 열려 있을 때
const POLL_BUS_MS = 5000 // 그 밖(대기실·OT)

const teamName = (id) => TEAMS.find((t) => t.id === id)?.name || `${id}팀`

// 배틀 결과 알림. 우리 팀이 다른 휴대폰으로 맞혔으면 화면을 가리지 않는 위쪽 띠로 알리고(맞힌 사람 이름과 함께),
// 1등만 받는 배틀은 다른 팀이 가장 먼저 맞혔을 때 누가 맞혔는지 알린다. 1분 넘게 지난 결과는 알리지 않는다.
// 그림 배틀은 카운트다운 동안 그림을 미리 받아 둔다(공개 순간에 모든 휴대폰이 한꺼번에 받지 않게).
export function useBattleWatch(code, data, teamId) {
  const live = liveBattle(data)
  useEffect(() => {
    if (live?.kind === 'image') prefetchQuizPhoto(code, live.id)
  }, [code, live?.id, live?.kind])
  useEffect(() => {
    if (!data) return
    const now = serverNow(data)
    for (const q of data.quizzes) {
      if (!q.battle || q.status === 'draft') continue
      const order = battleOrder(data, q.id)
      const mine = order.findIndex((s) => s.team_id === teamId)
      if (mine >= 0) {
        // 우리 팀이 맞혔으면(늦게 맞힌 경우 포함) "다른 팀이 맞혔습니다" 띠가 축하 화면을 덮지 않게 한다.
        markShown(`win:${q.id}`)
        // 이 휴대폰이 맞혔으면 QuizCard가 이미 큰 축하를 띄웠다(같은 key라 다시 뜨지 않는다).
        if (now - new Date(order[mine].at) < 60000 && !answering.has(q.id)) {
          const who = order[mine].who && order[mine].who !== '선생님' ? order[mine].who : null
          celebrate({ key: `quiz:${q.id}`, ...mateLook(q, order[mine].score, mine + 1, who) })
        }
      }
      const first = order[0]
      if (q.battle === 'first' && mine < 0 && first && first.team_id !== teamId && now - new Date(first.at) < 60000) {
        const by = first.who ? `${teamName(first.team_id)} ${first.who}` : teamName(first.team_id)
        // 객관식에서 이미 틀린 팀은 더 답할 수 없으므로 다음 배틀을 안내한다.
        const tried = data.scores.some((s) => s.team_id === teamId && s.game_id === `quiz:${q.id}`)
        celebrate({
          key: `win:${q.id}`, tier: 'rival', title: `${josa(by)} 1등으로 맞혔습니다`,
          sub: tried ? '다음 배틀을 기다립니다.' : '지금 맞혀도 정답으로 기록됩니다. 점수는 없습니다.',
        })
      }
    }
  }, [data, teamId])
}

// 1. 입장: 이름과 팀을 한 화면에서 고른다. 팀 버튼에 담당 선생님 이름이 보여 팀을 잘못 고르지 않는다.
export function BusJoin({ session, onJoin, onLogout, onTeacher }) {
  const { data } = useRemote(session.code, onLogout)
  const practice = Boolean(data?.practice)
  const view = useTeamsView(data)
  const [name, setName] = useState(session.name || '')
  const [teamId, setTeamId] = useState(session.teamId || null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const team = TEAMS.find((t) => t.id === teamId)
  useEffect(() => {
    if (data?.team_count && teamId > data.team_count) setTeamId(null)
  }, [data?.team_count, teamId])

  async function join(e) {
    e.preventDefault()
    const clean = name.trim()
    if (!clean) return setError('이름을 입력합니다.')
    if (clean.length > 10) return setError('이름은 10자까지 입력합니다.')
    if (!teamId) return setError('우리 팀을 고릅니다.')
    setBusy(true)
    setError('')
    try {
      await rpc('evm_player_join', { p_code: session.code, p_device: deviceId(), p_team: teamId, p_name: clean })
      onJoin({ teamId, name: clean })
    } catch (err) {
      const m = String(err.message)
      setError(err.ended ? QUIZ_CLOSED_TEXT
        : m.includes('EVM_TEAM_LOCKED') ? '팀 대항이 시작된 뒤에는 팀을 바꿀 수 없습니다. 처음 고른 팀을 고릅니다.'
        : m.includes('EVM_FULL') ? '입장 인원이 가득 찼습니다. 선생님께 알립니다.'
        : '들어가지 못했습니다. 통신 상태를 확인한 뒤 다시 누릅니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="select bus-join">
      <header className="event-title">
        <p className="event-deco" aria-hidden="true">🍂 🎡 🍁</p>
        <p className="event-org">🌱 하늘씨앗 초등부 2026 가을 야유회</p>
        <h1>🚌 버스 퀴즈</h1>
      </header>
      {practice && (
        <div className="card practice-intro">
          <p className="battle-tag">🧪 버스 출발 전 연습</p>
          <p className="question">OT와 연습 문제를 자기 속도로 풀어 봅니다</p>
          <p className="hint">점수와 기록이 없어 몇 번이든 다시 풀 수 있습니다</p>
        </div>
      )}
      <form className="join-form" onSubmit={join}>
        <label className="field">
          <span>내 이름</span>
          <input value={name} onChange={(e) => { setName(e.target.value); setError('') }} maxLength={10} placeholder="예: 지민" autoComplete="off" />
          <small>{practice ? '연습에서는 이름과 답을 기록하지 않습니다' : '맞히면 이름이 모두의 화면에 나옵니다'}</small>
        </label>
        <div className="field">
          <span>우리 팀</span>
          {view ? (
            <div className="team-grid">
              {view.teams.map((t) => {
                const names = teacherNames(view.teachers(t.id))
                return (
                  <button type="button" key={t.id} className={`team-btn${teamId === t.id ? ' sel' : ''}`} style={{ background: t.color }}
                    onClick={() => { setTeamId(t.id); setError('') }} aria-pressed={teamId === t.id}>
                    {t.name}
                    <small>{teacherLabel(names)}</small>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="team-loading">팀 목록을 불러오는 중입니다</p>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? '들어가는 중입니다' : practice ? '연습 시작' : team ? `${team.name}으로 입장` : '입장'}</button>
      </form>
      <p className="select-links">
        <button className="link" onClick={() => onLogout()}>코드 다시 입력</button>
        {onTeacher && <> · <button className="link" onClick={onTeacher}>선생님 화면으로 돌아가기</button></>}
      </p>
    </main>
  )
}

// 위쪽 줄: OT는 진행 순서, 팀 대항은 지금 1위와 우리 팀 순위·점수 차
function BusStatusBar({ data, current, teamId, teams }) {
  if (!data) return null
  if (current?.round === 'ot') {
    // 아이들 휴대폰은 시작 전 문제를 받지 않으므로 전체 수는 bus_plan으로 센다.
    const list = busList(data, 'ot')
    return <div className="lead-bar">📚 OT {list.findIndex((q) => q.id === current.id) + 1} / {data.bus_plan?.ot ?? list.length}<span>점수 없이 함께 알아봅니다</span></div>
  }
  const rows = busRanking(data, teams)
  const top = rows[0]
  if (!top || top.points === 0) {
    return <div className="lead-bar">👑 아직 1위가 없습니다<span>{current ? '첫 점수를 기다립니다' : '곧 시작합니다'}</span></div>
  }
  const leaders = rows.filter((r) => r.points === top.points)
  const me = rows.find((r) => r.team.id === teamId) || { points: 0 }
  if (me.points === top.points) {
    const second = rows.find((r) => r.points < top.points)
    return (
      <div className="lead-bar">
        👑 {leaders.length > 1 ? `공동 1위 ${leaders.map((r) => r.team.name).join('·')}` : '우리 팀이 1위입니다'}
        <span>{second ? `2위와 ${top.points - second.points}점 차` : ''}</span>
      </div>
    )
  }
  const myRank = rows.filter((r) => r.points > me.points).length + 1
  return (
    <div className="lead-bar">
      👑 1위 {leaders.map((r) => r.team.name).join('·')} {top.points}점<span>우리 팀 {myRank}위 · {top.points - me.points}점 차</span>
    </div>
  )
}

// 2. 대기실: 다음에 할 일, 본부 알림(안내 사항), 함께 들어온 우리 팀(미션 미리 보기는 2026-10-18 사용자 요청으로 뺐다)
function BusLobby({ data, teamId }) {
  const ot = busList(data, 'ot')
  const bus = busList(data, 'bus')
  // 시작 전 문제는 아이들 휴대폰에 오지 않으므로 문제 수(bus_plan)로 단계를 정한다.
  const plan = data.bus_plan || { ot: ot.length, ot_draft: 0, bus: bus.length, bus_draft: 0 }
  const started = plan.ot - plan.ot_draft + plan.bus - plan.bus_draft > 0
  const otLeft = plan.ot_draft > 0
  const busStarted = plan.bus > plan.bus_draft
  const allDone = started && plan.ot_draft + plan.bus_draft === 0
  let hero
  if (allDone) hero = { icon: '🏁', title: '모든 문제를 마쳤습니다', sub: '본부가 결과를 보내면 순위가 나옵니다' }
  else if (!started && !plan.ot && plan.bus) hero = { icon: '⚡', title: '곧 팀 대항 퀴즈가 시작됩니다', sub: '팀에서 가장 먼저 맞힌 사람이 점수를 얻습니다' }
  else if (!started) hero = { icon: '🎒', title: '곧 OT 퀴즈가 시작됩니다', sub: plan.ot ? `오늘 지킬 약속 ${plan.ot}가지를 OX로 알아봅니다` : '본부가 문제를 내면 함께 풉니다' }
  else if (!busStarted && !otLeft && plan.bus) hero = { icon: '⚡', title: '곧 팀 대항 퀴즈가 시작됩니다', sub: '팀에서 가장 먼저 맞힌 사람이 점수를 얻습니다' }
  else hero = { icon: '⏳', title: '다음 문제를 기다립니다', sub: '본부가 다음 문제를 엽니다' }
  const last = [...ot, ...bus].filter((q) => q.status === 'closed').sort((a, b) => b.id - a.id)[0]
  const members = (data.players || []).filter((p) => p.team_id === teamId)

  return (
    <>
      <div className="card bus-hero">
        <p className="bus-hero-icon">{hero.icon}</p>
        <p className="question">{hero.title}</p>
        <p className="hint">{hero.sub}</p>
      </div>
      {data.notice?.body && <p className="hq-notice">📢 {data.notice.body}</p>}
      {last && (
        <div className="card bus-last">
          <p className="hint">지난 문제</p>
          <p className="bus-last-q">{last.body}</p>
          {last.answer != null && <p className="answer">정답: {last.kind === 'ox' ? (last.answer === 'O' ? '⭕' : '❌') : last.choices ? last.choices[Number(last.answer)] : last.answer}</p>}
          {last.note && <p className="quiz-note">📖 {last.note}</p>}
        </div>
      )}
      <div className="card">
        <p className="hint">우리 팀 입장 {members.length}명</p>
        <div className="avatars">
          {members.map((p, i) => (
            <span key={`${p.name}:${i}`} className="av"><i>{[...p.name][0]}</i>{p.name}</span>
          ))}
        </div>
      </div>
    </>
  )
}

// OT 문제 아래: 우리 팀 정답 수와 답한 사람 수
function OtProgress({ data, quiz, teamId }) {
  const stat = (data.ot_stats || []).find((s) => s.quiz_id === quiz.id && s.team_id === teamId) || { answered: 0, correct: 0 }
  const members = (data.players || []).filter((p) => p.team_id === teamId).length
  const pct = stat.answered ? Math.round((stat.correct / stat.answered) * 100) : 0
  return (
    <div className="card">
      <p className="hint">우리 팀 정답 {stat.correct} / {stat.answered}명{members > 0 && ` · ${members}명 중 ${stat.answered}명 답함`}</p>
      <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      <p className="hint">다음 문제는 본부가 시작합니다</p>
    </div>
  )
}

// MVP 상위 5명(결과 화면과 본부 진행판). 팀 대항에서 맞혀 받은 점수 합의 순서다(logic.js의 busMvp).
export function MvpList({ data, teams }) {
  const { rows, more } = busMvp(data)
  if (!rows.length) return null
  return (
    <div className="card mvp">
      <p className="mvp-title">🌟 MVP TOP 5</p>
      <ol className="mvp-list">
        {rows.map((p) => {
          const team = teams.find((t) => t.id === p.teamId)
          return (
            <li key={p.key} className={p.place === 1 ? 'first' : ''}>
              <span className="mvp-rank">{['🥇', '🥈', '🥉'][p.place - 1] || p.place}</span>
              <b className="mvp-name">{p.name}</b>
              {team && <span className="tn" style={{ background: team.color }}>{team.name}</span>}
              <span className="mvp-pts">{p.points}점<small>{p.solved}문제{p.firsts > 0 && ` · 1등 ${p.firsts}번`}</small></span>
            </li>
          )
        })}
      </ol>
      {more > 0 && <p className="hint">같은 점수 {more}명 더</p>}
    </div>
  )
}

// 6. 결과: 본부가 입장을 닫으면 나온다. 마지막으로 받은 상태로 위에는 팀 점수(시상대·팀 순위), 아래에는 MVP 상위 5명을 보여 준다.
function BusResult({ code, data: saved, onExit }) {
  // 서버의 최종 결과를 받아 그린다(마지막 문제 때 휴대폰이 꺼져 있었어도 맞게). 받지 못하면 휴대폰에 남긴 마지막 상태를 쓴다.
  const [fresh, setFresh] = useState(null)
  useEffect(() => {
    rpc('evm_bus_results', { p_code: code }).then((r) => { setFresh(r); saveLast(r) }).catch(() => {})
  }, [code])
  const data = fresh || saved
  const rows = data ? busRanking(data, teamsOf(data)) : []
  const scored = rows.some((r) => r.points > 0)
  const podium = [rows[1], rows[0], rows[2]].filter((r) => r && r.points > 0)
  // 점수가 같으면 같은 등수다(앞선 팀 수 + 1).
  const place = (r) => rows.filter((x) => x.points > r.points).length + 1
  const height = (r) => [150, 110, 80][place(r) - 1] || 80
  const medal = (r) => ['🏆', '🥈', '🥉'][place(r) - 1] || '🥉'
  return (
    <main className="select bus-result">
      <h1>🏁 버스 퀴즈 결과</h1>
      {scored && (
        <div className="podium">
          {podium.map((r) => (
            <div key={r.team.id} style={{ background: r.team.color, height: height(r) }}>
              {medal(r)}<b>{r.team.name}</b>{r.points}점
            </div>
          ))}
        </div>
      )}
      {scored && (
        <div className="card">
          <p className="mvp-title">🏆 팀 점수</p>
          <div className="bus-rank-list">
            {rows.map((r) => (
              <div key={r.team.id} className="bus-rank">
                <b>{place(r)}</b><span className="tn" style={{ background: r.team.color }}>{r.team.name}</span><b>{r.points}점</b>
              </div>
            ))}
          </div>
          <p className="hint">버스 퀴즈 점수는 에버랜드 미션 점수에 그대로 더해집니다</p>
        </div>
      )}
      {data && <MvpList data={data} teams={teamsOf(data)} />}
      <div className="card bus-hero">
        <p className="bus-hero-icon">🎡</p>
        <p className="question">이제 에버랜드에서 만나요</p>
        <p className="hint">미션은 선생님 휴대폰으로 진행합니다</p>
      </div>
      <button className="ghost" onClick={onExit}>처음 화면으로</button>
    </main>
  )
}

// 결과 화면에 쓸 마지막 상태를 휴대폰에 남긴다. 결과가 나온 뒤 새로 고치거나 다시 열어도 팀 점수와 MVP가 보이게 한다.
// 버스 문제 번호, 버스 점수 기록, 팀 정보만 남긴다(입장자 목록·사진은 남기지 않는다).
const LAST_KEY = 'evm:v2:busLast'
function saveLast(data) {
  if (data.practice) return
  try {
    const quizzes = data.quizzes.filter((q) => q.round).map((q) => ({ id: q.id, round: q.round }))
    const ids = new Set(quizzes.map((q) => `quiz:${q.id}`))
    localStorage.setItem(LAST_KEY, JSON.stringify({ quizzes, scores: data.scores.filter((s) => ids.has(s.game_id)), teams: data.teams, team_count: data.team_count }))
  } catch {
    /* 저장이 막힌 브라우저에서는 마지막으로 받은 상태만 사용한다 */
  }
}
function loadLast() {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY)) || null
  } catch {
    return null
  }
}

// 버스 퀴즈 화면. 본부가 연 문제가 있으면 그 문제를, 없으면 대기실을 보여 준다.
export function PlayerHome({ session, onLeave, onLogout, onTeacher }) {
  const { code, teamId, name } = session
  const team = TEAMS.find((t) => t.id === teamId)
  const [ended, setEnded] = useState(false)
  const [waiting, setWaiting] = useState(false) // 닫혀 있지만 버스 퀴즈를 아직 시작하지 않음(출발 전)
  const last = useRef(null) // 입장이 닫혔을 때 결과 화면에 쓸 마지막 상태
  const onBad = useCallback((err) => {
    if (!err?.ended) return onLogout(err)
    setEnded(true)
    setWaiting(Boolean(err.waiting))
  }, [onLogout])
  const [battleOn, setBattleOn] = useState(false)
  // 결과 화면(입장이 닫힘)에서는 30초마다만 확인한다. 본부가 입장을 다시 열면 문제 화면으로 돌아간다.
  // 출발 전 준비 중 화면에서는 10초마다 확인한다(본부가 열면 바로 바뀌게).
  const [practiceOn, setPracticeOn] = useState(false)
  // 연습 중에는 10초마다 확인한다(본부가 버스 진행을 켜면 버스 화면으로 바뀐다).
  const { data, online, refresh } = useRemote(code, onBad, ended ? (waiting ? 10000 : 30000) : battleOn ? POLL_BATTLE_MS : practiceOn ? 10000 : POLL_BUS_MS, deviceId())
  const practice = Boolean(data?.practice)
  useEffect(() => {
    if (data?.team_count && teamId > data.team_count) onLeave()
  }, [data?.team_count, teamId, onLeave])
  useEffect(() => {
    if (data) {
      last.current = data
      saveLast(data)
      setEnded(false)
    }
    setBattleOn(Boolean(liveBattle(data)))
    setPracticeOn(Boolean(data?.practice))
  }, [data])
  // 버스 진행 화면이 될 때마다 입장 기록을 다시 남긴다(본부가 기록을 지운 뒤에도 저장된 이름·팀으로 바로 답할 수 있게).
  // 연습·준비 중·결과 화면에서 버스 진행으로 바뀔 때도 남긴다. 그 화면들에서는 서버가 입장을 받지 않는다(2026-10-22 시험에서
  // 준비 중 화면에서 바뀐 휴대폰의 입장 기록이 빠지던 문제). 기록한 뒤 상태를 다시 받아 대기실의 우리 팀 인원이 바로 맞게 한다.
  const live = Boolean(data) && !practice && !ended && (!data.team_count || teamId <= data.team_count)
  useEffect(() => {
    if (!live) return
    rpc('evm_player_join', { p_code: code, p_device: deviceId(), p_team: teamId, p_name: name }).then(() => refresh()).catch(() => {})
  }, [code, teamId, name, live, refresh])
  useBattleWatch(code, data, teamId)

  useEffect(() => {
    report('enter', `${team.name} 버스 퀴즈 입장 · 화면 ${window.innerWidth}x${window.innerHeight}`)
  }, [team.name])

  if (ended && waiting) return <BusWaiting team={team} name={name} onExit={() => onLogout()} onTeacher={onTeacher} />
  if (ended) return <BusResult code={code} data={last.current || loadLast()} onExit={() => onLogout()} />

  const teams = teamsOf(data)
  const current = currentBusQuestion(data)

  return (
    <div className="app player" style={{ '--team': team.color }}>
      <header className="top">
        <button className="team-chip" onClick={() => confirm('팀이나 이름을 바꿉니까?') && onLeave()}>
          {team.name} · {name}
        </button>
        <div className="stats">
          {practice ? <span>🧪 연습 · 기록 없음</span> : (
            <>
              <span>🚌 버스 퀴즈</span>
              <span className="score"><b>{data ? busPoints(data, teamId) : 0}</b>점</span>
            </>
          )}
        </div>
      </header>
      {!practice && <BusStatusBar data={data} current={current} teamId={teamId} teams={teams} />}
      {!online && (
        <div className="status">
          <span className="net off">연결 끊김 · 다시 연결되면 이어집니다</span>
        </div>
      )}
      <CelebrationLayer teamName={team.name} />
      <main className="body bus-body">
        {!data && <p className="guide">불러오는 중입니다.</p>}
        {practice && <PracticeHome code={code} data={data} name={name} />}
        {data && !practice && current && (
          <>
            <QuizCard key={current.id} code={code} teamId={teamId} quiz={current} data={data}
              result={answerOf(data, teamId, current)} refresh={refresh} who={name} onBadPlayer={onLeave} />
            {current.round === 'ot' && current.body != null && <OtProgress data={data} quiz={current} teamId={teamId} />}
          </>
        )}
        {data && !practice && !current && <BusLobby data={data} teamId={teamId} />}
        {onTeacher && <p className="select-links"><button className="link" onClick={onTeacher}>선생님 화면으로 돌아가기</button></p>}
      </main>
    </div>
  )
}

// 연습(2026-10-18, 교사 연습용). OT와 연습 문제를 자기 속도로 한 문제씩 푼다. 서버는 채점만 하고 아무것도 기록하지 않으므로
// 결과는 이 화면에만 두고, "처음부터 다시 풀기"로 몇 번이든 다시 푼다. 본부가 버스 진행을 켜면 PlayerHome이 버스 화면으로 바꾼다.
function PracticeHome({ code, data, name }) {
  const list = data.quizzes || []
  const [idx, setIdx] = useState(0)
  const [results, setResults] = useState({}) // 문제 id → { ok, answer, note }
  const [round, setRound] = useState(0) // 다시 풀 때 문제 카드를 새로 만든다
  const [summary, setSummary] = useState(false)
  const noop = useCallback(() => {}, [])
  if (!list.length) return <p className="guide">연습 문제가 아직 없습니다. 본부가 OT 문제를 넣으면 나옵니다.</p>

  const i = Math.min(idx, list.length - 1)
  const q = list[i]
  const r = results[q.id]
  // 답한 문제는 채점 결과의 정답·설명을 붙여 다시 보여 준다(이전·다음으로 돌아왔을 때).
  const quiz = { ...q, status: 'open', answer: r?.answer ?? null, note: r?.note ?? null }
  const right = list.filter((x) => results[x.id]?.ok).length
  const oneShot = q.kind === 'ox' || (q.kind === 'bible' && Array.isArray(q.choices))

  async function answer(value) {
    const res = await rpc('evm_practice_answer', { p_code: code, p_id: q.id, p_text: value })
    // OX·객관식은 한 번에 끝나고, 단답은 맞혔을 때 끝난다(틀리면 다시 낸다).
    if (res.ok || oneShot) setResults((m) => ({ ...m, [q.id]: { ok: res.ok, answer: res.answer, note: res.note } }))
    return res
  }
  function restart() {
    setResults({})
    setIdx(0)
    setRound((n) => n + 1)
    setSummary(false)
  }

  if (summary) {
    return (
      <div className="card bus-hero">
        <p className="bus-hero-icon">🎉</p>
        <p className="question">연습을 마쳤습니다</p>
        <p className="hint">{list.length}문제 중 {right}문제 정답</p>
        <button className="primary" onClick={restart}>처음부터 다시 풀기</button>
        <button className="ghost" onClick={() => { setIdx(0); setSummary(false) }}>문제와 설명 다시 보기</button>
        <p className="hint">본부가 버스 진행을 켜면 이 화면이 버스 퀴즈로 바뀝니다</p>
      </div>
    )
  }

  return (
    <>
      <div className="practice-bar">
        <span>연습 {i + 1} / {list.length}</span>
        <span className="pdots" aria-hidden="true">
          {list.map((x, k) => (
            <i key={x.id} className={`${results[x.id] ? (results[x.id].ok ? 'ok' : 'no') : ''}${k === i ? ' now' : ''}`} />
          ))}
        </span>
      </div>
      <QuizCard key={`${round}:${q.id}`} code={code} teamId={0} quiz={quiz} data={data}
        result={r ? { ok: r.ok, score: 0 } : null} refresh={noop} who={name} answerFn={answer} />
      <div className="practice-nav">
        <button className="ghost" disabled={i === 0} onClick={() => setIdx(i - 1)}>이전</button>
        {i < list.length - 1
          ? <button className="primary" onClick={() => setIdx(i + 1)}>{r ? '다음 문제' : '건너뛰기'}</button>
          : <button className="primary" onClick={() => setSummary(true)}>결과 보기</button>}
      </div>
    </>
  )
}

// 출발 전 준비 중(2026-10-22). 입장이 닫혀 있지만 버스 퀴즈를 아직 시작하지 않았을 때(연습을 닫은 뒤 포함) 보인다.
// 미리 들어와 둔 휴대폰은 이름과 팀이 그대로 남아 있고, 본부가 버스 진행을 켜면 10초 안에 대기실로 바뀐다.
function BusWaiting({ team, name, onExit, onTeacher }) {
  return (
    <main className="select bus-result">
      <h1>🚌 버스 퀴즈 준비 중</h1>
      <div className="card bus-hero">
        <p className="bus-hero-icon">⏳</p>
        <p className="question">{team.name} {name}, 입장 준비가 끝났습니다</p>
        <p className="hint">선생님이 버스 퀴즈를 열면 이 화면이 저절로 바뀝니다. 화면을 닫았다가 다시 열어도 이름과 팀은 남아 있습니다.</p>
      </div>
      <p className="select-links">
        <button className="link" onClick={() => confirm('이름과 팀을 지우고 처음 화면으로 갑니까?') && onExit()}>다른 이름으로 들어가기</button>
        {onTeacher && <> · <button className="link" onClick={onTeacher}>선생님 화면으로 돌아가기</button></>}
      </p>
    </main>
  )
}
