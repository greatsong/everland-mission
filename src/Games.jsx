import { useState } from 'react'
import { QUIZ_KINDS } from './data.js'
import { rpc } from './store.js'

// 전체 대결 퀴즈. 문제는 본부가 출제하고 서버가 채점한다.
// 몸으로 말해요(팀 출제)는 2026-10-12에 뺐다. 서버 함수 evm_act_submit은 남아 있다.

const ERRORS = {
  EVM_QUIZ_CLOSED: '마감된 문제입니다.',
  EVM_QUIZ_DONE: '이미 답한 문제입니다.',
}

function errorText(err) {
  const key = Object.keys(ERRORS).find((k) => String(err.message).includes(k))
  return key ? ERRORS[key] : '보내지 못했습니다. 통신 상태를 확인합니다.'
}

const resultOf = (data, teamId, quizId) => data.scores.find((s) => s.team_id === teamId && s.game_id === `quiz:${quizId}`)

// 팀에게 보이는 문제 목록
const listOf = (data, teamId, kind) => data.quizzes.filter((q) => q.kind === kind && q.status !== 'pending')

export default function Games({ code, teamId, data, refresh }) {
  const [selected, setSelected] = useState(null) // 문제 id

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

  return (
    <>
      <p className="guide">
        본부가 낸 문제를 모든 팀이 풉니다. 맞히면 문제에 적힌 점수가 순위에 더해집니다. 줄을 서서 기다리는 동안 작은 목소리로 의논합니다.
      </p>
      {QUIZ_KINDS.map((kind) => {
        const list = listOf(data, teamId, kind.id)
        return (
          <section key={kind.id}>
            <h2 className="section">{kind.icon} {kind.title}</h2>
            <p className="guide">{kind.desc}</p>
            {!list.length && <p className="guide empty">아직 출제된 문제가 없습니다.</p>}
            <div className="quiz-grid">
              {list.map((q, i) => {
                const result = resultOf(data, teamId, q.id)
                const state = result ? (result.score > 0 ? 'solved' : 'failed') : q.status === 'closed' ? 'closed' : ''
                return (
                  <button key={q.id} className={`quiz-chip ${state}`} onClick={() => setSelected(q.id)}>
                    <b>{i + 1}</b>
                    <small>{result ? (result.score > 0 ? `+${result.score}` : '오답') : q.status === 'closed' ? '마감' : `${q.points}점`}</small>
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

function QuizCard({ code, teamId, quiz, result, refresh, onNext }) {
  const [text, setText] = useState('')
  const [hint, setHint] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState(null) // 서버 채점 결과
  const done = Boolean(result) || quiz.status === 'closed'
  const isChoice = quiz.kind === 'bible' && Array.isArray(quiz.choices)

  async function send(value) {
    setBusy(true)
    setMessage('')
    try {
      const res = await rpc('evm_quiz_answer', { p_code: code, p_team: teamId, p_id: quiz.id, p_text: value, p_hint: hint })
      setReply(res)
      if (res.ok || isChoice) refresh()
      else setMessage('정답이 아닙니다. 다시 생각합니다.')
    } catch (err) {
      setMessage(errorText(err))
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const correctIndex = reply?.answer ?? quiz.answer

  return (
    <div className="card">
      <p className="hint">
        {quiz.points}점
        {quiz.kind === 'chosung' && quiz.hint && !done && ` · 힌트를 보면 ${Math.ceil(quiz.points / 2)}점`}
      </p>
      <p className={quiz.kind === 'chosung' ? 'big' : 'question'}>{quiz.body}</p>
      {quiz.kind === 'chosung' && quiz.hint && (hint || done) && <p className="hint">힌트: {quiz.hint}</p>}

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
          {quiz.kind === 'chosung' && quiz.hint && !hint && (
            <button className="ghost" onClick={() => setHint(true)}>힌트 보기</button>
          )}
          <form className="login answer-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(text) }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="정답" aria-label="정답" autoComplete="off" />
            <button className="primary" disabled={busy}>제출</button>
          </form>
          <p className="hint">띄어쓰기는 상관없습니다. 맞힐 때까지 다시 낼 수 있습니다.</p>
        </>
      )}

      {message && <p className="error">{message}</p>}
      {result && (
        <p className="answer">{result.score > 0 ? `정답입니다. +${result.score}점` : '오답입니다. 이 문제는 한 번만 답할 수 있습니다.'}</p>
      )}
      {result && onNext && <button className="primary" onClick={onNext}>다음 문제 풀기</button>}
      {result && !onNext && <p className="hint">이 종류의 문제를 모두 풀었습니다.</p>}
      {!result && quiz.status === 'closed' && <p className="hint">마감된 문제입니다.</p>}
      {quiz.status === 'closed' && quiz.answer != null && !isChoice && <p className="hint">정답: {quiz.answer}</p>}
    </div>
  )
}
