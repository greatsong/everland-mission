import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { teamsOf } from './shared.jsx'
import { minutesAgo, agoText } from './logic.js'

const clock = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

// 에버랜드 중심 부근(판다월드 인근). 위치를 보낸 팀이 없을 때의 처음 화면이다.
const EVERLAND = [37.2925, 127.2035]

// 이름표가 겹친다고 보는 화면 거리(픽셀). 이보다 가까운 팀은 이름표 하나로 합친다.
const NEAR_PX = 40

// 여러 팀의 마지막 위치를 한 화면에 표시한다. 지도 자료는 오픈스트리트맵이다.
// tracks: 이동 경로 점 목록(시간 순서), until: 이 시각(ms)까지의 경로와 위치만 표시. 둘 다 없으면 마지막 위치만 표시한다.
export default function TeamMap({ data, here, myTeamId, tracks, until }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const fittedRef = useRef(false)
  const seenRef = useRef(null) // 직전에 받은 완료 기록(팀별 미션·지령·퀴즈). 새로 생긴 것을 찾는 데 사용한다
  const burstRef = useRef({}) // { [teamId]: 반짝임을 보여 줄 마감 시각(ms) }
  const [recent, setRecent] = useState('')
  const [zoomTick, setZoomTick] = useState(0) // 확대·축소하면 겹침이 달라지므로 다시 그린다

  useEffect(() => {
    const map = L.map(boxRef.current, { zoomControl: true, attributionControl: true }).setView(EVERLAND, 16)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    fittedRef.current = false // 지도를 새로 만들면 처음 맞추기도 다시 한다
    const onZoom = () => setZoomTick((n) => n + 1)
    map.on('zoomend', onZoom)
    return () => {
      map.off('zoomend', onZoom)
      map.remove()
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const points = []
    const pins = []

    // 미션·지령·퀴즈를 방금 완료한 팀을 찾는다. 화면을 처음 열 때는 건너뛴다.
    const keys = new Set([
      ...data.submissions.map((s) => `${s.team_id}|${s.mission_id}|${s.first_at || s.at}`),
      ...(data.scores || []).filter((s) => s.score > 0 && !s.game_id.startsWith('qa:')).map((s) => `${s.team_id}|${s.game_id}`),
    ])
    if (seenRef.current && !until) {
      const fresh = [...keys].filter((k) => !seenRef.current.has(k)).map((k) => Number(k.split('|')[0]))
      if (fresh.length) {
        const names = [...new Set(fresh)].map((id) => teamsOf(data).find((t) => t.id === id)?.name).filter(Boolean)
        for (const id of fresh) burstRef.current[id] = Date.now() + 4000
        if (names.length) setRecent(`⭐ 방금 ${names.join(', ')}이 미션을 완료했습니다`)
      }
    }
    seenRef.current = keys
    // 본부(팀 번호 0)를 먼저, 이어서 참가 팀을 표시한다.
    const HQ = { id: 0, name: '본부', color: '#1f2a24' }
    for (const team of [HQ, ...teamsOf(data)]) {
      let loc = data.locations.find((l) => l.team_id === team.id)
      // 우리 팀은 방금 잰 위치가 있으면 그것을 사용한다.
      if (team.id === myTeamId && here) loc = { ...here, at: data.now }
      let label = null
      if (tracks) {
        const path = tracks.filter((p) => p.team_id === team.id && (!until || new Date(p.at).getTime() <= until))
        if (path.length > 1) {
          L.polyline(path.map((p) => [p.lat, p.lng]), { color: team.color, weight: 4, opacity: 0.75 }).addTo(layer)
        }
        // 지나온 지점마다 시각을 볼 수 있는 작은 점을 찍는다.
        for (const p of path) {
          L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 1, fillColor: team.color, fillOpacity: 1 })
            .bindPopup(`${team.name} · ${clock(p.at)}`)
            .addTo(layer)
        }
        if (until) {
          const last = path[path.length - 1]
          loc = last ? { lat: last.lat, lng: last.lng, at: last.at } : null
          label = last ? clock(last.at) : null
        }
      }
      if (!loc) continue
      pins.push({ team, loc, label, px: map.latLngToContainerPoint([loc.lat, loc.lng]) })
      points.push([loc.lat, loc.lng])
    }

    // 이름표가 겹칠 만큼 가까운 팀끼리 묶는다(화면 거리 기준). 확대하면 다시 나뉜다.
    const groups = []
    for (const pin of pins) {
      const group = groups.find((g) => g.some((o) => o.px.distanceTo(pin.px) < NEAR_PX))
      if (group) group.push(pin)
      else groups.push([pin])
    }

    for (const group of groups) {
      const state = (pin) => {
        const minutes = minutesAgo(pin.loc.at, data.now)
        return {
          minutes,
          // live: 2분 안에 갱신된 위치(파동), burst: 방금 미션을 완료한 팀(반짝임)
          live: !pin.label && minutes <= 2,
          stale: !pin.label && minutes > 10,
          burst: !pin.label && burstRef.current[pin.team.id] > Date.now(),
        }
      }
      const line = (pin) =>
        pin.label
          ? `${pin.team.name} · ${pin.label} 기록`
          : `${pin.team.name} · ${clock(pin.loc.at)} 기록(${agoText(pin.loc.at, data.now)})${pin.loc.acc ? ` · 오차 약 ${Math.round(pin.loc.acc)}m` : ''}`

      if (group.length === 1) {
        const pin = group[0]
        const s = state(pin)
        const cls = `map-pin${s.stale ? ' stale' : ''}${s.live ? ' live' : ''}${s.burst ? ' burst' : ''}`
        // 팀 이름 아래에 그 위치가 기록된 시각을 적는다.
        const html = `<span class="${cls}" style="background:${pin.team.color};--pin:${pin.team.color}">${pin.team.name}<small>${clock(pin.loc.at)}</small>${s.burst ? '<i class="map-star">⭐</i>' : ''}</span>`
        L.marker([pin.loc.lat, pin.loc.lng], { icon: L.divIcon({ className: '', html, iconSize: [56, 40], iconAnchor: [28, 20] }) })
          .bindPopup(line(pin))
          .addTo(layer)
        continue
      }

      // 여러 팀이 모여 있으면 이름표 하나로 합친다. 예: "본부·1,2,6팀"
      const states = group.map(state)
      const numbers = group.filter((p) => p.team.id !== 0).map((p) => p.team.id).join(',')
      const name = [group.some((p) => p.team.id === 0) ? '본부' : '', numbers ? `${numbers}팀` : ''].filter(Boolean).join('·')
      const newest = group.reduce((a, p) => (new Date(p.loc.at) > new Date(a.loc.at) ? p : a))
      const dots = group.map((p) => `<i style="background:${p.team.color}"></i>`).join('')
      const cls = `map-pin group${states.every((s) => s.stale) ? ' stale' : ''}${states.some((s) => s.live) ? ' live' : ''}${states.some((s) => s.burst) ? ' burst' : ''}`
      const html = `<span class="${cls}" style="--pin:#343a40"><b class="group-dots">${dots}</b>${name}<small>최근 ${clock(newest.loc.at)}</small>${states.some((s) => s.burst) ? '<i class="map-star">⭐</i>' : ''}</span>`
      const lat = group.reduce((sum, p) => sum + p.loc.lat, 0) / group.length
      const lng = group.reduce((sum, p) => sum + p.loc.lng, 0) / group.length
      const width = 40 + name.length * 13
      L.marker([lat, lng], { icon: L.divIcon({ className: '', html, iconSize: [width, 52], iconAnchor: [width / 2, 26] }) })
        .bindPopup(`<b>함께 있는 팀</b><br>${group.map(line).join('<br>')}<br><small>지도를 확대하면 팀별로 나뉩니다.</small>`)
        .addTo(layer)
    }
    // 처음 위치가 들어왔을 때 한 번만 모든 팀이 보이게 맞춘다. 그 뒤에는 사용자가 움직인 화면을 유지한다.
    if (points.length && !fittedRef.current) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 17 })
      fittedRef.current = true
    }
  }, [data, here, myTeamId, tracks, until, zoomTick])

  const [note, setNote] = useState('')

  useEffect(() => {
    if (!recent) return
    const timer = setTimeout(() => setRecent(''), 12000)
    return () => clearTimeout(timer)
  }, [recent])

  // 표시된 팀이 모두 보이게 화면을 맞춘다. 경로 선은 getLatLng가 없으므로 팀 표시(마커)만 모은다.
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
    else mapRef.current.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 18 })
  }

  return (
    <div className="team-map">
      <div ref={boxRef} className="team-map-box" />
      <button className="link" onClick={fitAll}>모든 팀이 보이게 맞추기</button>
      {note && <span className="net"> {note}</span>}
      {recent && <p className="map-recent" role="status">{recent}</p>}
    </div>
  )
}
