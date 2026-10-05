import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { teamsOf } from './shared.jsx'
import { minutesAgo, agoText } from './logic.js'

const clock = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

// 에버랜드 중심 부근(판다월드 인근). 위치를 보낸 팀이 없을 때의 처음 화면이다.
const EVERLAND = [37.2925, 127.2035]

// 여러 팀의 마지막 위치를 한 화면에 표시한다. 지도 자료는 오픈스트리트맵이다.
// tracks: 이동 경로 점 목록(시간 순서), until: 이 시각(ms)까지의 경로와 위치만 표시. 둘 다 없으면 마지막 위치만 표시한다.
export default function TeamMap({ data, here, myTeamId, tracks, until }) {
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
    fittedRef.current = false // 지도를 새로 만들면 처음 맞추기도 다시 한다
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
      const minutes = minutesAgo(loc.at, data.now)
      const icon = L.divIcon({
        className: '',
        // 팀 이름 아래에 그 위치가 기록된 시각을 적는다.
        html: `<span class="map-pin${!label && minutes > 10 ? ' stale' : ''}" style="background:${team.color}">${team.name}<small>${clock(loc.at)}</small></span>`,
        iconSize: [56, 40],
        iconAnchor: [28, 20],
      })
      L.marker([loc.lat, loc.lng], { icon })
        .bindPopup(label ? `${team.name} · ${label} 기록` : `${team.name} · ${clock(loc.at)} 기록(${agoText(loc.at, data.now)})${loc.acc ? ` · 오차 약 ${Math.round(loc.acc)}m` : ''}`)
        .addTo(layer)
      points.push([loc.lat, loc.lng])
    }
    // 처음 위치가 들어왔을 때 한 번만 모든 팀이 보이게 맞춘다. 그 뒤에는 사용자가 움직인 화면을 유지한다.
    if (points.length && !fittedRef.current) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 17 })
      fittedRef.current = true
    }
  }, [data, here, myTeamId, tracks, until])

  const [note, setNote] = useState('')

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
    </div>
  )
}
