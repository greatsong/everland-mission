import { MISSIONS, VERSES, TEAMS, SCORE } from './data.js'

const SIZE = 4

// 팀 번호를 씨앗으로 사용해 팀마다 다른 배열을 만들되, 같은 팀은 항상 같은 배열을 받는다.
function seededShuffle(items, seed) {
  const arr = [...items]
  let s = seed * 9301 + 49297
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280
    const j = Math.floor((s / 233280) * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function boardFor(teamId) {
  return seededShuffle(MISSIONS, teamId)
}

// 완성된 줄 목록. 줄마다 칸 번호(0~15) 네 개를 돌려준다.
export function completedLines(board, done) {
  const hit = board.map((m) => Boolean(done[m.id]))
  const idx = [...Array(SIZE).keys()]
  const all = [
    ...idx.map((r) => idx.map((c) => r * SIZE + c)),
    ...idx.map((c) => idx.map((r) => r * SIZE + c)),
    idx.map((i) => i * SIZE + i),
    idx.map((i) => i * SIZE + (SIZE - 1 - i)),
  ]
  return all.filter((line) => line.every((i) => hit[i]))
}

export function countLines(board, done) {
  return completedLines(board, done).length
}

export function scoreOf(board, done) {
  const count = board.filter((m) => done[m.id]).length
  const lines = countLines(board, done)
  return { count, lines, score: count * SCORE.perMission + lines * SCORE.perLine }
}

// 말씀을 어절로 나누어 팀에 차례로 배분한다. 팀이 미션을 완료한 비율만큼 그 팀의 조각이 열린다.
// counts: { [teamId]: 완료한 미션 수 }
export function versePieces(counts, teams = TEAMS) {
  const words = VERSES.flatMap((verse, part) => verse.text.split(' ').map((text) => ({ text, part }))).map((w, i) => ({
    ...w,
    teamId: teams[i % teams.length].id,
    open: false,
  }))
  for (const team of teams) {
    const mine = words.filter((w) => w.teamId === team.id)
    const openCount = Math.floor(((counts[team.id] || 0) / MISSIONS.length) * mine.length)
    mine.slice(0, openCount).forEach((w) => (w.open = true))
  }
  return words
}

// 서버 제출 목록에서 팀별 완료 표시를 만든다. { [teamId]: { [missionId]: true } }
export function doneByTeam(submissions) {
  const map = Object.fromEntries(TEAMS.map((t) => [t.id, {}]))
  for (const s of submissions) if (map[s.team_id]) map[s.team_id][s.mission_id] = true
  return map
}

// 미션 표시 정보. 본부 지령(order:번호)은 지령 목록에서 찾는다.
export function missionInfo(missionId, orders = []) {
  if (missionId.startsWith('order:')) {
    const order = orders.find((o) => `order:${o.id}` === missionId)
    return { icon: '📢', title: order ? order.body : '본부 지령' }
  }
  return MISSIONS.find((m) => m.id === missionId) || { icon: '📷', title: '미션 사진' }
}

// 타임어택 점수: 먼저 완료한 순서대로 30·20·10점, 그 뒤는 5점. 순위가 없으면(미완료) 0점.
export const RUSH_POINTS = [30, 20, 10]
export const rushPoints = (rank) => (rank ? RUSH_POINTS[rank - 1] || 5 : 0)

// 타임어택 사진 지령에서 팀의 제출 순위(1부터). 처음 올린 시각 기준이며(다시 올려도 순위는 그대로) 미제출이면 0.
export function rushRank(data, orderId, teamId) {
  const subs = (data?.submissions || [])
    .filter((s) => s.mission_id === `order:${orderId}`)
    .sort((a, b) => new Date(a.first_at || a.at) - new Date(b.first_at || b.at))
  return subs.findIndex((s) => s.team_id === teamId) + 1
}

// 팀 하나의 점수 내역. data는 서버 상태, done은 그 팀의 완료 표시({ [missionId]: 참 })이다.
export function teamScore(teamId, data, done) {
  const bingo = scoreOf(boardFor(teamId), done)
  let order = 0
  let quiz = 0
  for (const o of data?.orders || []) {
    if (o.kind !== 'photo') continue
    if (o.rush) order += rushPoints(rushRank(data, o.id, teamId))
    else if (done[`order:${o.id}`]) order += o.points
  }
  for (const s of data?.scores || []) {
    if (s.team_id !== teamId) continue
    if (s.game_id.startsWith('order:')) order += s.score
    else quiz += s.score
  }
  return { ...bingo, order, quiz, score: bingo.score + order + quiz }
}

export function ranking(data, teams = TEAMS) {
  const map = doneByTeam(data.submissions)
  return teams
    .map((team) => ({ team, ...teamScore(team.id, data, map[team.id]) }))
    .sort((a, b) => b.score - a.score || a.team.id - b.team.id)
}

export function minutesAgo(iso, nowIso) {
  return Math.max(0, Math.round((new Date(nowIso) - new Date(iso)) / 60000))
}
