import { useCallback, useEffect, useRef, useState } from 'react'
import { TEAMS, MISSIONS } from './data.js'
import { rpc, report, QUIZ_CLOSED_TEXT } from './store.js'
import { useRemote, teamsOf, teachersOf, deviceId, prefetchQuizPhoto } from './shared.jsx'
import { teacherNames, liveBattle, battleOrder, serverNow, busRanking, busPoints, currentBusQuestion, busList, josa } from './logic.js'
import { QuizCard, answerOf } from './Games.jsx'
import { CelebrationLayer, celebrate, resultLook, markShown } from './celebrate.jsx'

// 버스 퀴즈(아이들 휴대폰, 2026-10-18 개편). 입장(이름·팀) → 대기실 → OT(아이마다 답하고 점수 없음) → 팀 대항 → 결과.
// 화면은 본부가 연 문제 하나만 보여 준다(목록 없음). 본부가 입장을 닫으면 결과 화면으로 바뀐다.
// 맞힌 사람 이름만 보이고, 틀린 사람 이름은 보이지 않는다. 이름은 행사 뒤 evm_wipe로 지운다.

const POLL_BATTLE_MS = 3000 // 배틀이 열려 있을 때
const POLL_BUS_MS = 5000 // 그 밖(대기실·OT)

const teamName = (id) => TEAMS.find((t) => t.id === id)?.name || `${id}팀`

// 배틀 결과 알림. 우리 팀이 다른 휴대폰으로 맞혔으면 이 휴대폰에서도 축하하고(맞힌 사람 이름과 함께),
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
        if (now - new Date(order[mine].at) < 60000) {
          const who = order[mine].who && order[mine].who !== '선생님' ? order[mine].who : null
          celebrate({ key: `quiz:${q.id}`, ...resultLook(q, order[mine].score, mine + 1, teamName(order[0].team_id), who) })
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
export function BusJoin({ session, onJoin, onLogout }) {
  const { data } = useRemote(session.code, onLogout)
  const [name, setName] = useState(session.name || '')
  const [teamId, setTeamId] = useState(session.teamId || null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const team = TEAMS.find((t) => t.id === teamId)

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
      <form className="join-form" onSubmit={join}>
        <label className="field">
          <span>내 이름</span>
          <input value={name} onChange={(e) => { setName(e.target.value); setError('') }} maxLength={10} placeholder="예: 지민" autoComplete="off" />
          <small>맞히면 이름이 모두의 화면에 나옵니다</small>
        </label>
        <div className="field">
          <span>우리 팀</span>
          <div className="team-grid">
            {teamsOf(data).map((t) => (
              <button type="button" key={t.id} className={`team-btn${teamId === t.id ? ' sel' : ''}`} style={{ background: t.color }}
                onClick={() => { setTeamId(t.id); setError('') }} aria-pressed={teamId === t.id}>
                {t.name}
                {data && teacherNames(teachersOf(data, t.id)).length > 0 && <small>{teacherNames(teachersOf(data, t.id)).join(' · ')} 선생님</small>}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? '들어가는 중입니다' : team ? `${team.name}으로 입장` : '입장'}</button>
      </form>
      <p className="select-links"><button className="link" onClick={() => onLogout()}>코드 다시 입력</button></p>
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

// 2. 대기실: 다음에 할 일, 함께 들어온 우리 팀, 에버랜드 미션 미리 보기(기대감)
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
      <div className="card">
        <p className="hint">에버랜드에서 할 미션 미리 보기</p>
        <div className="tiles">{MISSIONS.slice(0, 8).map((m) => <span key={m.id} title={m.title}>{m.icon}</span>)}</div>
        <p className="hint">빙고 16칸 · 본부 지령 · 퀴즈 대결</p>
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

// 6. 결과: 본부가 입장을 닫으면 나온다. 마지막으로 받은 상태로 시상대를 그린다.
function BusResult({ data, onExit }) {
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
          <p className="hint">버스 퀴즈 점수는 에버랜드 미션 점수에 그대로 더해집니다</p>
          <p className="bus-scores">{rows.filter((r) => r.points > 0).map((r) => `${r.team.name} +${r.points}`).join(' · ')}</p>
        </div>
      )}
      <div className="card bus-hero">
        <p className="bus-hero-icon">🎡</p>
        <p className="question">이제 에버랜드에서 만나요</p>
        <p className="hint">미션은 선생님 휴대폰으로 진행합니다</p>
      </div>
      <button className="ghost" onClick={onExit}>처음 화면으로</button>
    </main>
  )
}

// 버스 퀴즈 화면. 본부가 연 문제가 있으면 그 문제를, 없으면 대기실을 보여 준다.
export function PlayerHome({ session, onLeave, onLogout }) {
  const { code, teamId, name } = session
  const team = TEAMS.find((t) => t.id === teamId)
  const [ended, setEnded] = useState(false)
  const last = useRef(null) // 입장이 닫혔을 때 결과 화면에 쓸 마지막 상태
  const onBad = useCallback((err) => (err?.ended ? setEnded(true) : onLogout(err)), [onLogout])
  const [battleOn, setBattleOn] = useState(false)
  // 결과 화면(입장이 닫힘)에서는 30초마다만 확인한다. 본부가 입장을 다시 열면 문제 화면으로 돌아간다.
  const { data, online, refresh } = useRemote(code, onBad, ended ? 30000 : battleOn ? POLL_BATTLE_MS : POLL_BUS_MS, deviceId())
  useEffect(() => {
    if (data) {
      last.current = data
      setEnded(false)
    }
    setBattleOn(Boolean(liveBattle(data)))
  }, [data])
  // 화면을 열 때 입장 기록을 다시 남긴다(본부가 기록을 지운 뒤에도 저장된 이름·팀으로 바로 답할 수 있게).
  useEffect(() => {
    rpc('evm_player_join', { p_code: code, p_device: deviceId(), p_team: teamId, p_name: name }).catch(() => {})
  }, [code, teamId, name])
  useBattleWatch(code, data, teamId)

  useEffect(() => {
    report('enter', `${team.name} 버스 퀴즈 입장 · 화면 ${window.innerWidth}x${window.innerHeight}`)
  }, [team.name])

  if (ended) return <BusResult data={last.current} onExit={() => onLogout()} />

  const teams = teamsOf(data)
  const current = currentBusQuestion(data)

  return (
    <div className="app player" style={{ '--team': team.color }}>
      <header className="top">
        <button className="team-chip" onClick={() => confirm('팀이나 이름을 바꿉니까?') && onLeave()}>
          {team.name} · {name}
        </button>
        <div className="stats">
          <span>🚌 버스 퀴즈</span>
          <span className="score"><b>{data ? busPoints(data, teamId) : 0}</b>점</span>
        </div>
      </header>
      <BusStatusBar data={data} current={current} teamId={teamId} teams={teams} />
      {!online && (
        <div className="status">
          <span className="net off">연결 끊김 · 다시 연결되면 이어집니다</span>
        </div>
      )}
      <CelebrationLayer teamName={team.name} />
      <main className="body bus-body">
        {!data && <p className="guide">불러오는 중입니다.</p>}
        {data && current && (
          <>
            <QuizCard key={current.id} code={code} teamId={teamId} quiz={current} data={data}
              result={answerOf(data, teamId, current)} refresh={refresh} who={name} onBadPlayer={onLeave} />
            {current.round === 'ot' && current.body != null && <OtProgress data={data} quiz={current} teamId={teamId} />}
          </>
        )}
        {data && !current && <BusLobby data={data} teamId={teamId} />}
      </main>
    </div>
  )
}
