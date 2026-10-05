import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { SCORE, QUIZ_KINDS } from './data.js'
import { teamsOf } from './shared.jsx'
import { minutesAgo, agoText, missionInfo, rushRank, rushPoints } from './logic.js'

const clock = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

// 에버랜드 중심 부근(판다월드 인근). 위치를 보낸 팀이 없을 때의 처음 화면이다.
const EVERLAND = [37.2925, 127.2035]
const HQ = { id: 0, name: '본부', color: '#1f2a24' }

// 가까이 모인 팀의 이름표를 벌려 놓는 자리(위치 점 기준, 픽셀). 첫 자리는 바로 위다.
const LABEL_SPOTS = [[0, -30], [-52, -14], [52, -14], [-52, 22], [52, 22], [0, 38], [0, -62]]
const NEAR_PX = 44

const FX_KEY = 'evm:v2:fx2'
const touchDevice = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

// 서버 상태에서 완료 기록을 시간 순서로 뽑는다. 지도 반짝임과 활동 기록에 함께 사용한다.
function activityOf(data) {
  const teams = [HQ, ...teamsOf(data)]
  const name = (id) => teams.find((t) => t.id === id)?.name || `${id}팀`
  const items = []
  for (const s of data.submissions) {
    const isOrder = s.mission_id.startsWith('order:')
    const order = isOrder ? data.orders.find((o) => `order:${o.id}` === s.mission_id) : null
    const points = !isOrder ? SCORE.perMission : order?.rush ? rushPoints(rushRank(data, order.id, s.team_id)) : order?.points || 0
    items.push({
      key: `${s.team_id}|${s.mission_id}|${s.first_at || s.at}`,
      teamId: s.team_id, team: name(s.team_id), at: s.first_at || s.at,
      icon: isOrder ? '📢' : '📸', points, text: missionInfo(s.mission_id, data.orders).title,
    })
  }
  for (const s of data.scores || []) {
    if (s.score <= 0 || s.game_id.startsWith('qa:')) continue
    const isOrder = s.game_id.startsWith('order:')
    const quiz = !isOrder ? data.quizzes.find((q) => `quiz:${q.id}` === s.game_id) : null
    const order = isOrder ? data.orders.find((o) => `order:${o.id}` === s.game_id) : null
    items.push({
      key: `${s.team_id}|${s.game_id}`,
      teamId: s.team_id, team: name(s.team_id), at: s.at || null,
      icon: isOrder ? '📢' : '🎲', points: s.score,
      text: isOrder ? order?.body || '본부 지령' : QUIZ_KINDS.find((k) => k.id === quiz?.kind)?.title || '퀴즈',
    })
  }
  return items
}

// 여러 팀의 마지막 위치를 한 화면에 표시한다. 지도 자료는 오픈스트리트맵이다.
// tracks: 이동 경로 점 목록(시간 순서), until: 이 시각(ms)까지의 경로와 위치만 표시. 둘 다 없으면 마지막 위치만 표시한다.
export default function TeamMap({ data, here, myTeamId, tracks, until }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const fittedRef = useRef(false)
  const seenRef = useRef(null) // 직전에 받은 완료 기록. 새로 생긴 것을 찾는 데 사용한다
  const burstRef = useRef({}) // { [teamId]: { until, label } } 반짝임을 보여 줄 팀
  const drawRef = useRef(() => {})
  const [recent, setRecent] = useState('')
  const [note, setNote] = useState('')
  // 새 효과 시험판: 완료 종류와 점수 표시, 활동 기록, 상태 범례
  const [fx2, setFx2] = useState(() => {
    try {
      return localStorage.getItem(FX_KEY) === 'on'
    } catch {
      return false
    }
  })

  useEffect(() => {
    // 손가락 한 개로는 페이지가 스크롤되고, 지도는 두 손가락으로 움직인다(터치 기기).
    const map = L.map(boxRef.current, { zoomControl: true, attributionControl: true, dragging: !touchDevice }).setView(EVERLAND, 16)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    fittedRef.current = false // 지도를 새로 만들면 처음 맞추기도 다시 한다
    // 확대·축소하면 겹침이 달라지므로 이름표 자리를 다시 잡는다.
    const redraw = () => drawRef.current()
    map.on('zoomend', redraw)
    return () => {
      map.off('zoomend', redraw)
      map.remove()
    }
  }, [])

  useEffect(() => {
    if (!recent) return
    const timer = setTimeout(() => setRecent(''), 12000)
    return () => clearTimeout(timer)
  }, [recent])

  // 팀 표시를 그린다. 서버 상태가 바뀌거나 지도를 확대·축소할 때 불린다.
  drawRef.current = () => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()

    // 1) 표시할 팀과 위치를 정한다.
    const pins = []
    for (const team of [HQ, ...teamsOf(data)]) {
      let loc = data.locations.find((l) => l.team_id === team.id)
      // 우리 팀은 방금 잰 위치가 있으면 그것을 사용한다.
      if (team.id === myTeamId && here) loc = { ...here, at: data.now }
      let past = null
      if (tracks) {
        const path = tracks.filter((p) => p.team_id === team.id && (!until || new Date(p.at).getTime() <= until))
        if (path.length > 1) L.polyline(path.map((p) => [p.lat, p.lng]), { color: team.color, weight: 4, opacity: 0.75 }).addTo(layer)
        // 지나온 지점마다 시각을 볼 수 있는 작은 점을 찍는다.
        for (const p of path) {
          L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 1, fillColor: team.color, fillOpacity: 1 })
            .bindPopup(`${team.name} · ${clock(p.at)}`)
            .addTo(layer)
        }
        if (until) {
          const last = path[path.length - 1]
          loc = last ? { lat: last.lat, lng: last.lng, at: last.at } : null
          past = last ? clock(last.at) : null
        }
      }
      if (loc) pins.push({ team, loc, past, px: map.latLngToContainerPoint([loc.lat, loc.lng]) })
    }

    // 2) 가까이 모인 팀끼리 묶어 이름표 자리를 나눈다.
    const groups = []
    for (const pin of pins) {
      const group = groups.find((g) => g.some((o) => o.px.distanceTo(pin.px) < NEAR_PX))
      if (group) group.push(pin)
      else groups.push([pin])
    }

    // 3) 그린다. 위치에는 작은 점을 찍고, 이름표는 그 주변에 띄운다.
    for (const group of groups) {
      group.forEach((pin, i) => {
        const { team, loc, past } = pin
        const minutes = minutesAgo(loc.at, data.now)
        const live = !past && minutes <= 2
        const stale = !past && minutes > 10
        const burst = !past && burstRef.current[team.id]?.until > Date.now() ? burstRef.current[team.id] : null
        const [dx, dy] = LABEL_SPOTS[i % LABEL_SPOTS.length]
        // 모인 팀은 위치 점도 조금씩 벌려 색이 모두 보이게 한다.
        const spread = group.length > 1 ? 7 : 0
        const angle = (i / group.length) * Math.PI * 2
        const ox = Math.round(Math.cos(angle) * spread)
        const oy = Math.round(Math.sin(angle) * spread)

        if (loc.acc && !past) {
          // 오차 범위: 실제 위치는 이 원 안 어딘가다.
          L.circle([loc.lat, loc.lng], { radius: Math.min(loc.acc, 150), color: team.color, weight: 1, opacity: 0.35, fillColor: team.color, fillOpacity: 0.08, interactive: false }).addTo(layer)
        }
        const cls = `map-pin${stale ? ' stale' : ''}${live ? ' live' : ''}${burst ? ' burst' : ''}`
        const html =
          `<div class="pin-wrap" style="--pin:${team.color}">` +
          `<i class="pin-dot${live ? ' live' : ''}${stale ? ' stale' : ''}" style="transform:translate(${ox}px,${oy}px)"></i>` +
          `<span class="${cls}" style="background:${team.color};transform:translate(calc(-50% + ${dx + ox}px), calc(-50% + ${dy + oy}px))">` +
          `${team.name}<small>${clock(loc.at)}</small>${burst ? `<i class="map-star">${burst.label}</i>` : ''}</span></div>`
        L.marker([loc.lat, loc.lng], { icon: L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] }), zIndexOffset: burst ? 1000 : live ? 500 : 0 })
          .bindPopup(past ? `${team.name} · ${past} 기록` : `${team.name} · ${clock(loc.at)} 기록(${agoText(loc.at, data.now)})${loc.acc ? ` · 오차 약 ${Math.round(loc.acc)}m` : ''}`)
          .addTo(layer)
      })
    }

    // 처음 위치가 들어왔을 때 한 번만 모든 팀이 보이게 맞춘다. 그 뒤에는 사용자가 움직인 화면을 유지한다.
    if (pins.length && !fittedRef.current) {
      fittedRef.current = true
      map.fitBounds(pins.map((p) => [p.loc.lat, p.loc.lng]), { padding: [50, 50], maxZoom: 17 })
    }
  }

  useEffect(() => {
    // 미션·지령·퀴즈를 방금 완료한 팀을 찾는다. 화면을 처음 열 때는 건너뛴다.
    const items = activityOf(data)
    const keys = new Set(items.map((i) => i.key))
    if (seenRef.current && !until) {
      const fresh = items.filter((i) => !seenRef.current.has(i.key))
      for (const f of fresh) {
        burstRef.current[f.teamId] = { until: Date.now() + 4000, label: fx2 ? `${f.icon} +${f.points}` : '⭐' }
      }
      if (fresh.length && !fx2) setRecent(`⭐ 방금 ${[...new Set(fresh.map((f) => f.team))].join(', ')}이 미션을 완료했습니다`)
    }
    seenRef.current = keys
    drawRef.current()
  }, [data, here, myTeamId, tracks, until, fx2])

  // 표시된 팀이 모두 보이게 화면을 맞춘다.
  function fitAll() {
    const points = []
    layerRef.current?.eachLayer((m) => {
      if (m instanceof L.Marker) points.push(m.getLatLng())
    })
    if (!points.length) {
      setNote('아직 위치를 보낸 팀이 없습니다. 에버랜드 전체를 표시합니다.')
      mapRef.current.setView(EVERLAND, 16)
      return
    }
    setNote(points.length === 1 ? '위치를 보낸 팀이 하나입니다. 그 팀을 가운데에 표시합니다.' : '')
    // 화면 크기가 바뀐 뒤에도 정확히 맞도록 지도 크기를 다시 잰다.
    mapRef.current.invalidateSize()
    if (points.length === 1) mapRef.current.setView(points[0], 17)
    else mapRef.current.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 18 })
  }

  function toggleFx(on) {
    try {
      localStorage.setItem(FX_KEY, on ? 'on' : 'off')
    } catch {
      /* 저장이 막혀도 이번 화면에서는 동작한다 */
    }
    setFx2(on)
  }

  // 서버에 쓰지 않고 반짝임만 보여 준다(효과 확인용).
  function preview() {
    const shown = [HQ, ...teamsOf(data)].filter((t) => t.id !== 0 && (data.locations.some((l) => l.team_id === t.id) || (t.id === myTeamId && here)))
    if (!shown.length) {
      setNote('위치를 보낸 팀이 있어야 미리 볼 수 있습니다.')
      return
    }
    const team = shown[Math.floor(Math.random() * shown.length)]
    const samples = fx2 ? ['📸 +10', '📢 +20', '🎲 +10'] : ['⭐']
    burstRef.current[team.id] = { until: Date.now() + 4000, label: samples[Math.floor(Math.random() * samples.length)] }
    if (!fx2) setRecent(`⭐ 방금 ${team.name}이 미션을 완료했습니다 (미리보기)`)
    drawRef.current()
  }

  const feed = fx2
    ? activityOf(data).filter((i) => i.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 6)
    : []

  return (
    <div className={`team-map ${fx2 ? 'fx2' : ''}`}>
      <div ref={boxRef} className="team-map-box" />
      <p className="map-tools">
        <button className="link" onClick={fitAll}>모든 팀이 보이게 맞추기</button>
        {touchDevice && <span className="net">두 손가락으로 지도를 움직입니다.</span>}
        {note && <span className="net">{note}</span>}
      </p>
      {fx2 && (
        <p className="map-legend">
          <span><i className="pin-dot live" /> 2분 안 갱신</span>
          <span><i className="pin-dot" /> 10분 안</span>
          <span><i className="pin-dot stale" /> 10분 넘음</span>
          <span>옅은 원은 오차 범위</span>
        </p>
      )}
      {recent && <p className="map-recent" role="status">{recent}</p>}
      {fx2 && (
        <div className="map-feed">
          <p className="preview-label">최근 활동</p>
          {!feed.length && <p className="guide">아직 완료한 미션이 없습니다.</p>}
          {feed.map((f) => (
            <p key={f.key} className="feed-row">
              <time>{clock(f.at)}</time>
              <b>{f.team}</b>
              <span>{f.icon} {f.text}</span>
              <em>+{f.points}</em>
            </p>
          ))}
        </div>
      )}
      <p className="map-tools fx-tools">
        <label>
          <input type="checkbox" checked={fx2} onChange={(e) => toggleFx(e.target.checked)} /> 🧪 새 효과 시험
        </label>
        <button className="link" onClick={preview}>효과 미리보기</button>
      </p>
    </div>
  )
}
