import { useEffect, useRef, useState } from 'react'
import { QUIZ_KINDS, TEAMS } from './data.js'
import { rpc, compressPhoto } from './store.js'

// 전체 대결 퀴즈. 문제는 본부가 출제하고 서버가 채점한다.
// 몸으로 말해요만 팀이 사진과 정답을 내고, 본부가 승인하면 다른 팀에게 출제된다.

const ERRORS = {
  EVM_QUIZ_CLOSED: '마감된 문제입니다.',
  EVM_QUIZ_DONE: '이미 답한 문제입니다.',
  EVM_OWN_QUIZ: '우리 팀이 낸 문제는 풀 수 없습니다.',
  EVM_ACT_EXISTS: '우리 팀은 이미 문제를 냈습니다.',
}

function errorText(err) {
  const key = Object.keys(ERRORS).find((k) => String(err.message).includes(k))
  return key ? ERRORS[key] : '보내지 못했습니다. 통신 상태를 확인합니다.'
}

const resultOf = (data, teamId, quizId) => data.scores.find((s) => s.team_id === teamId && s.game_id === `quiz:${quizId}`)

// 팀에게 보이는 문제 목록(승인 대기와 우리 팀이 낸 문제는 제외)
const listOf = (data, teamId, kind) =>
  data.quizzes.filter((q) => q.kind === kind && q.status !== 'pending' && q.author_team !== teamId)

export default function Games({ code, teamId, data, refresh }) {
  const [selected, setSelected] = useState(null) // 문제 id
  const [authoring, setAuthoring] = useState(false)

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

  if (authoring) {
    return (
      <section className="game">
        <button className="back" onClick={() => setAuthoring(false)}>← 문제 목록</button>
        <h2>🙆 몸으로 말해요 출제</h2>
        <ActAuthor code={code} teamId={teamId} onDone={() => { setAuthoring(false); refresh() }} />
      </section>
    )
  }

  const mine = data.quizzes.find((q) => q.kind === 'act' && q.author_team === teamId)

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
            {kind.id === 'act' && <ActStatus data={data} mine={mine} onAuthor={() => setAuthoring(true)} />}
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

function QuizPhoto({ code, quizId }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let alive = true
    rpc('evm_quiz_photo', { p_code: code, p_id: quizId }).then((photo) => alive && setSrc(photo)).catch(() => {})
    return () => {
      alive = false
    }
  }, [code, quizId])
  if (!src) return <div className="photo-wait">사진을 불러오는 중입니다</div>
  return <img className="sheet-photo" src={src} alt="몸으로 표현한 사진" />
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

  const author = TEAMS.find((t) => t.id === quiz.author_team)
  const correctIndex = reply?.answer ?? quiz.answer

  return (
    <div className="card">
      <p className="hint">
        {quiz.points}점{author && ` · ${author.name} 출제`}
        {quiz.kind === 'chosung' && quiz.hint && !done && ` · 힌트를 보면 ${Math.ceil(quiz.points / 2)}점`}
      </p>
      {quiz.kind === 'act' && <QuizPhoto code={code} quizId={quiz.id} />}
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

function ActStatus({ data, mine, onAuthor }) {
  if (!mine) {
    return (
      <button className="game-card contest" onClick={onAuthor}>
        <span className="game-icon">📸</span>
        <span>
          <b>우리 팀 문제 내기</b>
          <small>몸으로 표현한 사진과 정답을 본부에 보냅니다. 다른 팀이 맞힐 때마다 우리 팀도 점수를 받습니다.</small>
        </span>
      </button>
    )
  }
  const bonus = data.scores.filter((s) => s.game_id.startsWith(`qa:${mine.id}:`))
  const label = { pending: '본부 승인을 기다리는 중입니다.', draft: '본부가 보관 중입니다.', open: '출제되었습니다.', closed: '마감되었습니다.' }[mine.status]
  return (
    <p className="act-status">
      우리 팀 문제: {label}
      {mine.status !== 'pending' && ` 맞힌 팀 ${bonus.length}팀 · 출제 점수 +${bonus.reduce((sum, s) => sum + s.score, 0)}점`}
    </p>
  )
}

function ActAuthor({ code, teamId, onDone }) {
  const [photo, setPhoto] = useState(null)
  const [answer, setAnswer] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const albumRef = useRef(null)

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setPhoto(await compressPhoto(file))
    } catch (err) {
      setMessage(err.message)
    }
  }

  async function submit() {
    if (!photo || !answer.trim()) {
      setMessage('사진과 정답을 모두 넣습니다.')
      return
    }
    setBusy(true)
    try {
      await rpc('evm_act_submit', { p_code: code, p_team: teamId, p_photo: photo, p_answer: answer.trim() })
      onDone()
    } catch (err) {
      setMessage(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <p className="hint">
        제시어를 정하고 팀이 몸으로 표현한 모습을 찍습니다. 본부가 승인하면 다른 팀에게 출제됩니다. 다른 팀이 맞힐 때마다 우리 팀도 점수를 받으므로,
        알아볼 수 있게 표현합니다. 팀당 한 문제만 낼 수 있습니다.
      </p>
      {photo && <img className="sheet-photo" src={photo} alt="찍은 사진" />}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={albumRef} type="file" accept="image/*" hidden onChange={onFile} />
      <div className="row">
        <button className="ghost" onClick={() => fileRef.current.click()}>{photo ? '다시 찍기' : '사진 찍기'}</button>
        <button className="ghost" onClick={() => albumRef.current.click()}>앨범에서 고르기</button>
      </div>
      <div className="login answer-form">
        <input value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={40} placeholder="정답(낱말 하나)" aria-label="정답" autoComplete="off" />
      </div>
      {message && <p className="error">{message}</p>}
      <button className="primary" disabled={busy} onClick={submit}>{busy ? '보내는 중입니다' : '본부에 보내기'}</button>
    </div>
  )
}
