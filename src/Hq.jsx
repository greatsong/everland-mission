import { useMemo, useState } from 'react'
import { TEAMS, MISSIONS } from './data.js'
import { rpc } from './store.js'
import { doneByTeam } from './logic.js'
import { useRemote, Photo, VerseView, Ranking, teamsOf } from './shared.jsx'

// 본부 화면. 본부 코드로 입장한 사람만 사용한다.
export default function Hq({ session, onLogout }) {
  const { code, role } = session
  const { data, online, refresh } = useRemote(code, onLogout)
  const [body, setBody] = useState('')
  const [message, setMessage] = useState('')

  const counts = useMemo(() => {
    const map = doneByTeam(data?.submissions || [])
    return Object.fromEntries(TEAMS.map((t) => [t.id, Object.keys(map[t.id]).length]))
  }, [data])

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
    } catch (err) {
      setMessage(`실패했습니다: ${err.message}`)
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
            <h2 className="section">팀 현황</h2>
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
            <h2 className="section">전체 알림(돌발 미션)</h2>
            <p className="guide">
              현재 알림: {data.notice?.body ? data.notice.body : '없음'}
            </p>
            <form className="login" onSubmit={sendNotice}>
              <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={200} placeholder="예: 12시 30분까지 점심 감사 기도 사진을 올립니다" aria-label="알림 내용" />
              <button className="primary">보내기</button>
            </form>
            {data.notice?.body && (
              <button className="link" onClick={() => run('evm_notice', { p_body: '' }, '알림을 내렸습니다.')}>현재 알림 내리기</button>
            )}
          </section>

          <section>
            <h2 className="section">말씀 조각</h2>
            <VerseView counts={counts} teams={teamsOf(data)} />
          </section>

          <section>
            <h2 className="section">올라온 사진 {data.submissions.length}장</h2>
            <div className="hq-photos">
              {data.submissions.map((sub) => {
                const team = TEAMS.find((t) => t.id === sub.team_id)
                const mission = MISSIONS.find((m) => m.id === sub.mission_id)
                return (
                  <figure key={`${sub.team_id}:${sub.mission_id}:${sub.at}`}>
                    <Photo code={code} sub={sub} alt={mission?.title || '미션 사진'} />
                    <figcaption>
                      <span><b style={{ color: team?.color }}>{team?.name}</b> {mission?.title}</span>
                      <button
                        className="link"
                        onClick={() =>
                          confirm('이 사진을 지웁니까? 해당 팀의 빙고 칸도 비워집니다.') &&
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
