/* 스모크 존 레이더 — 앱 로직
 * 1) 서울 흡연구역 반경 N m 진입 알림(지오펜싱)
 * 2) 학교·어린이집·유치원 근처 금연구역 경고 + 지도에 빨간 원 표시
 * 3) 낯선 곳 모드 · 이동 중 자동 멈춤 · 방해 금지 시간 · 요약 알림
 * 위치 정보는 기기 안에서만 쓰고 어디에도 보내지 않는다.
 */
(function () {
  'use strict';

  // ===================== 0. 상수 =====================
  const STORE_KEY = 'smoke-radar-settings-v2';
  const HISTORY_KEY = 'smoke-radar-history-v2';
  const SEOUL_CENTER = [37.5665, 126.9780];
  const WALK_M_PER_MIN = 67;              // 시속 약 4km
  const FAMILIAR_RADIUS = 300;            // 자주 가는 곳 반경
  const FAST_KMH = 15;                    // 이 속도 이상이면 알림 멈춤
  const NOSMOKE_REPEAT_MS = 5 * 60 * 1000; // 같은 금연구역 재경고 간격
  const NOSMOKE_MIN_ZOOM = 15;            // 이 확대 수준부터 빨간 원 표시
  const NOSMOKE_MAX_DRAW = 700;
  const PAGE = 20;

  // 금연구역 기준: 법은 "시설 경계선에서 30m"인데 데이터는 점 좌표 하나라서
  // 시설 크기를 감안해 넉넉하게 잡는다(대략적인 범위).
  const NOSMOKE_RULES = {
    school:  { label: '학교',   rule: '학교 경계 30m 이내는 금연구역',   r: 70 },
    kinder:  { label: '유치원', rule: '유치원 경계 30m 이내는 금연구역', r: 45 },
    daycare: { label: '어린이집', rule: '어린이집 경계 30m 이내는 금연구역', r: 45 },
    subway:  { label: '지하철 출입구', rule: '지하철 출입구 10m 이내는 금연구역', r: 15 },
    etc:     { label: '금연구역', rule: '지정 금연구역', r: 30 }
  };

  const DEFAULT_SETTINGS = {
    radius: 100,
    mode: 'entry',          // entry: 진입 알림 / summary: 요약 알림
    interval: 3,            // 분, 0 = 한 번만
    cats: { out: true, bld: true, biz: false },
    noSmokeWarn: true,
    noSmokeMap: true,
    speedPause: true,
    quiet: { on: false, from: '23:00', to: '07:00' },
    familiar: [],
    sound: true,
    notif: false
  };

  // ===================== 1. 유틸 =====================
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } }
  };

  function dist(lat1, lng1, lat2, lng2) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
  }
  const fmtDist = m => (m >= 1000 ? (m / 1000).toFixed(1) + 'km' : m + 'm');
  const walkMin = m => Math.max(1, Math.round(m / WALK_M_PER_MIN));
  const fmtTime = t => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const kakaoUrl = s => `https://map.kakao.com/link/to/${encodeURIComponent(s.name)},${s.lat},${s.lng}`;
  const naverUrl = s => `https://map.naver.com/p/search/${encodeURIComponent(s.address || s.name)}`;

  // ===================== 2. 흡연구역 종류 분류 (이름·주소 기준 추정) =====================
  const BIZ_RE = /PC|피시|피씨|게임|당구|빌리어|빌리아|billiard|캐롬|골프|헬스|GYM|짐|바디|운동(?!장)|스포츠(?!타운)|휘트니스|피트니스|스포렉스|사우나|목욕|대중탕|탕$|호프|맥주|비어|펍|주점|술집|포차|양꼬치|갈비|국밥|참치|쭈꾸미|사케|커피|카페|노래|보드게임|VR|무도|볼링|스크린|클럽|사이버|아레나|코어스트롱|아이스 플래닛|ICE PLANET/i;
  const BIZ_NAMES = new Set(['일레븐', 'NY시스템', '베테랑', 'RAON기획', '엔큐브면목점', '노리터원', 'GOTO 면목', '푸른공간', '해밀', '떼굴떼굴', '빌킬',
    '쫑의전쟁', '로비토', '이찌방이야기', '우후죽순 연신내점', '원숭이 곳간', '쉘브르 기찻길', '코피티암(KOPITIAM)', '안주가 연신내점', '산이야기', '약속',
    '베이비 기네스', '오아시스', '베이다 야시장', '다온상회', '연신내밤', '세븐 플로어', '놀숲 연신내로데오점', '타디스', '오빠화이팅 연신내점', '은하수', '붓다마을']);
  const OUTISH_RE = /외부|보도|복개도로|주차장|앞$|앞\s|옆|뒤|측$|측\s|광장|출구/;
  const BLD_RE = /옥상|\d+층|층(?=\s|$|\))|테라스|지하(?!차도)|베란다|휴게공간|건물 내|내부/;
  const CAT_LABEL = { out: '실외·부스', bld: '건물 흡연실', biz: '업소 · 이용객 전용' };

  function classify(s) {
    const n = String(s.name || '').trim();
    if ((BIZ_RE.test(n) || BIZ_NAMES.has(n)) && !OUTISH_RE.test(n)) return 'biz';
    if (BLD_RE.test(n + ' ' + (s.address || ''))) return 'bld';
    return 'out';
  }

  // ===================== 3. 데이터 준비 =====================
  const SPOTS = (window.SMOKING_AREAS || [])
    .filter(s => isFinite(s.lat) && isFinite(s.lng))
    .map(s => ({
      ...s,
      lat: Number(s.lat),
      lng: Number(s.lng),
      name: String(s.name || '').trim(),
      address: String(s.address || '').replace(/^"+|"+$/g, '').trim(),
      gu: String(s.gu || '').trim(),
      cat: s.cat || classify(s)
    }));
  const VERIFY_KNOWN = SPOTS.some(s => typeof s.verified === 'boolean');
  const alertable = s => !VERIFY_KNOWN || s.verified !== false;
  const NO_SMOKE = (window.NO_SMOKING_POINTS || [])
    .filter(p => isFinite(p.lat) && isFinite(p.lng))
    .map(p => ({ ...p, lat: Number(p.lat), lng: Number(p.lng), rule: NOSMOKE_RULES[p.c] || NOSMOKE_RULES.etc }))
    .map(p => ({ ...p, r: Number(p.r) || p.rule.r }));

  // ===================== 4. 상태 =====================
  function loadSettings() {
    const saved = store.get(STORE_KEY, {}) || {};
    return {
      ...DEFAULT_SETTINGS, ...saved,
      cats: { ...DEFAULT_SETTINGS.cats, ...(saved.cats || {}) },
      quiet: { ...DEFAULT_SETTINGS.quiet, ...(saved.quiet || {}) },
      familiar: Array.isArray(saved.familiar) ? saved.familiar : []
    };
  }
  const state = {
    settings: loadSettings(),
    userPos: null,
    posSource: null,        // gps | manual | sim
    accuracy: null,
    speedKmh: 0,
    lastFix: null,
    follow: true,
    gpsWatch: null,
    inside: new Set(),      // 반경 안에 있는 흡연구역 id
    lastSmokeAlert: 0,
    lastSummary: 0,
    smokeDismissed: null,
    noSmokeNow: null,
    noSmokeDismissed: null,
    warnedNoSmoke: new Map(),
    gu: '전체',
    query: '',
    shown: PAGE,
    near: [],
    sim: { on: false, target: null, timer: null },
    swReg: null,
    audio: null,
    history: store.get(HISTORY_KEY, [])
  };
  const saveSettings = () => store.set(STORE_KEY, state.settings);

  // ===================== 5. 지도 =====================
  const map = L.map('map', { zoomControl: false, preferCanvas: true, tap: true }).setView(SEOUL_CENTER, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);
  const canvas = L.canvas({ padding: 0.3 });
  const spotLayer = L.layerGroup().addTo(map);
  const noSmokeLayer = L.layerGroup().addTo(map);
  let meMarker = null, radarRing = null, nearMarker = null;
  const COLORS = { out: '#10b981', bld: '#3b82f6', biz: '#94a3b8' };

  function popupHtml(s) {
    const d = state.userPos ? ` · ${fmtDist(dist(state.userPos.lat, state.userPos.lng, s.lat, s.lng))}` : '';
    return `<b>${esc(s.name)}</b>${d}<br><span style="color:#64748b">${esc(s.address)}</span><br>` +
      `<span style="font-size:12px">${CAT_LABEL[s.cat]}${s.cat === 'biz' ? ' (그 가게 손님만 이용 가능)' : ''}</span>` +
      `<div class="pop-links"><a class="k" href="${kakaoUrl(s)}" target="_blank" rel="noopener">카카오 길찾기</a>` +
      `<a class="n" href="${naverUrl(s)}" target="_blank" rel="noopener">네이버 지도</a></div>`;
  }

  function drawSpots() {
    spotLayer.clearLayers();
    const c = state.settings.cats;
    SPOTS.forEach(s => {
      if (!c[s.cat]) return;
      const m = L.circleMarker([s.lat, s.lng], {
        renderer: canvas, radius: 7, weight: 2, color: '#fff', fillColor: COLORS[s.cat], fillOpacity: alertable(s) ? 0.95 : 0.45
      });
      m.bindPopup(() => popupHtml(s));
      s._marker = m;
      spotLayer.addLayer(m);
    });
  }

  function drawNoSmoke() {
    noSmokeLayer.clearLayers();
    const on = state.settings.noSmokeMap && NO_SMOKE.length;
    $('legend-nosmoke').hidden = !on;
    if (!on) { $('legend-zoom').hidden = true; return; }
    const z = map.getZoom();
    $('legend-zoom').hidden = z >= NOSMOKE_MIN_ZOOM;
    if (z < NOSMOKE_MIN_ZOOM) return;
    const b = map.getBounds().pad(0.2);
    let n = 0;
    for (const p of NO_SMOKE) {
      if (!b.contains([p.lat, p.lng])) continue;
      if (++n > NOSMOKE_MAX_DRAW) break;
      L.circle([p.lat, p.lng], {
        renderer: canvas, radius: p.r, color: '#dc2626', weight: 1.5, fillColor: '#ef4444', fillOpacity: 0.22, interactive: true
      }).bindPopup(`<b>🚭 ${esc(p.n)}</b><br>${esc(p.rule.rule)}<br>위반 시 과태료 최대 10만원` +
        `${p.a ? `<br><span style="color:#64748b">${esc(p.a)}</span>` : ''}<br><span style="font-size:12px;color:#64748b">빨간 원은 대략적인 범위예요. 현장 표지판이 우선이에요.</span>`)
        .addTo(noSmokeLayer);
    }
  }
  map.on('moveend zoomend', drawNoSmoke);
  map.on('dragstart', () => { state.follow = false; $('btn-locate').classList.remove('active'); });

  function updateMe() {
    const p = state.userPos;
    if (!p) return;
    const cls = state.posSource === 'sim' ? 'me-dot sim' : 'me-dot';
    const icon = L.divIcon({ className: '', html: `<div class="${cls}"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
    if (!meMarker) meMarker = L.marker([p.lat, p.lng], { icon, zIndexOffset: 1000, keyboard: false }).addTo(map);
    else { meMarker.setLatLng([p.lat, p.lng]); meMarker.setIcon(icon); }
    const r = state.settings.radius;
    if (!radarRing) radarRing = L.circle([p.lat, p.lng], { radius: r, color: '#10b981', weight: 2, dashArray: '6 6', fillOpacity: 0.06, interactive: false }).addTo(map);
    else { radarRing.setLatLng([p.lat, p.lng]); radarRing.setRadius(r); }
    if (state.follow) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16), { animate: true });
  }

  function markNearest(s) {
    if (nearMarker) { map.removeLayer(nearMarker); nearMarker = null; }
    if (!s) return;
    const icon = L.divIcon({ className: '', html: `<div class="spot-pin ${s.cat} near"><span>🚬</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28] });
    nearMarker = L.marker([s.lat, s.lng], { icon, zIndexOffset: 900 }).bindPopup(() => popupHtml(s)).addTo(map);
  }

  // ===================== 6. 소리 · 진동 · 푸시 =====================
  function unlockAudio() {
    try {
      if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
      if (state.audio.state === 'suspended') state.audio.resume();
    } catch (e) { /* 오디오 불가 */ }
  }
  function tone(notes) {
    if (!state.settings.sound || !state.audio || isQuiet()) return;
    const ctx = state.audio, t0 = ctx.currentTime;
    notes.forEach(([f, start, dur, type]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
    });
  }
  const playChime = () => tone([[880, 0, 0.35], [1318, 0.18, 0.5]]);
  const playWarn = () => tone([[440, 0, 0.18, 'square'], [440, 0.25, 0.18, 'square'], [330, 0.5, 0.35, 'square']]);
  function vibrate(p) { if (!isQuiet() && 'vibrate' in navigator) { try { navigator.vibrate(p); } catch (e) {} } }

  async function pushNotify(title, body, tag) {
    if (isQuiet() || !state.settings.notif || !('Notification' in window) || Notification.permission !== 'granted') return;
    const opt = { body, tag, renotify: true, icon: 'assets/img/icon-192.png', badge: 'assets/img/icon-192.png', vibrate: [200, 100, 200] };
    try { if (state.swReg) { await state.swReg.showNotification(title, opt); return; } } catch (e) { console.warn('SW 알림 실패', e); }
    try { new Notification(title, opt); } catch (e) { console.warn('알림 실패', e); }
  }

  function toast(msg, ms) {
    let el = $('mini-toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'mini-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:calc(var(--sheet-peek,210px) + 90px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:200;max-width:92%;' +
        'background:#0f172a;color:#fff;padding:12px 16px;border-radius:14px;font-size:15px;line-height:1.45;box-shadow:0 8px 24px rgba(0,0,0,.25);text-align:center';
      document.body.appendChild(el);
    }
    el.textContent = msg; el.hidden = false;
    clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, ms || 3200);
  }

  function addHistory(kind, text) {
    state.history.unshift({ t: Date.now(), kind, text });
    state.history = state.history.slice(0, 40);
    store.set(HISTORY_KEY, state.history);
    renderHistory();
  }

  // ===================== 7. 알림을 쉬어야 하는지 =====================
  function isQuiet() {
    const q = state.settings.quiet;
    if (!q.on) return false;
    const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
    const toM = s => { const [h, mi] = String(s).split(':').map(Number); return (h || 0) * 60 + (mi || 0); };
    const a = toM(q.from), b = toM(q.to);
    return a <= b ? (m >= a && m < b) : (m >= a || m < b);
  }
  function familiarHere() {
    const p = state.userPos;
    if (!p) return null;
    return state.settings.familiar.find(f => dist(p.lat, p.lng, f.lat, f.lng) <= FAMILIAR_RADIUS) || null;
  }
  function isFast() {
    return state.settings.speedPause && state.posSource === 'gps' && state.speedKmh >= FAST_KMH;
  }
  // 흡연구역 알림을 멈출 이유 (없으면 null)
  function smokePauseReason() {
    if (isFast()) return `🚗 이동 중(시속 ${Math.round(state.speedKmh)}km)이라 알림을 잠깐 멈췄어요`;
    const f = familiarHere();
    if (f) return `🏠 '${f.name}' 근처라 흡연구역 알림을 쉬고 있어요`;
    return null;
  }

  // ===================== 8. 위치 처리 =====================
  function setPosition(lat, lng, source, accuracy, gpsSpeed) {
    const now = Date.now();
    if (source === 'gps') {
      let kmh = null;
      if (typeof gpsSpeed === 'number' && isFinite(gpsSpeed) && gpsSpeed >= 0) kmh = gpsSpeed * 3.6;
      else if (state.lastFix && state.posSource === 'gps') {
        const dt = (now - state.lastFix.t) / 1000;
        if (dt >= 2) kmh = dist(state.lastFix.lat, state.lastFix.lng, lat, lng) / dt * 3.6;
      }
      if (kmh !== null) state.speedKmh = state.speedKmh * 0.5 + kmh * 0.5;
      state.lastFix = { lat, lng, t: now };
    } else {
      state.speedKmh = 0;
    }
    const firstFix = !state.userPos;
    state.userPos = { lat, lng };
    state.posSource = source;
    state.accuracy = accuracy ?? null;
    $('loc-banner').hidden = true;
    updateMe();
    evaluate(firstFix);
  }

  function startGps() {
    if (!('geolocation' in navigator)) { showLocHelp('이 브라우저는 위치 기능을 지원하지 않아요.'); return; }
    if (state.gpsWatch !== null) return;
    if (!window.isSecureContext) { showLocHelp('위치 기능은 https 주소에서만 켜져요.'); return; }
    if (!state.userPos) showLocHelp('📍 내 위치를 찾는 중이에요…');
    state.gpsWatch = navigator.geolocation.watchPosition(
      pos => {
        if (state.sim.on || state.posSource === 'manual') return;
        setPosition(pos.coords.latitude, pos.coords.longitude, 'gps', Math.round(pos.coords.accuracy), pos.coords.speed);
      },
      err => {
        // 권한 거부일 때만 추적을 멈춘다. 시간 초과·일시적 실패는 계속 기다린다(실내·지하 등).
        if (err.code === 1) {
          stopGps();
          showLocHelp('위치 권한이 꺼져 있어요. 브라우저 설정에서 위치를 허용하거나 아래에서 위치를 골라주세요.');
        } else if (!state.userPos) {
          showLocHelp('위치를 찾는 데 시간이 걸리고 있어요. 기다리거나 아래에서 위치를 골라주세요.');
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  }
  function stopGps() { if (state.gpsWatch !== null) { navigator.geolocation.clearWatch(state.gpsWatch); state.gpsWatch = null; } }
  function showLocHelp(text) { $('loc-text').textContent = text; $('loc-banner').hidden = false; }

  // ===================== 9. 판단: 주변 계산 → 알림 =====================
  function filteredSpots() {
    const c = state.settings.cats, q = state.query.trim().toLowerCase();
    return SPOTS.filter(s => c[s.cat] &&
      (state.gu === '전체' || s.gu === state.gu) &&
      (!q || (s.name + ' ' + s.address + ' ' + s.gu).toLowerCase().includes(q)));
  }

  function evaluate(firstFix) {
    const p = state.userPos;
    if (!p) { renderList(); renderStatus(); return; }
    const c = state.settings.cats, r = state.settings.radius;
    // 알림 대상: 종류 필터만 적용(검색·구 필터는 목록용)
    const cand = [];
    for (const s of SPOTS) {
      if (!c[s.cat] || !alertable(s)) continue;
      if (Math.abs(s.lat - p.lat) > 0.05 || Math.abs(s.lng - p.lng) > 0.06) continue;
      cand.push({ s, d: dist(p.lat, p.lng, s.lat, s.lng) });
    }
    cand.sort((a, b) => a.d - b.d);
    let nearest = cand[0] || null;
    if (!nearest) { // 5km 밖이면 전체에서 찾기
      let best = null;
      for (const s of SPOTS) { if (!c[s.cat] || !alertable(s)) continue; const d = dist(p.lat, p.lng, s.lat, s.lng); if (!best || d < best.d) best = { s, d }; }
      nearest = best;
    }
    const within = cand.filter(x => x.d <= r);
    state.near = { nearest, within };
    markNearest(nearest && nearest.s);

    const pause = smokePauseReason();
    checkSmoke(within, nearest, pause, firstFix);
    checkNoSmoke();
    renderSummary(within, nearest, pause);
    renderList();
    renderStatus(pause);
  }

  function checkSmoke(within, nearest, pause, firstFix) {
    const now = Date.now(), s = state.settings;
    const ids = new Set(within.map(x => x.s.id));
    const entered = within.filter(x => !state.inside.has(x.s.id));
    state.inside = ids;
    if (!within.length) { state.smokeDismissed = null; hideSmokeCard(); }
    if (pause) { hideSmokeCard(); return; }

    const intervalMs = s.interval * 60000;
    if (s.mode === 'entry') {
      if (entered.length) {
        alertSmoke('enter', entered[0]);
        state.lastSmokeAlert = now;
      } else if (within.length && intervalMs > 0 && now - state.lastSmokeAlert >= intervalMs) {
        alertSmoke('repeat', within[0]);
        state.lastSmokeAlert = now;
      } else if (within.length && state.smokeDismissed !== within[0].s.id) {
        showSmokeCard('enter', within[0], true);
      }
    } else { // summary
      const due = firstFix || (intervalMs > 0 && now - state.lastSummary >= intervalMs);
      if (due && nearest) {
        alertSmoke('summary', nearest, within.length);
        state.lastSummary = now;
      }
    }
  }

  function alertSmoke(kind, x, count) {
    const r = state.settings.radius, s = x.s, w = walkMin(x.d);
    showSmokeCard(kind, x, false, count);
    playChime(); vibrate([200, 100, 200]);
    let title, body;
    if (kind === 'summary') {
      title = count ? `🚬 주변 ${r}m에 흡연구역 ${count}곳` : `🧭 반경 ${r}m 안에는 흡연구역이 없어요`;
      body = `가장 가까운 곳: ${s.name} · ${fmtDist(x.d)} (도보 약 ${w}분)`;
    } else {
      title = kind === 'repeat' ? `⏰ 아직 흡연구역 근처예요 (${fmtDist(x.d)})` : `🚨 주변 ${r}m 안 흡연구역 감지! (${fmtDist(x.d)})`;
      body = `${s.name} · 도보 약 ${w}분\n${s.address}`;
    }
    pushNotify(title, body, 'smoke-radar');
    addHistory('smoke', `${title.replace(/^[^\s]+\s/, '')} — ${s.name}`);
  }

  function showSmokeCard(kind, x, silent, count) {
    const s = x.s, r = state.settings.radius;
    let badge = '🚬 흡연구역 감지', title = `${s.name}`, desc;
    if (kind === 'summary') {
      badge = count ? `🚬 주변 ${r}m에 ${count}곳` : `🧭 ${r}m 안에는 없어요`;
      title = `가장 가까운 곳: ${s.name}`;
    } else if (kind === 'repeat') badge = '⏰ 아직 근처예요';
    desc = `${fmtDist(x.d)} · 도보 약 ${walkMin(x.d)}분 · ${s.address}${s.cat === 'biz' ? ' · 이용객 전용' : ''}`;
    $('smoke-badge').textContent = badge;
    $('smoke-title').textContent = title;
    $('smoke-desc').textContent = desc;
    $('smoke-kakao').href = kakaoUrl(s);
    $('smoke-show').onclick = () => { state.follow = false; map.setView([s.lat, s.lng], 18); if (s._marker) s._marker.openPopup(); };
    $('smoke-card').dataset.id = s.id;
    if (!silent || $('smoke-card').hidden) $('smoke-card').hidden = false;
  }
  function hideSmokeCard() { $('smoke-card').hidden = true; }

  function checkNoSmoke() {
    const p = state.userPos;
    state.noSmokeNow = null;
    if (!p || !state.settings.noSmokeWarn || !NO_SMOKE.length || isFast()) { hideNoSmoke(); return; }
    let best = null;
    for (const z of NO_SMOKE) {
      if (Math.abs(z.lat - p.lat) > 0.0015 || Math.abs(z.lng - p.lng) > 0.002) continue;
      const d = dist(p.lat, p.lng, z.lat, z.lng);
      if (d <= z.r && (!best || d < best.d)) best = { z, d, key: `${z.c}:${z.n}:${z.lat}` };
    }
    state.noSmokeNow = best;
    if (!best) { state.noSmokeDismissed = null; hideNoSmoke(); return; }
    if (state.noSmokeDismissed !== best.key) showNoSmoke(best);
    const now = Date.now(), last = state.warnedNoSmoke.get(best.key) || 0;
    if (now - last >= NOSMOKE_REPEAT_MS) {
      state.warnedNoSmoke.set(best.key, now);
      playWarn(); vibrate([120, 80, 120, 80, 120]);
      pushNotify(`🚭 금연구역 주의: ${best.z.n} 근처`, `${best.z.rule.rule} · 위반 시 과태료 최대 10만원 (현장 표지판을 확인하세요)`, 'smoke-radar-nosmoke');
      addHistory('nosmoke', `금연구역 주의 — ${best.z.n} 근처`);
    }
  }
  function showNoSmoke(b) {
    $('nosmoke-title').textContent = `${b.z.n} 근처예요 (약 ${b.d}m)`;
    $('nosmoke-desc').textContent = `${b.z.rule.rule} · 위반 시 과태료 최대 10만원`;
    $('nosmoke-card').hidden = false;
  }
  function hideNoSmoke() { $('nosmoke-card').hidden = true; }

  // ===================== 10. 화면 그리기 =====================
  function renderSummary(within, nearest, pause) {
    const box = $('summary-box');
    if (!state.userPos || !nearest) { box.hidden = true; return; }
    const r = state.settings.radius, s = nearest.s;
    box.classList.toggle('ok', within.length > 0);
    const link = `<a href="${kakaoUrl(s)}" target="_blank" rel="noopener">길찾기</a>`;
    box.innerHTML = (pause ? `<div style="margin-bottom:4px">${esc(pause)}</div>` : '') + (within.length
      ? `반경 ${r}m 안에 <b>${within.length}곳</b> 있어요. 가장 가까운 곳은 <b>${esc(s.name)}</b> · ${fmtDist(nearest.d)} (도보 약 ${walkMin(nearest.d)}분) ${link}`
      : `반경 ${r}m 안에는 없어요. 가장 가까운 곳은 <b>${esc(s.name)}</b> · ${fmtDist(nearest.d)} (도보 약 ${walkMin(nearest.d)}분) ${link}`);
    box.hidden = false;
  }

  function renderStatus(pause) {
    const s = state.settings;
    const iv = s.interval > 0 ? `${s.interval}분마다` : '한 번만';
    $('radar-badge').textContent = `${s.radius}m · ${s.mode === 'summary' ? '요약 ' : ''}${iv}`;
    $('radar-badge').parentElement.classList.toggle('paused', !!pause || isQuiet());
    let src;
    if (!state.userPos) src = '📍 위치 확인 중';
    else if (state.posSource === 'sim') src = '🚶 시뮬레이션 위치 기준';
    else if (state.posSource === 'manual') src = '📌 직접 고른 위치 기준';
    else src = `📍 GPS${state.accuracy ? ` ±${state.accuracy}m` : ''}`;
    const tail = s.mode === 'summary' ? `${iv} 주변 요약 알림` : `반경 ${s.radius}m 안이면 ${s.interval > 0 ? iv : '들어갈 때 한 번'} 알림`;
    $('status-line').textContent = `${src} · ${tail}${isQuiet() ? ' · 🌙 방해 금지 중' : ''}`;
  }

  function spotItem(s, d) {
    const inside = d !== null && d <= state.settings.radius;
    const tags = [`<span class="tag">${esc(s.gu || '서울')}</span>`, `<span class="tag ${s.cat}">${CAT_LABEL[s.cat]}</span>`];
    if (VERIFY_KNOWN && s.verified === false) tags.push('<span class="tag warn">위치 미확인 · 알림 제외</span>');
    return `<li class="spot${inside ? ' inside' : ''}" data-id="${esc(s.id)}">
      <div class="spot-row"><div class="spot-name">${esc(s.name)}</div>${d !== null ? `<div class="spot-dist">${fmtDist(d)}</div>` : ''}</div>
      <div class="spot-addr">${esc(s.address)}${d !== null ? ` · 🚶 도보 약 ${walkMin(d)}분` : ''}</div>
      <div class="spot-tags">${tags.join('')}</div>
      <div class="spot-actions">
        <button class="btn ghost" data-act="show">📍 지도</button>
        <a class="btn kakao" href="${kakaoUrl(s)}" target="_blank" rel="noopener">카카오 길찾기</a>
        <a class="btn naver" href="${naverUrl(s)}" target="_blank" rel="noopener">네이버</a>
      </div></li>`;
  }

  function renderList() {
    const p = state.userPos;
    let rows = filteredSpots().map(s => ({ s, d: p ? dist(p.lat, p.lng, s.lat, s.lng) : null }));
    if (p) rows.sort((a, b) => a.d - b.d);
    $('list-count').textContent = p ? `(${rows.length.toLocaleString()}곳 중 가까운 순)` : `(${rows.length.toLocaleString()}곳)`;
    const list = $('spot-list');
    if (!rows.length) { list.innerHTML = '<li class="empty">조건에 맞는 흡연구역이 없어요.</li>'; $('more-btn').hidden = true; return; }
    list.innerHTML = rows.slice(0, state.shown).map(x => spotItem(x.s, x.d)).join('');
    $('more-btn').hidden = rows.length <= state.shown;
  }

  function renderGuChips() {
    const counts = {};
    SPOTS.forEach(s => { if (s.gu) counts[s.gu] = (counts[s.gu] || 0) + 1; });
    const gus = ['전체', ...Object.keys(counts).sort((a, b) => a.localeCompare(b, 'ko'))];
    $('gu-chips').innerHTML = gus.map(g => `<button class="chip${g === state.gu ? ' on' : ''}" data-gu="${esc(g)}" role="tab" aria-selected="${g === state.gu}">${esc(g)}${g !== '전체' ? ` ${counts[g]}` : ''}</button>`).join('');
  }

  function renderHistory() {
    $('history-count').textContent = state.history.length ? `(${state.history.length})` : '';
    $('history-list').innerHTML = state.history.length
      ? state.history.map(h => `<li><span class="time">${fmtTime(h.t)}</span>${h.kind === 'nosmoke' ? '🚭 ' : '🚬 '}${esc(h.text)}</li>`).join('')
      : '<li class="muted">아직 알림이 없어요.</li>';
  }

  function renderDataBadge() {
    const n = SPOTS.length;
    let txt = `서울 ${n.toLocaleString()}곳`;
    if (!VERIFY_KNOWN) txt += ' · 좌표 검증 전';
    $('data-badge').textContent = txt;
    if (VERIFY_KNOWN) {
      const v = SPOTS.filter(s => s.verified).length;
      $('verify-note').textContent = `좌표 검증 완료 ${v.toLocaleString()}곳 (위치 미확인 곳은 목록에만 보이고 알림에서는 빠져요).`;
    }
  }

  // ===================== 11. 설정 화면 =====================
  function openSettings() { syncSettingsUI(); $('settings').hidden = false; }
  function closeSettings() { $('settings').hidden = true; }
  function syncSettingsUI() {
    const s = state.settings;
    document.querySelectorAll('.seg').forEach(seg => {
      const k = seg.dataset.key;
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(s[k]) === b.dataset.v));
    });
    $('mode-help').textContent = s.mode === 'summary'
      ? '정해진 간격마다 "주변에 몇 곳, 가장 가까운 곳은 어디"를 묶어서 알려줘요.'
      : '반경 안에 새로 들어가면 바로 알리고, 머무는 동안 정한 간격마다 다시 알려줘요.';
    $('set-nosmoke').checked = s.noSmokeWarn;
    $('set-nosmoke-map').checked = s.noSmokeMap;
    $('set-speed').checked = s.speedPause;
    $('set-quiet').checked = s.quiet.on;
    $('quiet-from').value = s.quiet.from;
    $('quiet-to').value = s.quiet.to;
    $('familiar-list').innerHTML = s.familiar.length
      ? s.familiar.map((f, i) => `<li><span>🏠 ${esc(f.name)}</span><button data-del="${i}">삭제</button></li>`).join('')
      : '<li class="muted">등록된 곳이 없어요.</li>';
  }
  function settingsChanged(redrawSpots) {
    saveSettings();
    syncSettingsUI();
    if (redrawSpots) drawSpots();
    drawNoSmoke();
    if (radarRing) radarRing.setRadius(state.settings.radius);
    state.inside = new Set(); // 반경이 바뀌면 진입 판단을 새로
    evaluate(false);
  }

  // ===================== 12. 시뮬레이터 =====================
  function simStart() {
    unlockAudio();
    state.sim.on = true;
    $('btn-sim').classList.add('on'); $('btn-sim').setAttribute('aria-pressed', 'true');
    $('sim-bar').hidden = false;
    const start = state.userPos || { lat: 37.4979, lng: 127.0276 };
    setPosition(start.lat, start.lng, 'sim');
    state.follow = true;
    toast('지도를 탭하면 그쪽으로 걸어가요. 흡연구역이나 학교 근처로 가보세요.');
  }
  function simStop() {
    state.sim.on = false; state.sim.target = null;
    clearInterval(state.sim.timer); state.sim.timer = null;
    $('btn-sim').classList.remove('on'); $('btn-sim').setAttribute('aria-pressed', 'false');
    $('sim-bar').hidden = true;
    state.posSource = 'manual';
    toast('시뮬레이션을 끝냈어요. 📍 버튼을 누르면 실제 GPS로 돌아가요.');
    updateMe(); renderStatus(smokePauseReason());
  }
  function simWalkTo(lat, lng) {
    state.sim.target = { lat, lng };
    if (state.sim.timer) return;
    const STEP_MS = 250;
    state.sim.timer = setInterval(() => {
      const t = state.sim.target, p = state.userPos;
      if (!t || !p) return;
      const speed = 1.4 * Number($('sim-speed').value || 1); // m/s
      const step = speed * STEP_MS / 1000;
      const d = dist(p.lat, p.lng, t.lat, t.lng);
      if (d <= step) { clearInterval(state.sim.timer); state.sim.timer = null; setPosition(t.lat, t.lng, 'sim'); return; }
      const f = step / d;
      setPosition(p.lat + (t.lat - p.lat) * f, p.lng + (t.lng - p.lng) * f, 'sim');
    }, STEP_MS);
  }

  // ===================== 13. 이벤트 연결 =====================
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  $('btn-sound').onclick = () => {
    state.settings.sound = !state.settings.sound; saveSettings();
    $('btn-sound').classList.toggle('on', state.settings.sound);
    $('btn-sound').setAttribute('aria-pressed', String(state.settings.sound));
    $('btn-sound').firstChild.textContent = state.settings.sound ? '🔊' : '🔇';
    if (state.settings.sound) { unlockAudio(); playChime(); }
  };

  $('btn-notif').onclick = async () => {
    unlockAudio();
    if (!('Notification' in window)) {
      toast('이 브라우저는 알림을 지원하지 않아요. 아이폰은 사파리에서 "홈 화면에 추가"한 뒤 열면 알림을 받을 수 있어요.', 5200);
      return;
    }
    if (state.settings.notif && Notification.permission === 'granted') {
      state.settings.notif = false; saveSettings(); syncNotifBtn(); toast('휴대폰 알림을 껐어요.'); return;
    }
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    state.settings.notif = perm === 'granted'; saveSettings(); syncNotifBtn();
    if (perm === 'granted') { pushNotify('🔔 알림이 켜졌어요', '흡연구역에 가까워지거나 금연구역에 들어가면 알려드릴게요.', 'smoke-radar-test'); }
    else toast('알림이 차단돼 있어요. 브라우저 설정에서 이 사이트 알림을 허용해주세요.', 4200);
  };
  function syncNotifBtn() {
    const on = state.settings.notif && 'Notification' in window && Notification.permission === 'granted';
    $('btn-notif').classList.toggle('on', on);
    $('btn-notif').querySelector('.hbtn-label').textContent = on ? '알림 켜짐' : '알림';
  }

  $('btn-sim').onclick = () => (state.sim.on ? simStop() : simStart());
  $('sim-stop').onclick = simStop;

  $('btn-locate').onclick = () => {
    state.follow = true; $('btn-locate').classList.add('active');
    if (state.sim.on) { if (state.userPos) map.setView([state.userPos.lat, state.userPos.lng], Math.max(map.getZoom(), 16)); return; }
    if (state.posSource === 'manual') state.posSource = null;
    stopGps(); startGps();
    if (state.userPos) map.setView([state.userPos.lat, state.userPos.lng], Math.max(map.getZoom(), 16));
  };

  map.on('click', e => { if (state.sim.on) simWalkTo(e.latlng.lat, e.latlng.lng); });
  map.on('contextmenu', e => { // 길게 누르기
    if (state.sim.on) return;
    stopGps(); state.follow = true;
    setPosition(e.latlng.lat, e.latlng.lng, 'manual');
    toast('이 위치를 내 위치로 정했어요. 📍 버튼을 누르면 GPS로 돌아가요.');
  });

  document.querySelectorAll('.quick-pos button').forEach(b => b.onclick = () => {
    stopGps(); state.follow = true;
    setPosition(Number(b.dataset.lat), Number(b.dataset.lng), 'manual');
  });

  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => {
    const k = b.dataset.close;
    if (k === 'smoke') { state.smokeDismissed = Number($('smoke-card').dataset.id); hideSmokeCard(); }
    if (k === 'nosmoke') { state.noSmokeDismissed = state.noSmokeNow && state.noSmokeNow.key; hideNoSmoke(); }
    if (k === 'settings') closeSettings();
  });

  const toggleSheet = open => document.body.classList.toggle('sheet-open', open ?? !document.body.classList.contains('sheet-open'));
  $('sheet-handle').onclick = () => toggleSheet();
  $('sheet-toggle').onclick = () => toggleSheet();
  $('search').addEventListener('focus', () => toggleSheet(true));
  $('search').addEventListener('input', e => { state.query = e.target.value; state.shown = PAGE; renderList(); });
  $('gu-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-gu]'); if (!b) return;
    state.gu = b.dataset.gu; state.shown = PAGE; renderGuChips(); renderList();
  });
  document.querySelectorAll('.cat-filter input').forEach(cb => {
    cb.checked = !!state.settings.cats[cb.dataset.cat];
    cb.onchange = () => { state.settings.cats[cb.dataset.cat] = cb.checked; settingsChanged(true); };
  });
  $('more-btn').onclick = () => { state.shown += PAGE; renderList(); };
  $('spot-list').addEventListener('click', e => {
    const b = e.target.closest('[data-act="show"]'); if (!b) return;
    const id = b.closest('.spot').dataset.id;
    const s = SPOTS.find(x => String(x.id) === id); if (!s) return;
    state.follow = false; toggleSheet(false);
    map.setView([s.lat, s.lng], 18);
    setTimeout(() => s._marker ? s._marker.openPopup() : L.popup().setLatLng([s.lat, s.lng]).setContent(popupHtml(s)).openOn(map), 300);
  });
  $('history-clear').onclick = () => { state.history = []; store.set(HISTORY_KEY, []); renderHistory(); };

  $('btn-settings').onclick = openSettings;
  $('settings-done').onclick = closeSettings;
  $('settings').addEventListener('click', e => { if (e.target === $('settings')) closeSettings(); });
  document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = seg.dataset.key, v = b.dataset.v;
    state.settings[k] = (k === 'mode') ? v : Number(v);
    if (k === 'mode') state.lastSummary = 0;
    settingsChanged(false);
  }));
  $('set-nosmoke').onchange = e => { state.settings.noSmokeWarn = e.target.checked; settingsChanged(false); };
  $('set-nosmoke-map').onchange = e => { state.settings.noSmokeMap = e.target.checked; settingsChanged(false); };
  $('set-speed').onchange = e => { state.settings.speedPause = e.target.checked; settingsChanged(false); };
  $('set-quiet').onchange = e => { state.settings.quiet.on = e.target.checked; settingsChanged(false); };
  $('quiet-from').onchange = e => { state.settings.quiet.from = e.target.value || '23:00'; settingsChanged(false); };
  $('quiet-to').onchange = e => { state.settings.quiet.to = e.target.value || '07:00'; settingsChanged(false); };
  $('familiar-add').onclick = () => {
    if (!state.userPos) { toast('먼저 내 위치가 잡혀야 등록할 수 있어요.'); return; }
    const name = $('familiar-name').value.trim() || `장소 ${state.settings.familiar.length + 1}`;
    state.settings.familiar.push({ name, lat: +state.userPos.lat.toFixed(5), lng: +state.userPos.lng.toFixed(5) });
    $('familiar-name').value = '';
    settingsChanged(false);
    toast(`'${name}'을(를) 등록했어요. 이 주변 300m에서는 흡연구역 알림을 쉬어요.`);
  };
  $('familiar-list').addEventListener('click', e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    state.settings.familiar.splice(Number(b.dataset.del), 1);
    settingsChanged(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

  // 30초마다 다시 판단 (가만히 있어도 재알림·요약 알림이 오도록)
  setInterval(() => { if (state.userPos) evaluate(false); }, 30000);

  // ===================== 14. 시작 =====================
  async function registerSW() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    try { state.swReg = await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('서비스워커 등록 실패', e); }
  }

  // 헤더 높이에 맞춰 알림 카드 위치 조정
  const fitHeader = () => document.documentElement.style.setProperty('--header-h', document.querySelector('.app-header').offsetHeight + 'px');
  window.addEventListener('resize', fitHeader); fitHeader();

  $('btn-sound').classList.toggle('on', state.settings.sound);
  $('btn-sound').firstChild.textContent = state.settings.sound ? '🔊' : '🔇';
  syncNotifBtn();
  renderDataBadge();
  renderGuChips();
  renderHistory();
  drawSpots();
  drawNoSmoke();
  renderList();
  renderStatus(null);
  registerSW();
  startGps();

  // 테스트·디버그용 (브라우저 콘솔에서 SmokeRadar.state 확인)
  window.SmokeRadar = { state, setPosition, evaluate, map, NO_SMOKE, SPOTS };
})();
