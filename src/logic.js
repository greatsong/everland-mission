import { MISSIONS, VERSES, TEAMS, SCORE } from './data.js'

const SIZE = 4

// 빙고판. 모든 팀이 같은 배치(data.js의 MISSIONS 순서)를 사용한다.
export function boardFor() {
  return MISSIONS
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
  const bingo = scoreOf(boardFor(), done)
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

// "12분 전", "5시간 54분 전"처럼 읽기 쉬운 경과 시간
export function agoText(iso, nowIso) {
  const m = minutesAgo(iso, nowIso)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분 전` : `${m / 60}시간 전`
}

// 두 좌표 사이 거리(미터)
export function distanceM(a, b) {
  const rad = Math.PI / 180
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.round(Math.sqrt(x * x + y * y) * 6371000)
}

// 담당 선생님 이름 목록. 팀 소개에 적은 글("김○○, 이○○ 선생님")을 이름별로 나눈다.
export function teacherNames(text) {
  return String(text || '')
    .split(/[,，·・/、]/)
    .map((s) => s.trim().replace(/\s*선생님$/, '').trim())
    .filter(Boolean)
}

// 같은 팀의 휴대폰이 이보다 멀리 떨어지면 지도에 A조, B조로 나누어 표시한다(미터).
export const SPLIT_M = 20
// 같은 팀의 가장 최근 위치보다 이만큼 오래된 휴대폰 위치는 지도에서 뺀다(분).
// 위치 공유를 켠 채 앱을 닫은 휴대폰이 옛 위치에 계속 남지 않게 한다.
const DROP_MIN = 60
const LIVE_GAP_S = 240 // 두 휴대폰이 모두 위치를 보내는 중이라고 보는 기록 시각 차이(초)
const SAME_TIME_S = 20 // 같은 때 기록했다고 보는 시각 차이(초). 전송 시각을 1분 단위로 맞추므로 대개 이 안에 든다

// 두 휴대폰이 떨어져 있는지 판단한다. 기준은 20m이고, 휴대폰이 알려 준 오차의 합이 더 크면 그 값을 사용한다.
// 두 휴대폰이 모두 위치를 보내는 중이면 기록 시각 차이 동안 함께 걸었을 수 있는 거리(초속 1m)를 기준에 더한다.
export function apart(a, b) {
  const gap = Math.abs(new Date(a.at) - new Date(b.at)) / 1000
  const walk = gap <= LIVE_GAP_S ? Math.max(0, gap - SAME_TIME_S) : 0
  return distanceM(a, b) > Math.max(SPLIT_M, (a.acc || 0) + (b.acc || 0)) + walk
}

// 팀별 위치 무리. 같은 팀의 휴대폰이 서로 떨어져 있으면 무리를 나누고 1팀 A조, 1팀 B조처럼 이름을 붙인다(조별 활동).
// locations: [{ team_id, device, holder, lat, lng, acc, at }], teams: 팀 목록(본부는 id 0)
// teachers: { [teamId]: 담당 선생님 이름 목록 }. A·B 순서는 이 목록의 순서를 따른다.
// 돌려주는 값: [{ key, team, name, split, holders, loc(무리의 가장 최근 위치), rows }]
export function locationGroups(locations, teams, teachers = {}) {
  const groups = []
  for (const team of teams) {
    let rows = locations
      .filter((l) => l.team_id === team.id)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
    if (!rows.length) continue
    const newest = new Date(rows[0].at)
    rows = rows.filter((r) => newest - new Date(r.at) <= DROP_MIN * 60000)
    // 본부는 가장 최근 위치 하나만 표시한다.
    if (team.id === 0) rows = rows.slice(0, 1)

    // 서로 떨어지지 않은 휴대폰끼리 묶는다. 한 휴대폰이라도 가까우면 같은 무리다.
    let clusters = []
    for (const row of rows) {
      const near = clusters.filter((c) => c.some((o) => !apart(o, row)))
      clusters = [...clusters.filter((c) => !near.includes(c)), [...near.flat(), row]]
    }

    const names = teachers[team.id] || []
    const rank = (row) => {
      const i = names.indexOf(row.holder)
      return i < 0 ? names.length : i
    }
    const split = clusters.length > 1
    clusters = clusters
      .map((c) => [...c].sort((a, b) => rank(a) - rank(b) || String(a.device).localeCompare(String(b.device))))
      .sort((a, b) => rank(a[0]) - rank(b[0]) || String(a[0].device).localeCompare(String(b[0].device)))
    clusters.forEach((cluster, i) => {
      const letter = split ? String.fromCharCode(65 + i) : ''
      const loc = cluster.reduce((a, r) => (new Date(r.at) > new Date(a.at) ? r : a))
      groups.push({
        key: `${team.id}${letter}`,
        team,
        name: split ? `${team.name} ${letter}조` : team.name,
        letter,
        split,
        holders: [...new Set(cluster.map((r) => r.holder).filter(Boolean))],
        loc,
        rows: cluster,
      })
    })
  }
  return groups
}
