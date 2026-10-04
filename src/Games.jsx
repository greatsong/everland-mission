import { useState } from 'react'
import { CHOSUNG_WORDS, ACT_WORDS, BIBLE_QUIZ, TELEPATHY } from './data.js'
import { toChosung, pickRandom } from './logic.js'

const GAME_LIST = [
  { id: 'chosung', icon: '🔤', title: '초성 퀴즈', desc: '초성만 보고 낱말을 맞힙니다.' },
  { id: 'act', icon: '🙆', title: '몸으로 말해요', desc: '한 명이 제시어를 몸으로 표현합니다.' },
  { id: 'bible', icon: '✝️', title: '성경 퀴즈', desc: '넷 중 하나를 고릅니다.' },
  { id: 'telepathy', icon: '🫶', title: '이구동성', desc: '하나, 둘, 셋에 동시에 답합니다.' },
]

export default function Games() {
  const [game, setGame] = useState(null)
  if (!game) {
    return (
      <>
        <p className="guide">줄을 서서 기다리는 동안 진행합니다. 주변에 방해되지 않게 작은 목소리로 합니다.</p>
        <div className="game-list">
          {GAME_LIST.map((g) => (
            <button key={g.id} className="game-card" onClick={() => setGame(g.id)}>
              <span className="game-icon">{g.icon}</span>
              <span>
                <b>{g.title}</b>
                <small>{g.desc}</small>
              </span>
            </button>
          ))}
        </div>
      </>
    )
  }
  const info = GAME_LIST.find((g) => g.id === game)
  return (
    <section className="game">
      <button className="back" onClick={() => setGame(null)}>← 게임 목록</button>
      <h2>{info.icon} {info.title}</h2>
      {game === 'chosung' && <ChosungGame />}
      {game === 'act' && <ActGame />}
      {game === 'bible' && <BibleGame />}
      {game === 'telepathy' && <TelepathyGame />}
    </section>
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
