import { useEffect, useState } from 'react'
import { QUIZ_KINDS, TEAMS } from './data.js'
import { rpc } from './store.js'
import { scoreOk, battleOrder, battleRule, serverNow } from './logic.js'
import { QuizImage } from './shared.jsx'
import { celebrate, markShown, resultLook, unlockAudio } from './celebrate.jsx'

// 전체 대결 퀴즈. 문제는 본부가 출제하고 서버가 채점한다.
// 몸으로 말해요(팀 출제)는 2026-10-12에 뺐다. 서버 함수 evm_act_submit은 남아 있다.
// 퀴즈 배틀(2026-10-17): 본부가 시작하면 10초나 15초 뒤에 모든 팀에게 함께 공개되고, 맞힌 순서로 점수를 받는다.

const ERRORS = {
  EVM_QUIZ_CLOSED: '마감된 문제입니다.',
  EVM_QUIZ_DONE: '이미 답한 문제입니다.',
  EVM_QUIZ_NOT_STARTED: '아직 공개되지 않은 문제입니다.',
}

function errorText(err) {
  const key = Object.keys(ERRORS).find((k) => String(err.message).includes(k))
  return key ? ERRORS[key] : '보내지 못했습니다. 통신 상태를 확인합니다.'
}

const resultOf = (data, teamId, quizId) => data.scores.find((s) => s.team_id === teamId && s.game_id === `quiz:${quizId}`)

// 팀에게 보이는 문제 목록
const listOf = (data, teamId, kind) => data.quizzes.filter((q) => q.kind === kind && q.status !== 'pending')

const teamName = (id) => TEAMS.find((t) => t.id === id)?.name || `${id}팀`

// 배틀 문제의 공개까지 남은 시간(초). 공개되었으면 0.
function useCountdown(data, quiz) {
  const left = () => (quiz?.starts_at ? Math.max(0, Math.ceil((new Date(quiz.starts_at) - serverNow(data)) / 1000)) : 0)
  const [sec, setSec] = useState(left)
  useEffect(() => {
    setSec(left())
    if (!quiz?.starts_at) return
    const timer = setInterval(() => setSec(left()), 250)
    return () => clearInterval(timer)
  }, [quiz?.starts_at, data])
  return sec
}

export default function Games({ code, teamId, data, refresh, focus, onFocused }) {
  const [selected, setSelected] = useState(null) // 문제 id

  // 배틀 알림에서 "배틀로 가기"를 누르면 그 문제를 연다.
  useEffect(() => {
    if (focus) {
      setSelected(focus)
      onFocused?.()
    }
  }, [focus, onFocused])

  if (!data) return <p className="guide">문제를 불러오는 중입니다. 통신이 연결되어야 표시됩니다.</p>

  const quiz = data.quizzes.find((q) => q.id === selected)
  if (quiz) {
    const kind = QUIZ_KINDS.find((k) => k.id === quiz.kind)
    // 같은 종류 안에서 앞뒤 문제로 옮겨 간다. 다음 문제는 아직 풀지 않은 문제를 먼저 찾는다.
    const list = listOf(data, teamId, quiz.kind)
    const index = list.findIndex((q) => q.id === quiz.id)
    const open = (q) => q.status === 'open' && !resultOf(data, teamId, q.id)
    const nextOpen = list.slice(index + 1).find(open) || list.slice(0, index).find(open)
    return (
      <section className="game">
        <button className="back" onClick={() => setSelected(null)}>← 문제 목록</button>
        <h2>{kind.icon} {kind.title} <small className="quiz-pos">{index + 1} / {list.length}</small></h2>
        <QuizCard
          key={quiz.id}
          code={code}
          teamId={teamId}
          quiz={quiz}
          data={data}
          result={resultOf(data, teamId, quiz.id)}
          refresh={refresh}
          onNext={nextOpen ? () => setSelected(nextOpen.id) : null}
        />
        <div className="row quiz-nav">
          <button className="ghost" disabled={index <= 0} onClick={() => setSelected(list[index - 1].id)}>← 이전 문제</button>
          <button className="ghost" disabled={index >= list.length - 1} onClick={() => setSelected(list[index + 1].id)}>다음 문제 →</button>
        </div>
      </section>
    )
  }

  const live = data.quizzes.filter((q) => q.battle && q.status === 'open').sort((a, b) => b.id - a.id)[0]

  return (
    <>
      <p className="guide">
        본부가 낸 문제를 모든 팀이 풉니다. 맞히면 문제에 적힌 점수가 순위에 더해집니다. 줄을 서서 기다리는 동안 작은 목소리로 의논합니다.
      </p>
      {live && <LiveBattle data={data} quiz={live} teamId={teamId} onOpen={() => setSelected(live.id)} />}
      {QUIZ_KINDS.map((kind) => {
        const list = listOf(data, teamId, kind.id)
        // 그림 퀴즈는 문제가 있을 때만 묶음을 보여 준다.
        if (kind.id === 'image' && !list.length) return null
        return (
          <section key={kind.id}>
            <h2 className="section">{kind.icon} {kind.title}</h2>
            <p className="guide">{kind.desc}</p>
            {!list.length && <p className="guide empty">아직 출제된 문제가 없습니다.</p>}
            <div className="quiz-grid">
              {list.map((q, i) => {
                const result = resultOf(data, teamId, q.id)
                const waiting = q.body == null && q.status === 'open'
                const state = result ? (scoreOk(result) ? 'solved' : 'failed') : q.status === 'closed' ? 'closed' : ''
                return (
                  <button key={q.id} className={`quiz-chip ${state} ${q.battle ? 'battle' : ''}`} onClick={() => setSelected(q.id)}>
                    <b>{q.battle && '⚡'}{i + 1}</b>
                    <small>
                      {result
                        ? scoreOk(result) ? (result.score > 0 ? `+${result.score}` : '정답') : '오답'
                        : q.status === 'closed' ? '마감' : waiting ? '곧 공개' : q.battle ? '배틀' : `${q.points}점`}
                    </small>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </>
  )
}

// 문제 목록 맨 위의 진행 중 배틀 안내
function LiveBattle({ data, quiz, teamId, onOpen }) {
  const sec = useCountdown(data, quiz)
  const mine = resultOf(data, teamId, quiz.id)
  return (
    <button className="battle-live" onClick={onOpen}>
      <span className="battle-live-title">⚡ 퀴즈 배틀 {sec > 0 ? `${sec}초 뒤 공개` : '진행 중'}</span>
      <span>{battleRule(quiz)}</span>
      <b>{mine ? '우리 팀은 이미 답했습니다. 결과 보기' : '문제 풀러 가기 →'}</b>
    </button>
  )
}

// 배틀에서 맞힌 순서. "1등 3팀 · 2등 1팀"
function BattleOrder({ data, quiz, teamId }) {
  const order = battleOrder(data, quiz.id)
  if (!order.length) return <p className="hint">아직 맞힌 팀이 없습니다.</p>
  return (
    <ol className="battle-order">
      {order.map((s, i) => (
        <li key={s.team_id} className={s.team_id === teamId ? 'mine' : ''}>
          <b>{i + 1}등</b> {teamName(s.team_id)} <small>{s.score > 0 ? `+${s.score}점` : '점수 없음'}</small>
        </li>
      ))}
    </ol>
  )
}

function QuizCard({ code, teamId, quiz, data, result, refresh, onNext }) {
  const [text, setText] = useState('')
  const [hint, setHint] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState(null) // 서버 채점 결과
  const [shake, setShake] = useState(false) // 틀렸을 때 입력 칸을 흔든다
  const sec = useCountdown(data, quiz)
  const done = Boolean(result) || quiz.status === 'closed'
  const isChoice = quiz.kind === 'bible' && Array.isArray(quiz.choices)
  const hidden = quiz.body == null // 배틀 문제가 아직 공개되지 않음
  // 초성 퀴즈의 힌트는 점수가 절반이 되고, 그림 퀴즈의 힌트는 감점이 없다.
  const hintHalf = quiz.kind === 'chosung'
  const hasHint = (quiz.kind === 'chosung' || quiz.kind === 'image') && quiz.hint

  // 카운트다운이 끝나면 바로 서버에서 문제를 받는다.
  useEffect(() => {
    if (hidden && sec === 0 && quiz.starts_at) {
      const timer = setTimeout(refresh, 300)
      return () => clearTimeout(timer)
    }
  }, [hidden, sec, quiz.starts_at, refresh])

  async function send(value) {
    unlockAudio() // 누르는 순간에 소리 장치를 깨워야 채점 뒤 효과음이 난다(아이폰)
    setBusy(true)
    setMessage('')
    try {
      const res = await rpc('evm_quiz_answer', { p_code: code, p_team: teamId, p_id: quiz.id, p_text: value, p_hint: hint })
      setReply(res)
      if (res.ok) {
        // 1등만 배틀에서 늦게 맞혔으면 1등 팀을 함께 알리고, 같은 문제의 "다른 팀이 맞혔습니다" 알림은 띄우지 않는다.
        const winner = battleOrder(data, quiz.id).find((s) => s.team_id !== teamId)
        if (quiz.battle === 'first') markShown(`win:${quiz.id}`)
        celebrate({ key: `quiz:${quiz.id}`, ...resultLook(quiz, res.points, res.rank, winner && teamName(winner.team_id)) })
      }
      if (res.ok || isChoice) refresh()
      else {
        setMessage('정답이 아닙니다. 다시 생각합니다.')
        setShake(true)
        navigator.vibrate?.(60)
        setTimeout(() => setShake(false), 450)
      }
    } catch (err) {
      setMessage(errorText(err))
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const correctIndex = reply?.answer ?? quiz.answer
  const ok = result ? scoreOk(result) : false
  const rank = quiz.battle && ok ? battleOrder(data, quiz.id).findIndex((s) => s.team_id === teamId) + 1 || reply?.rank : null

  if (hidden && quiz.status === 'open') {
    return (
      <div className="card">
        <p className="battle-tag">⚡ 퀴즈 배틀</p>
        <p className="hint">{battleRule(quiz)}</p>
        <p className="countdown">{sec > 0 ? sec : '…'}</p>
        <p className="question">{sec > 0 ? '초 뒤에 문제가 공개됩니다' : '문제를 받는 중입니다'}</p>
      </div>
    )
  }

  return (
    <div className="card">
      {quiz.battle ? (
        <>
          <p className="battle-tag">⚡ 퀴즈 배틀</p>
          <p className="hint">{battleRule(quiz)}{hintHalf && hasHint && !done && ' · 힌트를 보면 점수가 절반'}</p>
        </>
      ) : (
        <p className="hint">
          {quiz.points}점
          {hintHalf && hasHint && !done && ` · 힌트를 보면 ${Math.ceil(quiz.points / 2)}점`}
        </p>
      )}
      {quiz.kind === 'image' && <QuizImage code={code} quiz={quiz} />}
      <p className={quiz.kind === 'chosung' ? 'big' : 'question'}>{quiz.body}</p>
      {hasHint && (hint || done) && <p className="hint">힌트: {quiz.hint}</p>}

      {isChoice && (
        <div className="choices">
          {quiz.choices.map((c, i) => {
            const cls = !done ? '' : String(i) === String(correctIndex) ? 'right' : ''
            return (
              <button key={c} className={`choice ${cls}`} disabled={done || busy} onClick={() => send(String(i))}>
                {c}
              </button>
            )
          })}
        </div>
      )}

      {!isChoice && !done && (
        <>
          {hasHint && !hint && (
            <button className="ghost" onClick={() => setHint(true)}>{hintHalf ? '힌트 보기' : '힌트 보기 (감점 없음)'}</button>
          )}
          <form className={`login answer-form${shake ? ' shake' : ''}`} onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(text) }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="정답" aria-label="정답" autoComplete="off" />
            <button className="primary" disabled={busy}>제출</button>
          </form>
          <p className="hint">띄어쓰기는 상관없습니다. 맞힐 때까지 다시 낼 수 있습니다.</p>
        </>
      )}

      {message && <p className="error">{message}</p>}
      {result && !quiz.battle && (
        <p className="answer">{ok ? `정답입니다. +${result.score}점` : '오답입니다. 이 문제는 한 번만 답할 수 있습니다.'}</p>
      )}
      {result && quiz.battle && (
        <p className="answer">
          {!ok
            ? '오답입니다. 이 문제는 한 번만 답할 수 있습니다.'
            : result.score > 0
              ? `정답입니다. ${rank ? `${rank}등, ` : ''}+${result.score}점`
              : `정답입니다. ${rank ? `${rank}등입니다. ` : ''}1등만 점수를 받는 문제라 점수는 없습니다.`}
        </p>
      )}
      {quiz.battle && <BattleOrder data={data} quiz={quiz} teamId={teamId} />}
      {result && onNext && <button className="primary" onClick={onNext}>다음 문제 풀기</button>}
      {result && !onNext && !quiz.battle && <p className="hint">이 종류의 문제를 모두 풀었습니다.</p>}
      {!result && quiz.status === 'closed' && <p className="hint">마감된 문제입니다.</p>}
      {quiz.status === 'closed' && quiz.answer != null && !isChoice && <p className="hint">정답: {quiz.answer}</p>}
    </div>
  )
}
