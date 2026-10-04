import { useMemo, useState } from 'react'
import { TEAMS, MISSIONS } from './data.js'
import { rpc } from './store.js'
import { doneByTeam, missionInfo } from './logic.js'
import { useRemote, Photo, VerseView, Ranking, teamsOf } from './shared.jsx'

const QUIZ_GAMES = [
  { id: 'bible', title: '성경 퀴즈 대결' },
  { id: 'chosung', title: '초성 퀴즈 대결' },
]

// 본부 화면. 본부 코드로 입장한 사람만 사용한다.
export default function Hq({ session, onLogout }) {
  const { code, role } = session
  const { data, online, refresh } = useRemote(code, onLogout)
  const [body, setBody] = useState('')
  const [message, setMessage] = useState('')

  const doneMap = useMemo(() => doneByTeam(data?.submissions || []), [data])
  const counts = useMemo(
    () => Object.fromEntries(TEAMS.map((t) => [t.id, MISSIONS.filter((m) => doneMap[t.id][m.id]).length])),
    [doneMap],
  )

  if (role !== 'admin') {
    return (
      <main className="select">
        <h1>본부 화면</h1>
        <p className="sub">본부 코드로 입장해야 사용할 수 있습니다.</p>
        <p className="select-links">
          <a href="#">팀 화면으로</a>
          <button className="link" onClick={onLogout}>코드 다시 입력</button>
        </p>
      </main>
    )
  }

  async function run(fn, args, okMessage) {
    try {
      await rpc(fn, { p_code: code, ...args })
      setMessage(okMessage)
      refresh()
      return true
    } catch (err) {
      setMessage(`실패했습니다: ${err.message}`)
      return false
    }
  }

  function sendNotice(e) {
    e.preventDefault()
    if (!body.trim()) return
    run('evm_notice', { p_body: body.trim() }, '알림을 보냈습니다.')
    setBody('')
  }

  function wipe() {
    if (prompt('모든 사진과 기록을 지웁니다. 되돌릴 수 없습니다. 진행하려면 "삭제"를 입력합니다.') !== '삭제') return
    run('evm_wipe', {}, '모든 기록을 지웠습니다.')
  }

  const teams = teamsOf(data)

  return (
    <div className="hq">
      <header className="hq-top">
        <h1>본부</h1>
        <span className={online ? 'net' : 'net off'}>{online ? '연결됨' : '연결 끊김'}</span>
        <a href="#show">슬라이드쇼</a>
        <a href="#">팀 화면</a>
      </header>

      {message && <p className="notice">{message}</p>}
      {!data && <p className="guide">불러오는 중입니다.</p>}

      {data && (
        <>
          <section>
            <h2 className="section">팀 순위</h2>
            <Ranking data={data} showCheckin />
            <p className="team-count">
              참가 팀 수
              {[5, 6].map((n) => (
                <button
                  key={n}
                  className={data.team_count === n ? 'on' : ''}
                  onClick={() => run('evm_set_teams', { p_count: n }, `참가 팀을 ${n}개로 정했습니다.`)}
                >
                  {n}팀
                </button>
              ))}
              <small>말씀 조각 배분이 달라지므로 행사 시작 전에 정합니다.</small>
            </p>
          </section>

          <section>
            <h2 className="section">📢 실시간 지령</h2>
            <OrderForm run={run} />
            <OrderList data={data} teams={teams} doneMap={doneMap} run={run} />
          </section>

          <section>
            <h2 className="section">전체 알림(점수 없음)</h2>
            <p className="guide">현재 알림: {data.notice?.body ? data.notice.body : '없음'}</p>
            <form className="login" onSubmit={sendNotice}>
              <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={200} placeholder="예: 3시 20분까지 정문 앞으로 모입니다" aria-label="알림 내용" />
              <button className="primary">보내기</button>
            </form>
            {data.notice?.body && (
              <button className="link" onClick={() => run('evm_notice', { p_body: '' }, '알림을 내렸습니다.')}>현재 알림 내리기</button>
            )}
          </section>

          <section>
            <h2 className="section">팀별 미션 달성 현황</h2>
            <Matrix data={data} teams={teams} doneMap={doneMap} />
          </section>

          <section>
            <h2 className="section">말씀 조각</h2>
            <VerseView counts={counts} teams={teams} />
          </section>

          <section>
            <h2 className="section">올라온 사진 {data.submissions.length}장</h2>
            <div className="hq-photos">
              {data.submissions.map((sub) => {
                const team = TEAMS.find((t) => t.id === sub.team_id)
                const mission = missionInfo(sub.mission_id, data.orders)
                return (
                  <figure key={`${sub.team_id}:${sub.mission_id}:${sub.at}`}>
                    <Photo code={code} sub={sub} alt={mission.title} />
                    <figcaption>
                      <span><b style={{ color: team?.color }}>{team?.name}</b> {mission.title}</span>
                      <button
                        className="link"
                        onClick={() =>
                          confirm('이 사진을 지웁니까? 해당 팀의 완료 기록도 지워집니다.') &&
                          run('evm_remove', { p_team: sub.team_id, p_mission: sub.mission_id }, '사진을 지웠습니다.')
                        }
                      >
                        지우기
                      </button>
                    </figcaption>
                  </figure>
                )
              })}
            </div>
          </section>

          <section>
            <h2 className="section">행사 뒤 정리</h2>
            <p className="guide">행사가 끝나고 사진을 내려받은 뒤 서버의 사진과 기록을 모두 지웁니다.</p>
            <button className="danger" onClick={wipe}>모든 사진과 기록 지우기</button>
          </section>
        </>
      )}
    </div>
  )
}

function OrderForm({ run }) {
  const [kind, setKind] = useState('photo')
  const [body, setBody] = useState('')
  const [answer, setAnswer] = useState('')
  const [points, setPoints] = useState(20)

  async function submit(e) {
    e.preventDefault()
    if (!body.trim() || (kind === 'answer' && !answer.trim())) return
    const ok = await run(
      'evm_order',
      { p_kind: kind, p_body: body.trim(), p_answer: kind === 'answer' ? answer.trim() : null, p_points: points },
      '지령을 보냈습니다. 팀 화면에 15초 안에 표시됩니다.',
    )
    if (ok) {
      setBody('')
      setAnswer('')
    }
  }

  return (
    <form className="order-form" onSubmit={submit}>
      <div className="seg">
        <button type="button" className={kind === 'photo' ? 'on' : ''} onClick={() => setKind('photo')}>사진 미션</button>
        <button type="button" className={kind === 'answer' ? 'on' : ''} onClick={() => setKind('answer')}>정답 미션</button>
        <span className="seg-gap" />
        {[10, 20, 30].map((p) => (
          <button type="button" key={p} className={points === p ? 'on' : ''} onClick={() => setPoints(p)}>{p}점</button>
        ))}
      </div>
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={200}
        aria-label="지령 내용"
        placeholder={kind === 'photo' ? '예: 쓰레기를 주워 버리는 인증 사진을 올립니다' : '예: 정문 매표소 옆 동상의 동물은 무엇입니까?'}
      />
      {kind === 'answer' && (
        <>
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={40} aria-label="정답" placeholder="정답(낱말 하나)" />
          <p className="guide">정답은 낱말 하나로 정합니다. 띄어쓰기와 영문 대소문자는 구분하지 않습니다.</p>
        </>
      )}
      <button className="primary">지령 보내기</button>
    </form>
  )
}

function orderDone(data, doneMap, teamId, order) {
  if (order.kind === 'photo') return Boolean(doneMap[teamId][`order:${order.id}`])
  return data.scores.some((s) => s.team_id === teamId && s.game_id === `order:${order.id}`)
}

function OrderList({ data, teams, doneMap, run }) {
  if (!data.orders.length) return <p className="guide">아직 보낸 지령이 없습니다.</p>
  return (
    <ul className="order-list">
      {data.orders.map((o) => {
        const doneTeams = teams.filter((t) => orderDone(data, doneMap, t.id, o))
        return (
          <li key={o.id} className={o.open ? '' : 'closed'}>
            <p className="order-meta">
              {o.kind === 'photo' ? '사진 미션' : '정답 미션'} · {o.points}점 · {o.open ? '진행 중' : '마감'} · 완료 {doneTeams.length}/{teams.length}팀
            </p>
            <p className="order-body">{o.body}{o.kind === 'answer' && <small> (정답: {o.answer})</small>}</p>
            {doneTeams.length > 0 && <p className="order-meta">완료: {doneTeams.map((t) => t.name).join(', ')}</p>}
            {o.open && (
              <button className="link" onClick={() => confirm('이 지령을 마감합니까? 마감 뒤에는 제출할 수 없습니다.') && run('evm_order_close', { p_id: o.id }, '지령을 마감했습니다.')}>
                마감하기
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// 팀별 달성 현황표: 빙고 미션 16개, 본부 지령, 대결 점수
function Matrix({ data, teams, doneMap }) {
  const orders = [...data.orders].reverse()
  const quizScore = (teamId, gameId) => data.scores.find((s) => s.team_id === teamId && s.game_id === gameId)?.score
  return (
    <div className="matrix-wrap">
      <table className="matrix">
        <thead>
          <tr>
            <th>미션</th>
            {teams.map((t) => <th key={t.id} style={{ color: t.color }}>{t.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {MISSIONS.map((m) => (
            <tr key={m.id}>
              <th>{m.icon} {m.title}</th>
              {teams.map((t) => <td key={t.id}>{doneMap[t.id][m.id] ? '✓' : ''}</td>)}
            </tr>
          ))}
          {orders.map((o) => (
            <tr key={o.id} className="matrix-order">
              <th>📢 {o.body}</th>
              {teams.map((t) => <td key={t.id}>{orderDone(data, doneMap, t.id, o) ? '✓' : ''}</td>)}
            </tr>
          ))}
          {QUIZ_GAMES.map((g) => (
            <tr key={g.id} className="matrix-quiz">
              <th>{g.title}</th>
              {teams.map((t) => <td key={t.id}>{quizScore(t.id, g.id) ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
