import { useState } from 'react'
import {
  CHOSUNG_WORDS, ACT_WORDS, BIBLE_QUIZ, NONSENSE, TELEPATHY,
  BIBLE_CONTEST, CHOSUNG_CONTEST, SCORE, CONTEST_SIZE,
} from './data.js'
import { toChosung, pickRandom } from './logic.js'

// 우리끼리 하는 게임은 결과를 전송하지 않는다. 전체 대결은 팀당 한 번만 풀고 점수가 순위에 더해진다.
const FUN_GAMES = [
  { id: 'act', icon: '🙆', title: '몸으로 말해요', desc: '한 명이 제시어를 몸으로 표현합니다.' },
  { id: 'telepathy', icon: '🫶', title: '이구동성', desc: '하나, 둘, 셋에 동시에 답합니다.' },
  { id: 'nonsense', icon: '🤣', title: '넌센스 퀴즈', desc: '엉뚱한 답을 맞힙니다.' },
  { id: 'chosungFun', icon: '🔤', title: '초성 퀴즈', desc: '초성만 보고 낱말을 맞힙니다.' },
  { id: 'bibleFun', icon: '📖', title: '성경 퀴즈', desc: '넷 중 하나를 고릅니다.' },
]

const CONTEST_GAMES = [
  { id: 'bible', icon: '✝️', title: '성경 퀴즈 대결', desc: '넷 중 하나를 고릅니다.' },
  { id: 'chosung', icon: '🔤', title: '초성 퀴즈 대결', desc: '초성만 보고 낱말을 맞힙니다.' },
]

const ALL_GAMES = [...FUN_GAMES, ...CONTEST_GAMES]

export default function Games({ contest, onAnswer }) {
  const [game, setGame] = useState(null)

  if (!game) {
    return (
      <>
        <p className="guide">줄을 서서 기다리는 동안 진행합니다. 주변에 방해되지 않게 작은 목소리로 합니다.</p>

        <h2 className="section">우리끼리 하는 게임</h2>
        <p className="guide">점수와 상관없이 즐깁니다. 결과는 전송되지 않습니다.</p>
        <div className="game-list">
          {FUN_GAMES.map((g) => (
            <button key={g.id} className="game-card" onClick={() => setGame(g.id)}>
              <span className="game-icon">{g.icon}</span>
              <span>
                <b>{g.title}</b>
                <small>{g.desc}</small>
              </span>
            </button>
          ))}
        </div>

        <h2 className="section">전체 대결</h2>
        <p className="guide">
          모든 팀이 같은 문제 {CONTEST_SIZE}개를 풉니다. 팀당 한 번만 도전할 수 있고 점수는 순위에 더해집니다. 성경 퀴즈는 문제마다 {SCORE.bibleQuiz}점,
          초성 퀴즈는 힌트 없이 맞히면 {SCORE.chosungNoHint}점, 힌트를 보고 맞히면 {SCORE.chosungHint}점입니다.
        </p>
        <div className="game-list">
          {CONTEST_GAMES.map((g) => {
            const rec = contest[g.id]
            const finished = rec?.index >= CONTEST_SIZE
            return (
              <button key={g.id} className="game-card contest" onClick={() => setGame(g.id)}>
                <span className="game-icon">{g.icon}</span>
                <span>
                  <b>{g.title}</b>
                  <small>{g.desc}</small>
                </span>
                <span className="game-state">
                  {finished ? `${rec.points}점` : rec?.index ? `${rec.index}/${CONTEST_SIZE}` : '도전'}
                </span>
              </button>
            )
          })}
        </div>
      </>
    )
  }

  const info = ALL_GAMES.find((g) => g.id === game)
  const rec = contest[game] || { index: 0, correct: 0, points: 0 }
  return (
    <section className="game">
      <button className="back" onClick={() => setGame(null)}>← 게임 목록</button>
      <h2>{info.icon} {info.title}</h2>
      {game === 'act' && <ActGame />}
      {game === 'telepathy' && <TelepathyGame />}
      {game === 'nonsense' && <NonsenseGame />}
      {game === 'chosungFun' && <ChosungGame />}
      {game === 'bibleFun' && <BibleGame />}
      {game === 'bible' && <BibleContest rec={rec} onAnswer={(points) => onAnswer('bible', points)} />}
      {game === 'chosung' && <ChosungContest rec={rec} onAnswer={(points) => onAnswer('chosung', points)} />}
    </section>
  )
}

function ActGame() {
  const [word, setWord] = useState(() => pickRandom(ACT_WORDS))
  const [shown, setShown] = useState(false)
  return (
    <div className="card">
      <p className="hint">표현할 사람만 화면을 봅니다. 말은 하지 않습니다.</p>
      <p className="big">{shown ? word : '？'}</p>
      <div className="row">
        <button className="ghost" onClick={() => setShown(!shown)}>{shown ? '제시어 가리기' : '제시어 보기'}</button>
        <button className="primary" onClick={() => { setWord(pickRandom(ACT_WORDS, word)); setShown(false) }}>다음 제시어</button>
      </div>
    </div>
  )
}

function TelepathyGame() {
  const [pair, setPair] = useState(() => pickRandom(TELEPATHY))
  return (
    <div className="card">
      <p className="hint">하나, 둘, 셋에 모두 동시에 하나를 말합니다. 전원이 같으면 성공입니다.</p>
      <p className="versus"><span>{pair[0]}</span><i>vs</i><span>{pair[1]}</span></p>
      <button className="primary" onClick={() => setPair(pickRandom(TELEPATHY, pair))}>다음 질문</button>
    </div>
  )
}

function NonsenseGame() {
  const [item, setItem] = useState(() => pickRandom(NONSENSE))
  const [shown, setShown] = useState(false)
  return (
    <div className="card">
      <p className="question">{item.q}</p>
      {shown && <p className="big">{item.a}</p>}
      <div className="row">
        {!shown && <button className="ghost" onClick={() => setShown(true)}>정답 보기</button>}
        <button className="primary" onClick={() => { setItem(pickRandom(NONSENSE, item)); setShown(false) }}>다음 문제</button>
      </div>
    </div>
  )
}

function ChosungGame() {
  const [item, setItem] = useState(() => pickRandom(CHOSUNG_WORDS))
  const [step, setStep] = useState(0) // 0 문제, 1 힌트, 2 정답
  return (
    <div className="card">
      <p className="big">{toChosung(item.answer)}</p>
      {step >= 1 && <p className="hint">힌트: {item.hint}</p>}
      {step >= 2 && <p className="answer">정답: {item.answer}</p>}
      <div className="row">
        {step < 2 && <button className="ghost" onClick={() => setStep(step + 1)}>{step === 0 ? '힌트 보기' : '정답 보기'}</button>}
        <button className="primary" onClick={() => { setItem(pickRandom(CHOSUNG_WORDS, item)); setStep(0) }}>다음 문제</button>
      </div>
    </div>
  )
}

function BibleGame() {
  const [item, setItem] = useState(() => pickRandom(BIBLE_QUIZ))
  const [picked, setPicked] = useState(null)
  return (
    <div className="card">
      <p className="question">{item.q}</p>
      <div className="choices">
        {item.choices.map((c, i) => {
          const cls = picked === null ? '' : i === item.answer ? 'right' : i === picked ? 'wrong' : ''
          return (
            <button key={c} className={`choice ${cls}`} disabled={picked !== null} onClick={() => setPicked(i)}>
              {c}
            </button>
          )
        })}
      </div>
      {picked !== null && <p className="answer">{picked === item.answer ? '정답입니다.' : `정답은 ${item.choices[item.answer]}입니다.`}</p>}
      <button className="primary" onClick={() => { setItem(pickRandom(BIBLE_QUIZ, item)); setPicked(null) }}>다음 문제</button>
    </div>
  )
}

function ContestResult({ rec }) {
  return (
    <div className="card">
      <p className="big">{rec.points}점</p>
      {rec.correct !== null && <p className="question">{CONTEST_SIZE}문제 중 {rec.correct}문제를 맞혔습니다.</p>}
      <p className="hint">점수는 팀 순위에 더해집니다. 대결은 팀당 한 번만 도전할 수 있습니다.</p>
    </div>
  )
}

// 답을 고르는 즉시 기록한다. 화면을 나갔다 들어와도 같은 문제를 다시 풀 수 없다.
function BibleContest({ rec, onAnswer }) {
  const [answered, setAnswered] = useState(null) // { item, picked }
  const item = answered?.item || BIBLE_CONTEST[rec.index]

  if (!answered && rec.index >= CONTEST_SIZE) return <ContestResult rec={rec} />

  function pick(i) {
    setAnswered({ item, picked: i })
    onAnswer(i === item.answer ? SCORE.bibleQuiz : 0)
  }

  const number = answered ? rec.index : rec.index + 1
  return (
    <div className="card">
      <p className="hint">{number} / {CONTEST_SIZE}</p>
      <p className="question">{item.q}</p>
      <div className="choices">
        {item.choices.map((c, i) => {
          const cls = !answered ? '' : i === item.answer ? 'right' : i === answered.picked ? 'wrong' : ''
          return (
            <button key={c} className={`choice ${cls}`} disabled={Boolean(answered)} onClick={() => pick(i)}>
              {c}
            </button>
          )
        })}
      </div>
      {answered && (
        <>
          <p className="answer">
            {answered.picked === item.answer ? '정답입니다.' : `정답은 ${item.choices[item.answer]}입니다.`}
          </p>
          <button className="primary" onClick={() => setAnswered(null)}>
            {rec.index >= CONTEST_SIZE ? '결과 보기' : '다음 문제'}
          </button>
        </>
      )}
    </div>
  )
}

// 선생님이 정답 여부를 판정한다.
function ChosungContest({ rec, onAnswer }) {
  const [answered, setAnswered] = useState(null) // { item, ok }
  const [hint, setHint] = useState(false)
  const item = answered?.item || CHOSUNG_CONTEST[rec.index]

  if (!answered && rec.index >= CONTEST_SIZE) return <ContestResult rec={rec} />

  function judge(ok) {
    const points = !ok ? 0 : hint ? SCORE.chosungHint : SCORE.chosungNoHint
    setAnswered({ item, ok, points })
    onAnswer(points)
  }

  const number = answered ? rec.index : rec.index + 1
  return (
    <div className="card">
      <p className="hint">{number} / {CONTEST_SIZE} · 선생님이 정답을 확인합니다.</p>
      <p className="big">{toChosung(item.answer)}</p>
      {(hint || answered) && <p className="hint">힌트: {item.hint}</p>}
      {!answered && (
        <>
          {!hint && <button className="ghost" onClick={() => setHint(true)}>힌트 보기(맞히면 {SCORE.chosungHint}점)</button>}
          <div className="row">
            <button className="ghost" onClick={() => judge(false)}>넘어가기</button>
            <button className="primary" onClick={() => judge(true)}>맞혔습니다</button>
          </div>
        </>
      )}
      {answered && (
        <>
          <p className="answer">정답: {item.answer} · {answered.points}점</p>
          <button className="primary" onClick={() => { setAnswered(null); setHint(false) }}>
            {rec.index >= CONTEST_SIZE ? '결과 보기' : '다음 문제'}
          </button>
        </>
      )}
    </div>
  )
}
