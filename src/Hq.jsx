import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { TEAMS, MISSIONS, QUIZ_KINDS, SEED_QUIZ, toChosung } from './data.js'
import { rpc, suggestQuiz } from './store.js'
import { doneByTeam, missionInfo, rushRank } from './logic.js'
import { useRemote, Photo, VerseView, Ranking, teamsOf, LocationList, useLocationShare } from './shared.jsx'

const TeamMap = lazy(() => import('./TeamMap.jsx'))

// 본부 화면. 본부 코드로 입장한 사람만 사용한다.
export default function Hq({ session, onLogout }) {
  const { code, role } = session
  const { data, online, refresh } = useRemote(code, onLogout)
  const [body, setBody] = useState('')
  const [message, setMessage] = useState('')
  const locate = useLocationShare(code, 0) // 본부 위치(팀 번호 0)

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
            <h2 className="section">📍 팀 위치</h2>
            <p className="guide">
              선생님이 팀 화면의 "모두" 탭에서 위치 공유를 켜면 표시됩니다. 미션을 완료할 때마다, 그리고 팀 화면이 열려 있는 동안 1분마다 갱신됩니다.
              10분 넘게 갱신되지 않은 팀은 흐리게 표시됩니다. "지도에서 보기"를 누르면 에버랜드 공식 지도가 그 팀의 위치에서 열립니다.
            </p>
            <Suspense fallback={<p className="guide">지도를 불러오는 중입니다.</p>}>
              <TeamMap data={data} here={locate.here} myTeamId={0} />
            </Suspense>
            <LocationList data={data} />
            <p className="team-count">
              본부 위치 표시
              <button className={locate.on ? 'on' : ''} onClick={() => locate.toggle(true)}>켜기</button>
              <button className={!locate.on ? 'on' : ''} onClick={() => locate.toggle(false)}>끄기</button>
              <small>{locate.error || '이 기기의 위치를 지도에 "본부"로 표시합니다.'}</small>
            </p>
            <p className="team-count">
              팀끼리 서로의 위치 보기
              <button className={data.share_locations ? 'on' : ''} onClick={() => run('evm_share_locations', { p_on: true }, '팀끼리 위치를 볼 수 있게 했습니다.')}>허용</button>
              <button className={!data.share_locations ? 'on' : ''} onClick={() => run('evm_share_locations', { p_on: false }, '팀 위치를 본부에서만 보게 했습니다.')}>본부만</button>
            </p>
          </section>

          <section>
            <h2 className="section">📢 실시간 지령</h2>
            <OrderForm run={run} />
            <OrderList data={data} teams={teams} doneMap={doneMap} run={run} />
          </section>

          <section>
            <h2 className="section">🎲 퀴즈 출제</h2>
            <QuizAdmin code={code} data={data} teams={teams} run={run} />
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
  const [rush, setRush] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!body.trim() || (kind === 'answer' && !answer.trim())) return
    const ok = await run(
      'evm_order',
      { p_kind: kind, p_body: body.trim(), p_answer: kind === 'answer' ? answer.trim() : null, p_points: points, p_rush: rush },
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
        {!rush && [10, 20, 30].map((p) => (
          <button type="button" key={p} className={points === p ? 'on' : ''} onClick={() => setPoints(p)}>{p}점</button>
        ))}
        <button type="button" className={rush ? 'on' : ''} onClick={() => setRush(!rush)}>⏱ 타임어택</button>
      </div>
      {rush && <p className="guide">타임어택은 먼저 완료한 순서대로 30·20·10점, 그 뒤는 5점을 받습니다. 이동 중에 뛰지 않도록 제자리에서 할 수 있는 내용으로 냅니다.</p>}
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

function orderRank(data, teamId, o) {
  if (o.kind === 'photo') return rushRank(data, o.id, teamId)
  const mine = data.scores.find((s) => s.team_id === teamId && s.game_id === `order:${o.id}`)
  return mine ? [30, 20, 10].indexOf(mine.score) + 1 || 4 : 0
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
              {o.rush && '⏱ 타임어택 · '}{o.kind === 'photo' ? '사진 미션' : '정답 미션'} · {o.rush ? '30·20·10점' : `${o.points}점`} · {o.open ? '진행 중' : '마감'} · 완료 {doneTeams.length}/{teams.length}팀
            </p>
            <p className="order-body">{o.body}{o.kind === 'answer' && <small> (정답: {o.answer})</small>}</p>
            {doneTeams.length > 0 && (
              <p className="order-meta">
                완료: {doneTeams.map((t) => t.name + (o.rush ? `(${orderRank(data, t.id, o)}등)` : '')).join(', ')}
              </p>
            )}
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

// 팀별 달성 현황표: 빙고 미션 16개, 본부 지령, 퀴즈 종류별 맞힌 수, 출제 점수
function Matrix({ data, teams, doneMap }) {
  const orders = [...data.orders].reverse()
  const solvedCount = (teamId, kind) =>
    data.quizzes.filter((q) => q.kind === kind && data.scores.some((s) => s.team_id === teamId && s.game_id === `quiz:${q.id}` && s.score > 0)).length
  const authorBonus = (teamId) => data.scores.filter((s) => s.team_id === teamId && s.game_id.startsWith('qa:')).reduce((sum, s) => sum + s.score, 0)
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
              {teams.map((t) => <td key={t.id}>{orderDone(data, doneMap, t.id, o) ? (o.rush ? `${orderRank(data, t.id, o)}등` : '✓') : ''}</td>)}
            </tr>
          ))}
          {QUIZ_KINDS.map((k) => {
            const total = data.quizzes.filter((q) => q.kind === k.id && q.status !== 'pending' && q.status !== 'draft').length
            return (
              <tr key={k.id} className="matrix-quiz">
                <th>{k.icon} {k.title} (맞힌 수 / 출제 {total})</th>
                {teams.map((t) => <td key={t.id}>{solvedCount(t.id, k.id)}</td>)}
              </tr>
            )
          })}
          <tr className="matrix-quiz">
            <th>🙆 몸으로 말해요 출제 점수</th>
            {teams.map((t) => <td key={t.id}>{authorBonus(t.id) || ''}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

const STATUS_LABEL = { pending: '승인 대기', draft: '보관', open: '출제 중', closed: '마감' }

// 퀴즈 출제·승인·마감·삭제
function QuizAdmin({ code, data, teams, run }) {
  const [kind, setKind] = useState('chosung')
  const list = data.quizzes.filter((q) => q.kind === kind)
  const drafts = list.filter((q) => q.status === 'draft').length
  const pendingActs = data.quizzes.filter((q) => q.status === 'pending').length

  function seed() {
    if (!confirm(`기본 문제 ${SEED_QUIZ.length}개를 보관 상태로 넣습니다. 이미 넣었다면 문제가 중복됩니다. 진행합니까?`)) return
    run('evm_quiz_seed', { p_items: SEED_QUIZ }, '기본 문제를 보관 상태로 넣었습니다. 필요한 문제를 골라 출제합니다.')
  }

  return (
    <>
      <div className="seg">
        {QUIZ_KINDS.map((k) => (
          <button key={k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}>
            {k.icon} {k.title} {data.quizzes.filter((q) => q.kind === k.id).length}
            {k.id === 'act' && pendingActs > 0 && <b className="badge">{pendingActs}</b>}
          </button>
        ))}
      </div>

      {kind === 'act' ? (
        <p className="guide">팀이 사진과 정답을 보내면 여기에 표시됩니다. 승인하면 다른 팀에게 출제되고, 맞힌 팀은 10점, 출제한 팀은 맞힌 팀마다 5점을 받습니다.</p>
      ) : (
        <QuizForm key={kind} kind={kind} code={code} run={run} />
      )}

      <p className="quiz-tools">
        {kind !== 'act' && drafts > 0 && (
          <button className="link" onClick={() => run('evm_quiz_open_all', { p_kind: kind }, '보관 중인 문제를 모두 출제했습니다.')}>보관 {drafts}개 모두 출제</button>
        )}
        {kind !== 'act' && <button className="link" onClick={seed}>기본 문제 불러오기</button>}
      </p>

      {!list.length && <p className="guide">문제가 없습니다.</p>}
      <ul className="order-list">
        {list.map((q) => {
          const solvers = teams.filter((t) => data.scores.some((s) => s.team_id === t.id && s.game_id === `quiz:${q.id}` && s.score > 0))
          const author = TEAMS.find((t) => t.id === q.author_team)
          return (
            <li key={q.id} className={q.status === 'closed' ? 'closed' : ''}>
              <p className="order-meta">
                <b className={`status-chip ${q.status}`}>{STATUS_LABEL[q.status]}</b> {q.points}점
                {q.kind === 'bible' && (q.choices ? ' · 객관식' : ' · 단답형')}{author && ` · ${author.name} 출제`} · 맞힌 팀 {solvers.length}
                {solvers.length > 0 && ` (${solvers.map((t) => t.name).join(', ')})`}
              </p>
              {q.kind === 'act' && <HqQuizPhoto code={code} quizId={q.id} />}
              <p className="order-body">
                {q.body}
                <small> 정답: {q.choices ? q.choices[Number(q.answer)] : q.answer}{q.hint && ` · 힌트: ${q.hint}`}</small>
              </p>
              {q.choices && <p className="order-meta">{q.choices.join(' / ')}</p>}
              <p className="quiz-tools">
                {q.status === 'pending' && <button className="link" onClick={() => run('evm_quiz_set', { p_id: q.id, p_status: 'open' }, '승인해 출제했습니다.')}>승인하고 출제</button>}
                {q.status === 'draft' && <button className="link" onClick={() => run('evm_quiz_set', { p_id: q.id, p_status: 'open' }, '출제했습니다.')}>출제</button>}
                {q.status === 'open' && <button className="link" onClick={() => run('evm_quiz_set', { p_id: q.id, p_status: 'closed' }, '마감했습니다.')}>마감</button>}
                {q.status === 'closed' && <button className="link" onClick={() => run('evm_quiz_set', { p_id: q.id, p_status: 'open' }, '다시 출제했습니다.')}>다시 출제</button>}
                <button
                  className="link"
                  onClick={() => confirm('이 문제를 삭제합니까? 이 문제로 받은 점수도 함께 지워집니다.') && run('evm_quiz_delete', { p_id: q.id }, '삭제했습니다.')}
                >
                  {q.status === 'pending' ? '반려(삭제)' : '삭제'}
                </button>
              </p>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function HqQuizPhoto({ code, quizId }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let alive = true
    rpc('evm_quiz_photo', { p_code: code, p_id: quizId }).then((photo) => alive && setSrc(photo)).catch(() => {})
    return () => {
      alive = false
    }
  }, [code, quizId])
  return src ? <img className="quiz-photo" src={src} alt="팀이 보낸 사진" /> : null
}

const emptyDraft = { body: '', answer: '', hint: '', choices: ['', '', '', ''], correct: 0 }

// 입력한 내용을 서버 함수 인자로 바꾼다. 빠진 칸이 있으면 null.
function draftArgs(kind, mode, d) {
  if (kind === 'chosung') {
    if (!d.answer.trim()) return null
    return { p_body: toChosung(d.answer.trim()), p_choices: null, p_answer: d.answer.trim(), p_hint: d.hint.trim() }
  }
  if (kind === 'bible' && mode === 'choice') {
    if (!d.body.trim() || d.choices.some((c) => !c.trim())) return null
    return { p_body: d.body.trim(), p_choices: d.choices.map((c) => c.trim()), p_answer: String(d.correct), p_hint: null }
  }
  if (!d.body.trim() || !d.answer.trim()) return null
  return { p_body: d.body.trim(), p_choices: null, p_answer: d.answer.trim(), p_hint: null }
}

function QuizForm({ kind, code, run }) {
  const [mode, setMode] = useState('choice') // 성경 퀴즈: choice(객관식) | short(단답형)
  const [draft, setDraft] = useState(emptyDraft)
  const [points, setPoints] = useState(10)
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const args = draftArgs(kind, mode, draft)
  const isChoice = kind === 'bible' && mode === 'choice'

  async function submit(open) {
    if (!args) return
    const ok = await run('evm_quiz_add', { p_kind: kind, ...args, p_points: points, p_open: open }, open ? '출제했습니다.' : '보관했습니다.')
    if (ok) setDraft(emptyDraft)
  }

  return (
    <div className="composer">
      <form className="composer-form" onSubmit={(e) => e.preventDefault()}>
        {kind === 'bible' && (
          <div className="seg">
            <button type="button" className={mode === 'choice' ? 'on' : ''} onClick={() => setMode('choice')}>객관식</button>
            <button type="button" className={mode === 'short' ? 'on' : ''} onClick={() => setMode('short')}>단답형</button>
          </div>
        )}

        {kind !== 'chosung' && (
          <label className="field">
            <span>문제</span>
            <textarea rows={2} value={draft.body} onChange={(e) => set({ body: e.target.value })} maxLength={300}
              placeholder={kind === 'nonsense' ? '예: 왕이 넘어지면?' : '예: 홍해를 가른 지도자는 누구입니까?'} />
          </label>
        )}

        {isChoice ? (
          <div className="field">
            <span>선택지 (정답인 칸의 동그라미를 고릅니다)</span>
            {draft.choices.map((c, i) => (
              <label key={i} className={`choice-row ${draft.correct === i ? 'correct' : ''}`}>
                <input type="radio" name="correct" checked={draft.correct === i} onChange={() => set({ correct: i })} aria-label={`${i + 1}번을 정답으로`} />
                <input value={c} onChange={(e) => set({ choices: draft.choices.map((x, k) => (k === i ? e.target.value : x)) })} maxLength={60} aria-label={`선택지 ${i + 1}`} placeholder={`선택지 ${i + 1}`} />
              </label>
            ))}
          </div>
        ) : (
          <label className="field">
            <span>{kind === 'bible' ? '정답 핵심 낱말' : '정답'}</span>
            <input value={draft.answer} onChange={(e) => set({ answer: e.target.value })} maxLength={60}
              placeholder={kind === 'chosung' ? '예: 우리 교회 이름, 목사님 성함, 성경 인물' : kind === 'bible' ? '예: 모세' : '예: 킹콩'} />
            <small>
              {kind === 'bible'
                ? '답안에 이 낱말이 들어 있으면 정답입니다. 다르게 부를 수 있으면 쉼표로 여러 개 적습니다(예: 베드로, 시몬).'
                : '띄어쓰기는 채점에서 무시합니다. 정답이 여러 개면 쉼표로 적습니다.'}
            </small>
          </label>
        )}

        {kind === 'chosung' && (
          <label className="field">
            <span>힌트 (선택)</span>
            <input value={draft.hint} onChange={(e) => set({ hint: e.target.value })} maxLength={100} placeholder="힌트를 본 팀은 절반 점수를 받습니다" />
          </label>
        )}

        <div className="composer-actions">
          <div className="seg">
            {[5, 10, 20].map((p) => (
              <button type="button" key={p} className={points === p ? 'on' : ''} onClick={() => setPoints(p)}>{p}점</button>
            ))}
          </div>
          <button type="button" className="ghost" disabled={!args} onClick={() => submit(false)}>보관</button>
          <button type="button" className="primary" disabled={!args} onClick={() => submit(true)}>바로 출제</button>
        </div>
      </form>

      <div className="composer-preview">
        <p className="preview-label">팀 화면 미리보기</p>
        <div className="card">
          <p className="hint">{points}점{kind === 'chosung' && draft.hint.trim() && ` · 힌트를 보면 ${Math.ceil(points / 2)}점`}</p>
          {kind === 'chosung' ? (
            <p className="big">{draft.answer.trim() ? toChosung(draft.answer.trim()) : 'ㅊㅅ'}</p>
          ) : (
            <p className="question">{draft.body.trim() || '문제가 여기에 표시됩니다'}</p>
          )}
          {isChoice ? (
            <div className="choices">
              {draft.choices.map((c, i) => (
                <span key={i} className={`choice ${draft.correct === i ? 'right' : ''}`}>{c.trim() || `선택지 ${i + 1}`}</span>
              ))}
            </div>
          ) : (
            <div className="login answer-form">
              <input disabled placeholder="정답" aria-label="미리보기 입력 칸" />
              <span className="primary fake-btn">제출</span>
            </div>
          )}
        </div>
      </div>

      <AiSuggest kind={kind} mode={mode} code={code} run={run} points={points} />
    </div>
  )
}

// Claude에게 문제 후보를 받아 고른 것만 보관한다.
function AiSuggest({ kind, mode, code, run, points }) {
  const [topic, setTopic] = useState('')
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const apiKind = kind === 'bible' ? (mode === 'choice' ? 'bible_choice' : 'bible_short') : kind

  async function ask() {
    setBusy(true)
    setError('')
    try {
      setItems(await suggestQuiz(code, apiKind, topic, 5))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function keep(item, index) {
    const isChoice = apiKind === 'bible_choice'
    const args =
      kind === 'chosung'
        ? { p_body: toChosung(item.answer.replace(/\s/g, '')), p_choices: null, p_answer: item.answer.replace(/\s/g, ''), p_hint: item.hint || '' }
        : { p_body: item.body, p_choices: isChoice ? item.choices : null, p_answer: item.answer, p_hint: null }
    const ok = await run('evm_quiz_add', { p_kind: kind, ...args, p_points: points, p_open: false }, '추천 문제를 보관했습니다.')
    if (ok) setItems((list) => list.filter((_, i) => i !== index))
  }

  return (
    <div className="ai-suggest">
      <p className="preview-label">✨ AI 문제 추천 (Claude Sonnet 5.5)</p>
      <div className="login">
        <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} aria-label="추천 주제"
          placeholder="주제(예: 다윗, 예수님의 기적, 에버랜드 동물). 비워 두면 자유 주제" />
        <button type="button" className="primary" disabled={busy} onClick={ask}>{busy ? '만드는 중입니다' : '추천 받기'}</button>
      </div>
      <p className="guide">추천은 후보입니다. 내용을 확인한 뒤 "보관"을 누른 문제만 목록에 들어가고, 출제는 목록에서 따로 합니다.</p>
      {error && <p className="error">{error}</p>}
      <ul className="order-list">
        {items.map((item, i) => (
          <li key={i}>
            <p className="order-body">
              {kind === 'chosung' ? `${toChosung(item.answer)} (${item.answer})` : item.body}
            </p>
            {apiKind === 'bible_choice' ? (
              <p className="order-meta">
                {item.choices.map((c, k) => (String(k) === String(item.answer) ? `✔ ${c}` : c)).join(' / ')}
              </p>
            ) : (
              <p className="order-meta">정답: {item.answer}{item.hint && ` · 힌트: ${item.hint}`}</p>
            )}
            <p className="quiz-tools">
              <button className="link" onClick={() => keep(item, i)}>보관</button>
              <button className="link" onClick={() => setItems((list) => list.filter((_, k) => k !== i))}>버리기</button>
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
