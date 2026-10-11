import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { teamsOf, teacherMap, withHere, HQ_TEAM } from './shared.jsx'
import { minutesAgo, agoText, locationGroups, distanceM } from './logic.js'

const clock = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

// 에버랜드 중심 부근(판다월드 인근). 위치를 보낸 팀이 없을 때의 처음 화면이다.
const EVERLAND = [37.2925, 127.2035]

// 이름표가 겹친다고 보는 화면 거리(픽셀). 이보다 가까운 팀은 이름표 하나로 합친다.
const NEAR_PX = 40

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// 이름표. 가운데가 위치에 오도록 감싸서 놓는다(이름 길이와 관계없이).
const pinIcon = (html) => L.divIcon({ className: '', html: `<div class="pin-wrap">${html}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] })

// 여러 팀의 마지막 위치를 한 화면에 표시한다. 지도 자료는 오픈스트리트맵이다.
// 같은 팀의 휴대폰이 서로 떨어져 있으면 1팀 A조, 1팀 B조처럼 따로 표시하고, 함께 있으면 하나로 표시한다.
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
    const teams = [HQ_TEAM, ...teamsOf(data)]
    const teachers = teacherMap(data)
    const visible = (p) => !until || new Date(p.at).getTime() <= until

    // 이동 경로는 휴대폰마다 따로 그린다. 같은 팀의 두 번째 휴대폰부터는 점선이다.
    if (tracks) {
      for (const team of teams) {
        const mine = tracks.filter((p) => p.team_id === team.id && visible(p))
        const names = teachers[team.id] || []
        const rank = (device) => {
          const last = mine.filter((p) => (p.device || '') === device).pop()
          const i = names.indexOf(last?.holder)
          return i < 0 ? names.length : i
        }
        const devices = [...new Set(mine.map((p) => p.device || ''))].sort((a, b) => rank(a) - rank(b))
        devices.forEach((device, i) => {
          const path = mine.filter((p) => (p.device || '') === device)
          if (path.length > 1) {
            L.polyline(path.map((p) => [p.lat, p.lng]), { color: team.color, weight: 4, opacity: 0.75, dashArray: i ? '8 7' : null }).addTo(layer)
          }
          // 지나온 지점마다 시각을 볼 수 있는 작은 점을 찍는다.
          for (const p of path) {
            L.circleMarker([p.lat, p.lng], { radius: 4, color: '#fff', weight: 1, fillColor: team.color, fillOpacity: 1 })
              .bindPopup(esc(`${team.name}${p.holder ? ` · ${p.holder}` : ''} · ${clock(p.at)}`))
              .addTo(layer)
          }
        })
      }
    }

    // 표시할 위치: 시각을 고르면 그때까지의 휴대폰별 마지막 경로 점, 아니면 서버의 마지막 위치(이 휴대폰은 방금 기록한 위치)
    let rows
    if (tracks && until) {
      const last = new Map()
      for (const p of tracks) if (visible(p)) last.set(`${p.team_id}|${p.device || ''}`, { ...p, device: p.device || '' })
      rows = [...last.values()]
    } else {
      rows = withHere(data.locations, myTeamId, here, data.now)
    }
    const groups = locationGroups(rows, teams, teachers)
    for (const g of groups) points.push([g.loc.lat, g.loc.lng])
    const pins = groups.map((g) => ({ g, px: map.latLngToContainerPoint([g.loc.lat, g.loc.lng]) }))

    // 이름표가 겹칠 만큼 가까운 무리끼리 묶는다(화면 거리 기준). 확대하면 다시 나뉜다.
    const bunches = []
    for (const pin of pins) {
      const bunch = bunches.find((b) => b.some((o) => o.px.distanceTo(pin.px) < NEAR_PX))
      if (bunch) bunch.push(pin)
      else bunches.push([pin])
    }

    // 이름표 아래에 적는 시간: 지금 보기에서는 "3분 전", 시각을 고른 경로 보기에서는 기록 시각
    const when = (g) => (until ? clock(g.loc.at) : agoText(g.loc.at, data.now))
    const state = ({ g }) => {
      const minutes = minutesAgo(g.loc.at, data.now)
      return {
        // live: 2분 안에 갱신된 위치(파동), stale: 10분 넘게 갱신되지 않은 위치(흐림), burst: 방금 미션을 완료한 팀(반짝임)
        live: !until && minutes <= 2,
        stale: !until && minutes > 10,
        burst: !until && burstRef.current[g.team.id] > Date.now(),
      }
    }
    // 팝업 한 줄: 무리 이름, 휴대폰을 가진 선생님, 기록 시각, 오차, 같은 팀 다른 조까지 거리
    const line = ({ g }) => {
      const others = groups.filter((o) => o.team === g.team && o !== g).map((o) => `${o.name}까지 약 ${distanceM(g.loc, o.loc)}m`)
      return esc(
        [
          `${g.name}${g.holders.length ? ` · ${g.holders.join('·')}` : ''}`,
          until ? `${clock(g.loc.at)} 기록` : `${clock(g.loc.at)} 기록(${agoText(g.loc.at, data.now)})${g.loc.acc ? ` · 오차 약 ${Math.round(g.loc.acc)}m` : ''}`,
          ...others,
        ].join(' · '),
      )
    }

    for (const bunch of bunches) {
      if (bunch.length === 1) {
        const pin = bunch[0]
        const { g } = pin
        const s = state(pin)
        const cls = `map-pin${s.stale ? ' stale' : ''}${s.live ? ' live' : ''}${s.burst ? ' burst' : ''}`
        // 나뉜 무리는 이름 옆에 휴대폰을 가진 선생님을 적고, 이름 아래에 몇 분 전 위치인지 적는다.
        const who = g.split && g.holders.length ? ` <em>${esc(g.holders.join('·'))}</em>` : ''
        const html = `<span class="${cls}" style="background:${g.team.color};--pin:${g.team.color}">${esc(g.name)}${who}<small>${when(g)}</small>${s.burst ? '<i class="map-star">⭐</i>' : ''}</span>`
        L.marker([g.loc.lat, g.loc.lng], { icon: pinIcon(html) }).bindPopup(line(pin)).addTo(layer)
        continue
      }

      // 여러 무리가 모여 있으면 이름표 하나로 합친다. 예: "본부·1,2팀·5팀 A조"
      const states = bunch.map(state)
      const whole = bunch.filter(({ g }) => g.team.id !== 0 && !g.split).map(({ g }) => g.team.id)
      const name = [
        bunch.some(({ g }) => g.team.id === 0) ? '본부' : '',
        whole.length ? `${whole.join(',')}팀` : '',
        ...bunch.filter(({ g }) => g.split).map(({ g }) => g.name),
      ].filter(Boolean).join('·')
      const newest = bunch.reduce((a, p) => (new Date(p.g.loc.at) > new Date(a.g.loc.at) ? p : a)).g
      const dots = bunch.map(({ g }) => `<i style="background:${g.team.color}"></i>`).join('')
      const cls = `map-pin group${states.every((s) => s.stale) ? ' stale' : ''}${states.some((s) => s.live) ? ' live' : ''}${states.some((s) => s.burst) ? ' burst' : ''}`
      const html = `<span class="${cls}" style="--pin:#343a40"><b class="group-dots">${dots}</b>${esc(name)}<small>${until ? `${clock(newest.loc.at)} 기록` : `${agoText(newest.loc.at, data.now)} 기록`}</small>${states.some((s) => s.burst) ? '<i class="map-star">⭐</i>' : ''}</span>`
      const lat = bunch.reduce((sum, p) => sum + p.g.loc.lat, 0) / bunch.length
      const lng = bunch.reduce((sum, p) => sum + p.g.loc.lng, 0) / bunch.length
      L.marker([lat, lng], { icon: pinIcon(html) })
        .bindPopup(`<b>함께 있는 팀</b><br>${bunch.map(line).join('<br>')}<br><small>지도를 확대하면 따로 표시됩니다.</small>`)
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
