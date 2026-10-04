import { MISSIONS, VERSE, TEAMS, SCORE } from './data.js'

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

export function countLines(board, done) {
  const hit = board.map((m) => Boolean(done[m.id]))
  const at = (r, c) => hit[r * SIZE + c]
  const idx = [...Array(SIZE).keys()]
  let lines = 0
  for (const r of idx) if (idx.every((c) => at(r, c))) lines++
  for (const c of idx) if (idx.every((r) => at(r, c))) lines++
  if (idx.every((i) => at(i, i))) lines++
  if (idx.every((i) => at(i, SIZE - 1 - i))) lines++
  return lines
}

export function scoreOf(board, done) {
  const count = board.filter((m) => done[m.id]).length
  const lines = countLines(board, done)
  return { count, lines, score: count * SCORE.perMission + lines * SCORE.perLine }
}

// 말씀을 어절로 나누어 팀에 차례로 배분한다. 팀이 미션을 완료한 비율만큼 그 팀의 조각이 열린다.
// counts: { [teamId]: 완료한 미션 수 }
export function versePieces(counts) {
  const words = VERSE.text.split(' ').map((text, i) => ({ text, teamId: TEAMS[i % TEAMS.length].id, open: false }))
  for (const team of TEAMS) {
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

export function ranking(submissions) {
  const map = doneByTeam(submissions)
  return TEAMS.map((team) => ({ team, ...scoreOf(boardFor(team.id), map[team.id]) })).sort(
    (a, b) => b.score - a.score || a.team.id - b.team.id,
  )
}

export function minutesAgo(iso, nowIso) {
  return Math.max(0, Math.round((new Date(nowIso) - new Date(iso)) / 60000))
}

const CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'

export function toChosung(word) {
  return [...word]
    .map((ch) => {
      const code = ch.charCodeAt(0) - 0xac00
      if (code < 0 || code > 11171) return ch
      return CHOSUNG[Math.floor(code / 588)]
    })
    .join('')
}

export function pickRandom(items, except) {
  if (items.length < 2) return items[0]
  let next = except
  while (next === except) next = items[Math.floor(Math.random() * items.length)]
  return next
}
