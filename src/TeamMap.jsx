import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { teamsOf } from './shared.jsx'
import { minutesAgo } from './logic.js'

// 에버랜드 중심 부근(판다월드 인근). 위치를 보낸 팀이 없을 때의 처음 화면이다.
const EVERLAND = [37.2925, 127.2035]

// 여러 팀의 마지막 위치를 한 화면에 표시한다. 지도 자료는 오픈스트리트맵이다.
export default function TeamMap({ data, here, myTeamId }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const fittedRef = useRef(false)

  useEffect(() => {
    const map = L.map(boxRef.current, { zoomControl: true, attributionControl: true }).setView(EVERLAND, 16)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => map.remove()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const points = []
    // 본부(팀 번호 0)를 먼저, 이어서 참가 팀을 표시한다.
    const HQ = { id: 0, name: '본부', color: '#1f2a24' }
    for (const team of [HQ, ...teamsOf(data)]) {
      let loc = data.locations.find((l) => l.team_id === team.id)
      // 우리 팀은 방금 잰 위치가 있으면 그것을 사용한다.
      if (team.id === myTeamId && here) loc = { ...here, at: data.now }
      if (!loc) continue
      const minutes = minutesAgo(loc.at, data.now)
      const icon = L.divIcon({
        className: '',
        html: `<span class="map-pin${minutes > 10 ? ' stale' : ''}" style="background:${team.color}">${team.name}</span>`,
        iconSize: [44, 26],
        iconAnchor: [22, 13],
      })
      L.marker([loc.lat, loc.lng], { icon })
        .bindPopup(`${team.name} · ${minutes}분 전${loc.acc ? ` · 오차 약 ${Math.round(loc.acc)}m` : ''}`)
        .addTo(layer)
      points.push([loc.lat, loc.lng])
    }
    // 처음 위치가 들어왔을 때 한 번만 모든 팀이 보이게 맞춘다. 그 뒤에는 사용자가 움직인 화면을 유지한다.
    if (points.length && !fittedRef.current) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 17 })
      fittedRef.current = true
    }
  }, [data, here, myTeamId])

  function fitAll() {
    const points = []
    layerRef.current?.eachLayer((m) => points.push(m.getLatLng()))
    if (points.length) mapRef.current.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 17 })
  }

  return (
    <div className="team-map">
      <div ref={boxRef} className="team-map-box" />
      <button className="link" onClick={fitAll}>모든 팀이 보이게 맞추기</button>
    </div>
  )
}
