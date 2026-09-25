const $ = (s) => document.querySelector(s);
const connectionNotice = document.createElement('div'); connectionNotice.className = 'connection-notice'; connectionNotice.textContent = '未连接，数据未同步'; connectionNotice.hidden = true; document.body.prepend(connectionNotice);
const ariaLabels = { babyName: '宝宝姓名', birthDate: '宝宝出生日期', gender: '宝宝性别', caregiverName: '当前照护者署名', password: '家庭访问口令' }; document.querySelectorAll('#auth input, #auth select').forEach((el) => { if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', ariaLabels[el.name] || el.name); });
let state = null;
let settingsDirty = false;
let pendingSignature = '';
let pendingMutationId = '';
const labels = { bottle: ['🍼', '瓶喂'], breast: ['🤱', '亲喂'], sleep: ['◒', '睡眠'], diaper: ['▣', '尿布'], supplement: ['✦', '补剂'], play: ['✺', '玩耍'], outing: ['○', '外出'], growth: ['⌁', '生长'], vaccine: ['＋', '疫苗'], food: ['◇', '辅食'] };
const actionIcon = (type) => {
  const icons = {
    bottle: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M19 11h10v5l4 4v17a4 4 0 0 1-4 4H19a4 4 0 0 1-4-4V20l4-4z" fill="currentColor" opacity=".18"/><path d="M19 11h10v5l4 4v17a4 4 0 0 1-4 4H19a4 4 0 0 1-4-4V20l4-4zM19 11V7h10v4M15 23h18"/><path d="M34 20l5-5 3 3-5 5"/> </svg>',
    breast: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="20" cy="13" r="5" fill="currentColor" opacity=".2"/><circle cx="20" cy="13" r="5"/><path d="M11 34c1-8 4-13 9-13s8 5 9 13M27 27c4-4 9-3 11 2l1 5H25" fill="currentColor" opacity=".18"/><path d="M11 34c1-8 4-13 9-13s8 5 9 13M27 27c4-4 9-3 11 2l1 5H25"/></svg>',
    sleep: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M30 9a15 15 0 1 0 9 26A17 17 0 1 1 30 9z" fill="currentColor" opacity=".2"/><path d="M30 9a15 15 0 1 0 9 26A17 17 0 1 1 30 9zM12 11h.1M17 7h.1M37 14h.1"/><path d="M36 28v6M33 31h6"/></svg>',
    diaper: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 13h28l-3 23a5 5 0 0 1-5 4H18a5 5 0 0 1-5-4z" fill="currentColor" opacity=".18"/><path d="M10 13h28l-3 23a5 5 0 0 1-5 4H18a5 5 0 0 1-5-4zM24 13v27M10 13l14 9 14-9"/></svg>',
    supplement: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M16 13h16v24a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4z" fill="currentColor" opacity=".18"/><path d="M16 13h16v24a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4zM18 8h12v5H18zM20 24h8M24 20v8"/></svg>',
    play: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="25" r="13" fill="currentColor" opacity=".18"/><circle cx="24" cy="25" r="13"/><path d="M24 12v-4M20 8h8M18 22l4 4 8-8M11 14l3 3M37 14l-3 3"/></svg>',
    outing: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 20h21l4 14H16z" fill="currentColor" opacity=".18"/><path d="M12 20h21l4 14H16zM10 13h5l3 7M18 34a4 4 0 1 0 0 8 4 4 0 0 0 0-8M34 34a4 4 0 1 0 0 8 4 4 0 0 0 0-8M38 9v7M34.5 12.5h7"/></svg>'
  };
  return icons[type] || '';
};
const rasterActionIcon = (type) => `<span class="raster-icon raster-${type}" aria-hidden="true"></span>`;
const TIMER_TYPES = new Set(['breast', 'sleep', 'play', 'outing']);
const controlIcon = (type) => ({ stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/></svg>', pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12"/></svg>', resume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>', edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 16-.8 3.8L8 19l10.5-10.5-3-3zM14 6l3 3"/></svg>', revoke: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>' }[type] || '');
const eventControl = (type, label, attrs) => `<button class="mini icon-mini ${type}" ${attrs} title="${label}" aria-label="${label}">${controlIcon(type)}<span>${label}</span></button>`;
const breastIntervals = (e) => Array.isArray(e.details?.intervals) && e.details.intervals.length ? e.details.intervals : [{ start_at: e.start_at, end_at: e.end_at }];
const eventDurationMinutes = (e) => Math.max(0, Math.round(breastIntervals(e).reduce((sum, part) => sum + Math.max(0, Date.parse(part.end_at || new Date().toISOString()) - Date.parse(part.start_at)), 0) / 60000));
const controlButton = (type, label) => { const button = document.createElement('button'); button.className = `mini icon-mini ${type}`; button.title = label; button.ariaLabel = label; button.innerHTML = `${controlIcon(type)}<span>${label}</span>`; return button; };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => globalThis.crypto?.randomUUID?.() || [...crypto.getRandomValues(new Uint8Array(16))].map((n) => n.toString(16).padStart(2, '0')).join('');
const fmtTime = (iso) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const fmtDate = (iso) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).format(new Date(iso));
const mins = (n) => n < 60 ? `${n} 分钟` : `${Math.floor(n / 60)}小时${n % 60 ? `${n % 60}分` : ''}`;
const shanghaiDateParts = (date = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).filter(({ type }) => ['year', 'month', 'day'].includes(type)).map(({ type, value }) => [type, Number(value)]));
const ageText = (birthDate, today = shanghaiDateParts()) => {
  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number); const current = Date.UTC(today.year, today.month - 1, today.day); const birth = Date.UTC(birthYear, birthMonth - 1, birthDay);
  if (![birthYear, birthMonth, birthDay].every(Number.isFinite) || current < birth) return '出生日期待到达';
  let months = (today.year - birthYear) * 12 + today.month - birthMonth; const anchor = () => Date.UTC(birthYear + Math.floor(months / 12), (birthMonth - 1 + months) % 12, Math.min(birthDay, new Date(Date.UTC(birthYear + Math.floor(months / 12), (birthMonth - 1 + months) % 12 + 1, 0)).getUTCDate()));
  if (current < anchor()) months -= 1; const days = Math.floor((current - anchor()) / 86400000); return `${months}个月${days}天`;
};
const percentileDisplay = (value) => {
  if (!value) return '无适用参考';
  if (value.startsWith('<P')) return `<${value.slice(2)}%`;
  if (value.startsWith('>P')) return `>${value.slice(2)}%`;
  return value.startsWith('P') ? `${value.slice(1)}%` : value;
};
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3200); }
async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(typeof options.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
  } catch { connectionNotice.hidden = false; throw new Error('网络未连接，请检查服务后重试'); }
  let body = {}; try { body = await res.json(); } catch {}
  connectionNotice.hidden = true;
  if (!res.ok) { if (res.status === 401) showAuth(false); throw new Error(body.error || '请求未完成'); }
  return body;
}
const formObject = (form) => Object.fromEntries(new FormData(form).entries());
const extraVaccineOptions = ['13价肺炎球菌结合疫苗', '23价肺炎球菌多糖疫苗', '五价轮状病毒疫苗', '三价轮状病毒疫苗', '单价轮状病毒疫苗'];
document.querySelector('#vaccineNames')?.insertAdjacentHTML('beforeend', extraVaccineOptions.map((name) => `<option value="${name}">`).join(''));
if (!$('#loginForm').elements.caregiverName) { const name = document.createElement('input'); name.name = 'caregiverName'; name.placeholder = '你的署名（可不填）'; name.maxLength = 80; $('#loginForm').prepend(name); }
const passwordPanel = document.createElement('form'); passwordPanel.className = 'panel form-grid'; passwordPanel.innerHTML = '<h3>修改家庭访问口令</h3><label>旧口令<input name="oldPassword" type="password" autocomplete="current-password" required></label><label>新口令<input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></label><button>修改口令</button>'; $('#profileForm').after(passwordPanel);
passwordPanel.addEventListener('submit', async (e) => { e.preventDefault(); const b = formObject(passwordPanel); try { await api('/api/password', { method: 'PATCH', body: JSON.stringify({ ...b, mutationId: uid() }) }); passwordPanel.reset(); state = null; showAuth(false); toast('访问口令已修改，请重新登录'); } catch (x) { toast(x.message); } });
function showAuth(isSetup) { state = null; $('#auth').hidden = false; $('#app').hidden = true; $('#setupForm').hidden = !isSetup; $('#loginForm').hidden = isSetup; $('#authIntro').textContent = isSetup ? '先建立宝宝档案，之后家庭成员使用同一个访问口令进入。' : '这个家庭工作台需要访问口令才能继续。'; }
function showApp() { $('#auth').hidden = true; $('#app').hidden = false; setupNativeLivePhoto(); loadLivePhotos().catch(() => {}); }
async function boot() { try { const s = await api('/api/status'); if (!s.setup) return showAuth(true); try { await loadState(); showApp(); } catch { showAuth(false); } } catch (e) { toast(e.message); } }
async function loadState() { state = await api('/api/state'); render(); }
function render() { const p = state.profile; $('#babyTitle').textContent = p.baby_name; $('#babyMeta').textContent = `${ageText(p.birth_date)} · ${p.caregiver_name} 记录中`; renderSummary(); renderActions(); const dailyEvents = state.events.filter((e) => !['growth', 'vaccine', 'food'].includes(e.type)); renderTimeline($('#timeline'), dailyEvents.slice(0, 12)); renderTimeline($('#historyList'), state.events); renderHandoff(); renderHealth(); renderCompanion(); if (!settingsDirty) { $('#profileForm').babyName.value = p.baby_name; $('#profileForm').birthDate.value = p.birth_date; $('#profileForm').gender.value = p.gender; $('#profileForm').caregiverName.value = p.caregiver_name; } }
function renderSummary() { const s = state.summary; const breastEvents = state.events.filter((e) => e.type === 'breast'); const sideMinutes = (side) => breastEvents.filter((e) => e.details.side === side).reduce((sum, e) => sum + eventDurationMinutes(e), 0); const leftMinutes = s.breast_left_minutes ?? sideMinutes('左'); const rightMinutes = s.breast_right_minutes ?? sideMinutes('右'); const totalBreastMinutes = Number.isFinite(s.breast_minutes) ? s.breast_minutes : breastEvents.reduce((sum, e) => sum + eventDurationMinutes(e), 0); const cards = [{ type: 'bottle', value: `${s.bottle_ml} ml`, label: '瓶喂' }, { type: 'breast', value: mins(totalBreastMinutes), label: '亲喂', detail: `左${leftMinutes} / 右${rightMinutes} 分钟` }, { type: 'sleep', value: mins(s.sleep_minutes), label: '睡眠' }, { type: 'diaper', value: `${s.diaper_count} 次`, label: '尿布', detail: `全天尿量 ${Number(s.urine_grams || 0)} 克` }]; $('#stats').innerHTML = cards.map(({ type, value, label, detail }) => `<div class="stat"><span class="stat-icon icon-${type}">${rasterActionIcon(type)}</span><div class="stat-copy"><strong>${esc(value)}</strong><span>${esc(label)}</span>${detail ? `<small>${esc(detail)}</small>` : ''}</div></div>`).join(''); }
const timelineIcon = (type) => `<span class="timeline-icon icon-${type}">${rasterActionIcon(type)}</span>`;
const relativeBefore = (iso) => { if (!iso) return '暂无记录'; const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000)); if (minutes < 1) return '刚刚'; if (minutes < 60) return `${minutes}分钟前`; const hours = Math.floor(minutes / 60); return `${hours}小时${minutes % 60 ? `${minutes % 60}分钟` : ''}前`; };
function handoffRecency(events) { const feeding = events.find((e) => ['breast', 'bottle'].includes(e.type) && (e.end_at || e.type === 'bottle')) || events.find((e) => ['breast', 'bottle'].includes(e.type)); const sleep = events.find((e) => e.type === 'sleep' && e.end_at); return `上次喂养是${relativeBefore(feeding?.end_at || feeding?.start_at)}，上次醒来是${relativeBefore(sleep?.end_at)}`; }
function renderHandoff() { const active = state.summary.active.filter((e) => !['growth', 'vaccine', 'food'].includes(e.type)); const activeBreast = active.filter((e) => e.type === 'breast'); const activeDisplay = activeBreast.length ? [{ ...activeBreast[0], _breastPeers: activeBreast }, ...active.filter((e) => e.type !== 'breast')] : active; const dailyEvents = state.events.filter((e) => !['growth', 'vaccine', 'food'].includes(e.type)); const recentBottle = dailyEvents.find((e) => e.type === 'bottle'); const recent = dailyEvents[0]; const sub = $('#handoffSub'); const recency = handoffRecency(dailyEvents); sub.textContent = ''; const recentLine = document.createElement('span'); recentLine.className = 'handoff-recent'; if (activeDisplay.length) { $('#handoffText').textContent = `${activeDisplay.length} 项计时进行中`; activeDisplay.forEach((e) => { const peers = e._breastPeers || [e]; const row = document.createElement('span'); row.textContent = e.type === 'breast' ? `${labels[e.type][1]} ${peers.map((peer) => `${peer.details.side || ''}侧 ${fmtTime(peer.start_at)} · 已持续 ${elapsedClock(peer)}`).join(' · ')} · ${e.created_by} ` : `${labels[e.type][1]} ${fmtTime(e.start_at)} · 已持续 ${mins(eventDurationMinutes(e))} · ${e.created_by} `; const controls = peers.flatMap((peer) => { const stop = controlButton('stop', '结束'); stop.addEventListener('click', () => stopEvent(peer)); const toggle = peer.type === 'breast' ? controlButton(peer.details.paused ? 'resume' : 'pause', peer.details.paused ? '继续' : '暂停') : null; toggle?.addEventListener('click', () => updateBreastTimer(peer, peer.details.paused ? 'resume' : 'pause')); return toggle ? [toggle, stop] : [stop]; }); sub.append(row, ...controls, document.createElement('br')); }); } else { $('#handoffText').textContent = recentBottle ? `上次瓶喂 ${fmtTime(recentBottle.start_at)} · ${recentBottle.details.amount_ml} ml` : '现在没有进行中的计时'; recentLine.textContent = recent ? (recent.modified_by && recent.modified_by !== recent.created_by ? `最近更新：${recent.modified_by}（${recent.created_by} 创建） · ${fmtTime(recent.start_at)}` : `最近记录由 ${recent.created_by} 完成 · ${fmtTime(recent.start_at)}`) : '还没有记录'; sub.append(recentLine); } const note = document.createElement('span'); note.className = 'handoff-recency'; note.textContent = recency; sub.append(note); }
const elapsedClock = (e) => { const parts = e.type === 'breast' ? breastIntervals(e) : [{ start_at: e.start_at, end_at: e.end_at }]; const ms = parts.reduce((sum, part) => sum + Math.max(0, Date.parse(part.end_at || new Date().toISOString()) - Date.parse(part.start_at)), 0); const seconds = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
function refreshActionTimers() { document.querySelectorAll('[data-action-clock]').forEach((clock) => { const events = state?.summary?.active?.filter((e) => e.type === clock.dataset.actionClock) || []; if (clock.dataset.actionClock === 'breast') clock.innerHTML = events.map((e, index) => `${index ? '<span class="action-side-sep">·</span>' : ''}<span class="action-side-clock">${esc(e.details.side || '')} ${elapsedClock(e)}</span>`).join(''); else clock.textContent = events[0] ? elapsedClock(events[0]) : ''; }); }
function renderActions() { const activeByType = (type) => state.summary.active.filter((e) => e.type === type); $('#quickActions').innerHTML = Object.entries(labels).filter(([type]) => !['growth', 'vaccine', 'food'].includes(type)).map(([type, [, label]]) => { const active = activeByType(type); const timer = TIMER_TYPES.has(type) && active.length; const hint = type === 'bottle' ? '记录毫升' : type === 'diaper' ? '尿尿或便便' : TIMER_TYPES.has(type) ? (timer ? '进行中' : '开始计时') : '快速保存'; return `<button class="action${timer ? ' is-active' : ''}" data-type="${type}"><span class="symbol icon-${type}">${rasterActionIcon(type)}</span><strong>${label}</strong><small class="action-status">${hint}</small>${timer ? `<span class="action-live"><i class="action-live-dot"></i><span data-action-clock="${type}"></span></span>` : ''}</button>`; }).join(''); document.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { const active = activeByType(b.dataset.type); const current = active[0]; const event = b.dataset.type === 'breast' && active.length ? { ...current, _breastPeers: active } : current; openEvent(current && TIMER_TYPES.has(b.dataset.type) ? 'edit' : b.dataset.type, event || null); })); refreshActionTimers(); clearInterval(renderActions.ticker); renderActions.ticker = setInterval(refreshActionTimers, 1000); }
const breastPeersFor = (e, events = state?.events || []) => { if (!e || e.type !== 'breast') return [e]; const rows = events.filter((x) => x.type === 'breast' && !x.revoked); if (e.details?.session_id) { const session = rows.filter((x) => x.details?.session_id === e.details.session_id); if (session.length > 1) return session; } const active = rows.filter((x) => !x.end_at); if (!e.end_at && active.length > 1) return active; const side = e.details?.side; const nearby = rows.filter((x) => !x.details?.session_id && x.id !== e.id && x.details?.side && x.details.side !== side && x.created_by === e.created_by && (x.note || '') === (e.note || '') && Math.abs(Date.parse(x.start_at) - Date.parse(e.start_at)) <= 10 * 60 * 1000).sort((a, b) => Math.abs(Date.parse(a.start_at) - Date.parse(e.start_at)) - Math.abs(Date.parse(b.start_at) - Date.parse(e.start_at))); return nearby[0] ? [e, nearby[0]] : [e]; };
const timelineEvents = (events) => { const seen = new Set(); const allEvents = state?.events || events; return events.flatMap((e) => { if (seen.has(e.id)) return []; if (e.type !== 'breast') return [e]; const peers = breastPeersFor(e, allEvents); peers.forEach((peer) => seen.add(peer.id)); return peers.length > 1 ? [{ ...e, _breastPeers: peers }] : [e]; }); };
function eventTitle(e) { let extra = ''; const peers = e._breastPeers; if (e.type === 'bottle') extra = `${e.details.kind || '奶'} ${e.details.amount_ml} ml`; if (e.type === 'breast') extra = peers ? peers.map((peer) => `${peer.details.side || ''}侧 ${elapsedClock(peer)}`).join(' · ') : (e.details.side ? `${e.details.side}侧 ${elapsedClock(e)}` : ''); if (e.type === 'diaper') extra = { pee: '仅嘘嘘', poop: '仅便便', both: '嘘嘘 + 便便' }[e.details.kind] || ''; if (e.details.urine_amount) extra += ` · 尿量${e.details.urine_amount}${/^\d+(?:\.\d+)?$/.test(String(e.details.urine_amount)) ? '克' : ''}`; if (e.details.stool_texture) extra += ` · ${e.details.stool_texture}`; if (e.type === 'supplement') extra = `${e.details.name || ''}${e.details.amount_text ? ` · ${e.details.amount_text}` : ''}`; if (e.type === 'growth') extra = Object.entries(e.details).filter(([k, v]) => ['weight_kg', 'length_cm', 'head_cm'].includes(k) && v !== '').map(([k, v]) => `${k === 'weight_kg' ? '体重' : k === 'length_cm' ? '身长' : '头围'} ${v}`).join(' · '); if (e.type === 'vaccine') extra = `${e.details.name || ''} · ${e.details.status === 'completed' ? '已接种' : e.details.status === 'deferred' ? '延期' : '预约'}`; if (e.type === 'food') extra = `${e.details.food_name || ''} · ${e.details.observation || '未观察'}`; if ((e.end_at || (e.type === 'breast' && e.details.paused)) && !peers && !['bottle', 'diaper', 'supplement', 'breast', ...healthTypes].includes(e.type)) extra += `${extra ? ' · ' : ''}${mins(eventDurationMinutes(e))}`; return `${labels[e.type][1]}${extra ? ` · ${extra}` : ''}`; }
function renderTimeline(target, events) { if (!events.length) { target.innerHTML = '<div class="panel muted">还没有记录。按下上面的入口，留下第一条交接信息。</div>'; return; } const rows = timelineEvents(events); target.innerHTML = rows.map((e) => { const peers = e._breastPeers || [e]; const inProgress = peers.some((peer) => !peer.end_at); const sideControls = e.type === 'breast' ? peers.filter((peer) => !peer.end_at).map((peer) => eventControl(peer.details.paused ? 'resume' : 'pause', `${peer.details.side || ''}${peer.details.paused ? '继续' : '暂停'}`, `data-${peer.details.paused ? 'resume' : 'pause'}="${esc(peer.id)}"`)).join('') : ''; const stop = e.type === 'breast' && peers.length > 1 ? (inProgress ? eventControl('stop', '结束', `data-breast-stop="${esc(e.id)}"`) : '') : (!e.end_at ? eventControl('stop', '结束', `data-stop="${esc(e.id)}"`) : ''); const revoke = peers.length > 1 ? eventControl('revoke', '取消', `data-breast-revoke="${esc(e.id)}"`) : eventControl('revoke', '取消', `data-revoke="${esc(e.id)}"`); return `<div class="event-row"><div class="event-time">${esc(fmtTime(e.start_at))}<br><small>${esc(fmtDate(e.start_at))}</small></div><div class="event-main"><strong class="event-title"><span class="event-title-icon">${timelineIcon(e.type)}</span><span>${esc(eventTitle(e))}${inProgress ? ' · 进行中' : ''}</span></strong><small>${esc(e.created_by)}${e.note ? ` · ${esc(e.note)}` : ''}</small></div><div class="event-actions">${sideControls}${stop}${eventControl('edit', '修改', `data-edit="${esc(e.id)}"`)}${revoke}</div></div>`; }).join(''); target.querySelectorAll('[data-pause]').forEach((b) => b.addEventListener('click', () => updateBreastTimer(state.events.find((e) => e.id === b.dataset.pause), 'pause'))); target.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', () => updateBreastTimer(state.events.find((e) => e.id === b.dataset.resume), 'resume'))); target.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('click', () => stopEvent(state.events.find((e) => e.id === b.dataset.stop)))); target.querySelectorAll('[data-breast-stop]').forEach((b) => b.addEventListener('click', () => stopBreastSession(breastPeersFor(state.events.find((e) => e.id === b.dataset.breastStop))))); target.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { const e = state.events.find((x) => x.id === b.dataset.edit); if (healthTypes.has(e.type)) { switchView('health'); document.querySelector(`[data-health-tab="${e.type}"]`).click(); fillHealthForm(e.type, e); } else openEvent('edit', e.type === 'breast' ? { ...e, _breastPeers: breastPeersFor(e) } : e); })); target.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', () => revokeEvent(state.events.find((e) => e.id === b.dataset.revoke)))); target.querySelectorAll('[data-breast-revoke]').forEach((b) => b.addEventListener('click', () => revokeBreastSession(breastPeersFor(state.events.find((e) => e.id === b.dataset.breastRevoke))))); }
 function eventFields(type, e = {}) { const d = e.details || {}; if (type === 'edit') type = e.type; const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19); const start = e.start_at ? new Date(Date.parse(e.start_at) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19) : nowLocal; const end = e.end_at && e.end_at !== e.start_at ? new Date(Date.parse(e.end_at) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19) : ''; let html = `<input type="hidden" name="type" value="${esc(type)}"><label>开始时间<input name="start" type="datetime-local" step="1" value="${esc(start)}" required></label>`; if (TIMER_TYPES.has(type)) html += `<label>结束时间<input name="end" type="datetime-local" step="1" value="${esc(end)}"><span class="muted small">留空即可开始计时</span></label>`; if (type === 'bottle') html += `<label>喂养方式<select name="kind"><option ${d.kind === '配方奶' ? 'selected' : ''}>配方奶</option><option ${d.kind === '母乳冻奶' ? 'selected' : ''}>母乳冻奶</option><option ${d.kind === '奶' ? 'selected' : ''}>奶</option></select></label><label>奶量（ml）<input name="amount" type="number" min="1" max="2000" value="${esc(d.amount_ml || '')}" required></label>`; if (type === 'breast') html += `<label>左右侧（可选）<select name="side"><option value="">不填写</option><option ${d.side === '左' ? 'selected' : ''}>左</option><option ${d.side === '右' ? 'selected' : ''}>右</option><option ${d.side === '双侧' ? 'selected' : ''}>双侧</option></select></label>`; if (type === 'diaper') html += `<label>尿布类型<div class="choice-row">${[['pee', '仅嘘嘘'], ['poop', '仅便便'], ['both', '嘘嘘+便便']].map(([v, t]) => `<button type="button" class="choice ${d.kind === v ? 'selected' : ''}" data-choice="${v}">${t}</button>`).join('')}</div><input type="hidden" name="kind" value="${esc(d.kind || 'pee')}"></label><label>尿量（可选）<select name="urineAmount"><option value="">不填写</option><option ${d.urine_amount === '轻' ? 'selected' : ''}>轻</option><option ${d.urine_amount === '中' ? 'selected' : ''}>中</option><option ${d.urine_amount === '满' ? 'selected' : ''}>满</option></select></label><label>便便性状（可选）<input name="stoolTexture" maxlength="40" value="${esc(d.stool_texture || '')}" placeholder="例如：金黄糊状"></label>`; if (type === 'supplement') html += `<label>补剂名称<input name="name" list="supplementNames" autocomplete="off" spellcheck="false" maxlength="80" value="${esc(d.name || '')}" required></label><label>用量文字<input name="amountText" maxlength="80" value="${esc(d.amount_text || '')}" placeholder="按医生或包装标示记录"></label>`; return html; }
let breastDraft = null;
let breastTicker = null;
const localDateTime = (iso) => iso ? new Date(Date.parse(iso) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19) : new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19);
const breastClock = (side) => { const ms = breastDraft.sides[side].intervals.reduce((sum, part) => sum + Math.max(0, Date.parse(part.end_at || new Date().toISOString()) - Date.parse(part.start_at)), 0); const seconds = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
const breastSideCard = (side, label, minutes) => `<section class="breast-side-card" data-side-card="${side}"><div class="breast-side-head"><strong>${label}</strong><span class="breast-status" data-side-status="${side}">未开始</span></div><div class="breast-elapsed" data-side-elapsed="${side}">00:00</div><button type="button" class="breast-toggle" data-breast-toggle="${side}">${controlIcon('resume')}<span>开始</span></button></section>`;
const breastFields = (e = {}) => { const peers = Array.isArray(e._breastPeers) ? e._breastPeers : (e.id ? [e] : []); const sideEvent = (side) => peers.find((x) => x.details?.side === side); const start = localDateTime(sideEvent('左')?.start_at || sideEvent('右')?.start_at || e.start_at); const leftMinutes = sideEvent('左') ? eventDurationMinutes(sideEvent('左')) : ''; const rightMinutes = sideEvent('右') ? eventDurationMinutes(sideEvent('右')) : ''; return `<div data-breast-form="true"><input type="hidden" name="type" value="breast"><label class="breast-start-field">开始时间<input name="start" type="datetime-local" value="${esc(start)}" required></label><div class="breast-mode" role="tablist" aria-label="亲喂记录方式"><button type="button" class="breast-mode-button active" data-breast-mode="timer">计时</button><button type="button" class="breast-mode-button" data-breast-mode="manual">手动输入</button></div><div class="breast-timer-grid">${breastSideCard('左', '左侧', leftMinutes)}${breastSideCard('右', '右侧', rightMinutes)}</div><div class="breast-manual-panel" hidden><p class="muted small">分别填写左右侧的实际喂奶分钟数</p><div class="breast-manual-grid"><label>左侧（分钟）<input name="leftMinutes" type="number" min="0" max="600" step="1" inputmode="numeric" autocomplete="off" value="${esc(leftMinutes)}" placeholder="0"></label><label>右侧（分钟）<input name="rightMinutes" type="number" min="0" max="600" step="1" inputmode="numeric" autocomplete="off" value="${esc(rightMinutes)}" placeholder="0"></label></div></div><p class="breast-help muted small">左右侧不能同时计时；点击一侧开始或继续，会自动暂停另一侧。</p></div>`; };
const eventFieldsWithBreastSides = (type, e = {}) => { const actualType = type === 'edit' ? e.type : type; if (actualType === 'breast') return breastFields(e); let html = eventFields(type, e); if (actualType === 'diaper') html = html.replace(/<label>尿量（可选）<select name="urineAmount">.*?<\/select><\/label>/, `<label>尿量（克，可选）<input name="urineAmount" type="number" min="0" max="5000" step="1" inputmode="numeric" autocomplete="off" spellcheck="false" value="${esc(e.details?.urine_amount || '')}" placeholder="例如 120"></label>`); return html; };
const localToIso = (value) => value ? new Date(value).toISOString() : null;
const intervalsFromForm = (o, startAt, endAt) => { try { const intervals = JSON.parse(o.intervals || '[]'); if (Array.isArray(intervals) && intervals.length) return intervals; } catch {} return [{ start_at: startAt, end_at: endAt }]; };
function setupBreastForm(e = null) { clearInterval(breastTicker); const peers = Array.isArray(e?._breastPeers) ? e._breastPeers : (e?.id ? [e] : []); const editEvents = Object.fromEntries(peers.filter((x) => ['左', '右'].includes(x.details?.side)).map((x) => [x.details.side, x])); const sideDraft = (side) => { const source = editEvents[side]; const intervals = source ? breastIntervals(source).map((part) => ({ ...part })) : []; return { intervals, paused: source ? Boolean(source.details.paused) : false }; }; breastDraft = { mode: 'timer', editSide: e?.details?.side || '', editEvents, canEnd: !e?.end_at, sessionId: peers.find((x) => x.details?.session_id)?.details.session_id || uid(), sides: { 左: sideDraft('左'), 右: sideDraft('右') } }; const f = $('#eventForm'); f.querySelectorAll('[data-breast-mode]').forEach((b) => b.addEventListener('click', () => { breastDraft.mode = b.dataset.breastMode; f.querySelectorAll('[data-breast-mode]').forEach((x) => x.classList.toggle('active', x === b)); f.querySelector('.breast-timer-grid').hidden = breastDraft.mode !== 'timer'; f.querySelector('.breast-manual-panel').hidden = breastDraft.mode !== 'manual'; })); f.querySelectorAll('[data-breast-toggle]').forEach((b) => b.addEventListener('click', () => { const side = b.dataset.breastToggle; const draft = breastDraft.sides[side]; const other = breastDraft.sides[side === '左' ? '右' : '左']; const active = draft.intervals.find((part) => !part.end_at); const now = new Date().toISOString(); if (active) { active.end_at = now; draft.paused = true; } else { const otherActive = other.intervals.find((part) => !part.end_at); if (otherActive) { otherActive.end_at = now; other.paused = true; } draft.intervals.push({ start_at: now, end_at: null }); draft.paused = false; } refreshBreastCards(); })); breastTicker = setInterval(refreshBreastCards, 1000); refreshBreastCards(); }
function refreshBreastCards() { if (!breastDraft) return; const f = $('#eventForm'); let started = false; for (const side of ['左', '右']) { const draft = breastDraft.sides[side]; const card = f.querySelector(`[data-side-card="${side}"]`); if (!card) return; const active = draft.intervals.some((part) => !part.end_at); const hasTime = draft.intervals.length > 0; started ||= hasTime; card.querySelector('[data-side-elapsed]').textContent = breastClock(side); card.querySelector('[data-side-status]').textContent = active ? '进行中' : hasTime ? '已暂停' : '未开始'; const button = card.querySelector('[data-breast-toggle]'); button.classList.toggle('running', active); button.innerHTML = `${controlIcon(active ? 'pause' : 'resume')}<span>${active ? '暂停' : hasTime ? '继续' : '开始'}</span>`; } $('#endTimerBtn').hidden = !(breastDraft.canEnd && started); }
function stopBreastTicker() { clearInterval(breastTicker); breastTicker = null; breastDraft = null; }
function breastSaveBodies(f, o, finish = false) { const mode = breastDraft?.mode || 'timer'; const note = o.note || ''; const bodies = []; const manual = { 左: Number(o.leftMinutes || 0), 右: Number(o.rightMinutes || 0) }; for (const side of ['左', '右']) { const existingEvent = breastDraft?.editEvents?.[side] || null; let intervals; let endAt = null; if (mode === 'manual') { if (!manual[side]) continue; const startAt = localToIso(o.start); endAt = new Date(Date.parse(startAt) + manual[side] * 60000).toISOString(); intervals = [{ start_at: startAt, end_at: endAt }]; } else { intervals = breastDraft.sides[side].intervals.map((part) => ({ ...part })); if (!intervals.length) continue; if (finish) endAt = new Date().toISOString(); } const startAt = intervals[0].start_at; bodies.push({ eventId: existingEvent?.id || null, body: { type: 'breast', start_at: startAt, end_at: mode === 'manual' ? endAt : finish ? endAt : null, note, details: { side, session_id: breastDraft.sessionId, paused: mode === 'timer' && !intervals.some((part) => !part.end_at), intervals }, ...(existingEvent ? { expectedVersion: Number(existingEvent.version) } : {}) } }); } return bodies; }
async function saveBreastForm(f, finish = false) { const o = formObject(f); if (finish && breastDraft?.mode === 'timer') { const now = new Date().toISOString(); for (const side of ['左', '右']) { const active = breastDraft.sides[side].intervals.find((part) => !part.end_at); if (active) active.end_at = now; breastDraft.sides[side].paused = true; } } const bodies = breastSaveBodies(f, o, finish); if (!bodies.length) { toast('请先开始计时，或填写分钟数'); return; } const submit = f.querySelector('button.primary'); const end = f.querySelector('#endTimerBtn'); submit.disabled = true; if (end) end.disabled = true; try { for (const entry of bodies) { await api(entry.eventId ? `/api/events/${entry.eventId}` : '/api/events', { method: entry.eventId ? 'PATCH' : 'POST', body: JSON.stringify({ ...entry.body, mutationId: uid() }) }); } stopBreastTicker(); $('#eventDialog').close(); await loadState(); toast(finish ? '亲喂已结束并保存' : '亲喂已保存'); } catch (e) { toast(e.message); } finally { submit.disabled = false; if (end) end.disabled = false; } }
async function finishTimerForm(f) { const o = formObject(f); const id = f.dataset.id; if (!id) return toast('请先保存并开始计时'); const startAt = localToIso(o.start); const submit = f.querySelector('button.primary'); const end = f.querySelector('#endTimerBtn'); const body = { type: o.type, start_at: startAt, end_at: new Date().toISOString(), note: o.note || '', details: {}, expectedVersion: Number(f.dataset.version), mutationId: uid() }; submit.disabled = true; if (end) end.disabled = true; try { await api(`/api/events/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); $('#eventDialog').close(); await loadState(); toast('已结束并保存'); } catch (e) { toast(e.message); } finally { submit.disabled = false; if (end) end.disabled = false; } }
function openEvent(type, e = null) { stopBreastTicker(); const actualType = type === 'edit' ? e?.type : type; const isBreast = actualType === 'breast'; const isActiveTimer = TIMER_TYPES.has(actualType) && Boolean(e?.id) && !e?.end_at; $('#dialogTitle').textContent = type === 'edit' ? '修改记录' : labels[type][1]; $('#eventFields').innerHTML = eventFieldsWithBreastSides(type, e || {}); $('#eventForm').dataset.id = e?.id || ''; $('#eventForm').dataset.version = e?.version || ''; $('#eventForm').note.value = e?.note || ''; $('#endTimerBtn').hidden = !(isActiveTimer && !isBreast); $('#eventDialog').showModal(); if (isBreast) setupBreastForm(e); document.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => { document.querySelector('[name=kind]').value = b.dataset.choice; document.querySelectorAll('[data-choice]').forEach((x) => x.classList.toggle('selected', x === b)); })); }
$('#eventForm').addEventListener('submit', (ev) => { const type = ev.currentTarget.querySelector('[name=type]')?.value; const customBreast = ev.currentTarget.querySelector('[data-breast-form]'); const side = ev.currentTarget.querySelector('[name=side]')?.value; if (type === 'breast' && !customBreast && !['左', '右'].includes(side)) { ev.preventDefault(); ev.stopImmediatePropagation(); toast('请先选择左侧或右侧'); } }, true);
$('#eventForm').addEventListener('submit', async (ev) => { ev.preventDefault(); const f = ev.currentTarget; const o = formObject(f); const type = o.type; if (type === 'breast') return saveBreastForm(f); const startAt = localToIso(o.start); const endAt = o.end ? localToIso(o.end) : null; const body = { type, start_at: startAt, end_at: endAt, note: o.note || '', details: type === 'bottle' ? { kind: o.kind, amount_ml: Number(o.amount) } : type === 'diaper' ? { kind: o.kind, urine_amount: o.urineAmount || '', stool_texture: o.stoolTexture || '' } : type === 'supplement' ? { name: o.name, amount_text: o.amountText || '' } : {} }; const id = f.dataset.id; if (id) body.expectedVersion = Number(f.dataset.version); const signature = JSON.stringify({ id, body }); if (signature !== pendingSignature) { pendingSignature = signature; pendingMutationId = uid(); } body.mutationId = pendingMutationId; const submit = f.querySelector('button.primary'); submit.disabled = true; try { await api(id ? `/api/events/${id}` : '/api/events', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }); pendingSignature = ''; pendingMutationId = ''; $('#eventDialog').close(); await loadState(); toast('已保存，下一位照护者能看到了'); } catch (e) { toast(e.message); } finally { submit.disabled = false; } });
const breastTimerBody = (e, action, now = new Date().toISOString(), sessionId = '') => { const intervals = breastIntervals(e).map((part) => ({ ...part })); const active = intervals.find((part) => !part.end_at); if (action === 'pause' && active) active.end_at = now; else if (action === 'resume' && !active) intervals.push({ start_at: now, end_at: null }); else if (action === 'stop' && active) active.end_at = now; return { mutationId: uid(), expectedVersion: e.version, start_at: e.start_at, end_at: action === 'stop' ? now : null, details: { ...e.details, session_id: e.details?.session_id || sessionId || undefined, paused: action === 'pause', intervals }, note: e.note || '' }; };
async function updateBreastTimer(e, action) { if (!e) return; const now = new Date().toISOString(); const peers = action === 'resume' ? breastPeersFor(e) : [e]; const sessionId = peers.find((peer) => peer.details?.session_id)?.details.session_id || e.details?.session_id || uid(); try { await Promise.all(peers.filter((peer) => peer.id !== e.id && !peer.end_at).map((peer) => api(`/api/events/${peer.id}`, { method: 'PATCH', body: JSON.stringify(breastTimerBody(peer, 'pause', now, sessionId)) }))); await api(`/api/events/${e.id}`, { method: 'PATCH', body: JSON.stringify(breastTimerBody(e, action, now, sessionId)) }); await loadState(); toast(action === 'pause' ? '计时已暂停' : action === 'resume' ? '计时已继续，另一侧已暂停' : '亲喂已结束'); } catch (x) { toast(x.message); } }
async function stopBreastSession(peers) { const activePeers = (peers || []).filter((e) => e && !e.end_at); if (!activePeers.length) return; const sessionId = activePeers.find((peer) => peer.details?.session_id)?.details.session_id || uid(); try { await Promise.all(activePeers.map((e) => api(`/api/events/${e.id}`, { method: 'PATCH', body: JSON.stringify(breastTimerBody(e, 'stop', undefined, sessionId)) }))); await loadState(); toast('亲喂已结束'); } catch (x) { toast(x.message); } }
async function stopEvent(e) { if (e?.type === 'breast') return updateBreastTimer(e, 'stop'); try { await api(`/api/events/${e.id}/stop`, { method: 'PATCH', body: JSON.stringify({ mutationId: uid(), expectedVersion: e.version, end_at: new Date().toISOString() }) }); await loadState(); toast('计时已结束'); } catch (x) { toast(x.message); } }
async function revokeEvent(e) { if (!confirm('取消这条记录？它会保留在备份里，但不再计入汇总。')) return; try { await api(`/api/events/${e.id}/revoke`, { method: 'PATCH', body: JSON.stringify({ mutationId: uid(), expectedVersion: e.version }) }); await loadState(); toast('记录已取消'); } catch (x) { toast(x.message); } }
async function revokeBreastSession(peers) { if (!confirm('取消这条亲喂记录？左右两侧都会从汇总中移除。')) return; const rows = (peers || []).filter(Boolean); try { await Promise.all(rows.map((e) => api(`/api/events/${e.id}/revoke`, { method: 'PATCH', body: JSON.stringify({ mutationId: uid(), expectedVersion: e.version }) }))); await loadState(); toast('亲喂记录已取消'); } catch (x) { toast(x.message); } }
$('#setupForm').addEventListener('submit', async (e) => { e.preventDefault(); const b = formObject(e.currentTarget); try { await api('/api/setup', { method: 'POST', body: JSON.stringify({ mutationId: uid(), babyName: b.babyName, birthDate: b.birthDate, gender: b.gender, caregiverName: b.caregiverName, password: b.password }) }); await api('/api/login', { method: 'POST', body: JSON.stringify({ caregiverName: b.caregiverName, password: b.password }) }); await loadState(); showApp(); toast('档案已建立'); } catch (x) { toast(x.message); } });
$('#loginForm').addEventListener('submit', async (e) => { e.preventDefault(); const b = formObject(e.currentTarget); try { await api('/api/login', { method: 'POST', body: JSON.stringify({ caregiverName: b.caregiverName, password: b.password }) }); await loadState(); showApp(); } catch (x) { toast(x.message); } });
$('#closeDialog').addEventListener('click', () => $('#eventDialog').close()); $('#endTimerBtn').addEventListener('click', () => { const f = $('#eventForm'); return f.querySelector('[name=type]')?.value === 'breast' ? saveBreastForm(f, true) : finishTimerForm(f); }); $('#refreshBtn').addEventListener('click', () => loadState().catch((e) => toast(e.message))); $('#historyBtn').addEventListener('click', () => switchView('history')); $('#historyBack').addEventListener('click', () => switchView('home')); $('#logoutBtn').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST', body: '{}' }); showAuth(false); } catch (e) { toast(e.message); } });
function switchView(name) { if (name === "companion") loadStoryLibrary(); if (name === "album") loadLivePhotos().catch(() => {}); if (name !== 'companion') stopSpeech(); document.querySelectorAll('.view').forEach((x) => x.hidden = x.id !== `view-${name}`); document.querySelectorAll('.bottom-nav button[data-view]').forEach((x) => x.classList.toggle('active', x.dataset.view === name)); }
document.querySelectorAll('.bottom-nav [data-view]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
$('#profileForm').addEventListener('input', () => { settingsDirty = true; });
$('#profileForm').addEventListener('submit', async (e) => { e.preventDefault(); const b = formObject(e.currentTarget); try { await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ ...b, mutationId: uid() }) }); settingsDirty = false; await loadState(); toast('档案已保存'); } catch (x) { toast(x.message); } });
$('#exportBtn').addEventListener('click', async () => { try { const data = await api('/api/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = `babymia-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href); } catch (e) { toast(e.message); } });
$('#restoreFile').addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { const backup = JSON.parse(await file.text()); if (prompt('恢复会覆盖当前数据。请输入：覆盖并恢复') !== '覆盖并恢复') return; await api('/api/restore', { method: 'POST', body: JSON.stringify({ ...backup, mutationId: uid(), confirm: '覆盖并恢复' }) }); settingsDirty = false; state = null; showAuth(false); toast('备份已恢复，请重新登录'); } catch (x) { toast(x.message); } e.target.value = ''; });
const { bands: interactionBands } = window.BABYMIA_COMPANION;
let stories = []; let storyLibraryLoaded = false; let storyLibraryLoading = false;
const officialResources = [{ title: 'Super Simple Songs 官方歌曲', url: 'https://supersimple.com/super-simple-songs/', description: '官方歌曲与动作歌页面' }, { title: 'UNICEF Baby tips', url: 'https://www.unicef.org/parenting/child-development/baby-tips', description: '按月龄的亲子互动提示' }];
let selectedActivityBand = null;
let storyIndex = 0; let storySegmentIndex = 0; let speechBusy = false; let aiPreview = null; let aiGenerateMutationId = '';
const currentStory = () => stories[storyIndex];
$("#storySelect").innerHTML = stories.map((s, i) => '<option value="' + i + '">' + esc(s.title) + " · " + s.segments.length + " 段</option>").join("");
$("#storySelect").addEventListener("change", e => { stopSpeech(); storyIndex = Number(e.target.value); storySegmentIndex = 0; renderStory(); });
function renderStory() { const story = currentStory();
$("#storySelect").innerHTML = stories.map((s, i) => '<option value="' + i + '">' + esc(s.title) + " · " + s.segments.length + " 段</option>").join("");
for (const id of ["storyEdit", "storyDelete", "storyExport", "storySpeak", "storyStop", "storySelect"]) $("#" + id).disabled = !story;
if (!story) { $("#storyTitle").textContent = storyLibraryLoaded ? "故事库还是空的" : "正在读取故事库"; $("#storySubtitle").textContent = "可以新增故事，或导入故事文件。"; $("#storySegments").replaceChildren(); $("#storyCount").textContent = "0 / 0"; $("#storyPrev").disabled = true; $("#storyNext").disabled = true; return; }
storySegmentIndex = Math.min(storySegmentIndex, story.segments.length - 1); const segment = story.segments[storySegmentIndex]; $('#storyTitle').textContent = story.title; $('#storySubtitle').textContent = story.subtitle; $('#storyCount').textContent = `${storySegmentIndex + 1} / ${story.segments.length}`; const box = $('#storySegments'); box.replaceChildren(); const zh = document.createElement('p'); zh.className = 'story-zh'; zh.textContent = segment.zh; const en = document.createElement('p'); en.className = 'story-en'; en.textContent = segment.en; const prompt = document.createElement('p'); prompt.className = 'story-prompt'; prompt.textContent = segment.prompt ? '一起读 · ' + segment.prompt : ''; box.append(zh, en); if (segment.prompt) box.append(prompt); $('#storySelect').value = String(storyIndex); $('#storyPrev').disabled = storySegmentIndex === 0; $('#storyNext').disabled = storySegmentIndex === story.segments.length - 1; }
function stopSpeech() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); speechBusy = false; $('#storySpeak').textContent = '朗读这一段'; }
function speakStory() { if (!currentStory()) return; stopSpeech(); if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') { $('#voiceFallback').hidden = false; return; } const segment = currentStory().segments[storySegmentIndex]; const zh = new SpeechSynthesisUtterance(segment.zh); zh.lang = 'zh-CN'; const en = new SpeechSynthesisUtterance(segment.en); en.lang = 'en-US'; const fail = () => { speechBusy = false; $('#voiceFallback').hidden = false; $('#storySpeak').textContent = '朗读这一段'; }; zh.onerror = fail; en.onerror = fail; en.onend = () => { speechBusy = false; $('#storySpeak').textContent = '朗读这一段'; }; speechBusy = true; $('#storySpeak').textContent = '正在朗读…'; window.speechSynthesis.speak(zh); zh.onend = () => { if (speechBusy) window.speechSynthesis.speak(en); }; }
function renderOfficialResources() { const box = $('#officialResources'); box.replaceChildren(); for (const resource of officialResources) { const card = document.createElement('article'); card.className = 'resource-card'; const title = document.createElement('strong'); title.textContent = resource.title; const desc = document.createElement('small'); desc.textContent = resource.description; const actions = document.createElement('div'); actions.className = 'resource-actions'; const link = document.createElement('a'); link.href = resource.url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = '打开官方页面'; const favorite = document.createElement('button'); favorite.type = 'button'; favorite.className = 'mini'; favorite.textContent = '收藏'; favorite.addEventListener('click', () => fillFavorite({ title: resource.title, url: resource.url, kind: 'official' })); actions.append(link, favorite); card.append(title, desc, actions); box.append(card); } }
function resetFavorite() { const form = $('#favoriteForm'); form.reset(); form.elements.id.value = ''; form.elements.version.value = ''; $('#favoriteCancel').hidden = true; }
function fillFavorite(item) { const form = $('#favoriteForm'); form.elements.id.value = item.id || ''; form.elements.version.value = item.version || ''; form.elements.title.value = item.title || ''; form.elements.url.value = item.url || ''; form.elements.kind.value = item.kind || 'other'; $('#favoriteCancel').hidden = !item.id; form.scrollIntoView({ behavior: 'smooth', block: 'center' }); form.elements.title.focus(); }
function renderFavorites() { const box = $('#favoriteList'); box.replaceChildren(); const favorites = state?.favorites || []; if (!favorites.length) { const empty = document.createElement('p'); empty.className = 'muted small'; empty.textContent = '还没有收藏链接。'; box.append(empty); return; } for (const item of favorites) { const row = document.createElement('div'); row.className = 'favorite-row'; const main = document.createElement('div'); const link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = item.title; const meta = document.createElement('small'); meta.textContent = `${item.kind === 'official' ? '官方资源' : item.kind === 'story' ? '故事' : '其他'} · ${new URL(item.url).host}`; main.append(link, meta); const actions = document.createElement('div'); actions.className = 'event-actions'; const edit = document.createElement('button'); edit.className = 'mini'; edit.type = 'button'; edit.textContent = '修改'; edit.addEventListener('click', () => fillFavorite(item)); const remove = document.createElement('button'); remove.className = 'mini'; remove.type = 'button'; remove.textContent = '删除'; remove.addEventListener('click', async () => { if (!confirm('删除这个收藏？')) return; try { await api(`/api/favorites/${item.id}`, { method: 'DELETE', body: JSON.stringify({ mutationId: uid(), expectedVersion: item.version }) }); await loadState(); toast('收藏已删除'); } catch (e) { toast(e.message); } }); actions.append(edit, remove); row.append(main, actions); box.append(row); } }
function ageMonthsNumber(birthDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate || "")) return null;
  const [year, month, day] = birthDate.split("-").map(Number);
  const today = shanghaiDateParts();
  const current = Number(today.year) * 10000 + Number(today.month) * 100 + Number(today.day);
  if (year * 10000 + month * 100 + day > current) return null;
  return Math.max(0, (Number(today.year) - year) * 12 + Number(today.month) - month - (Number(today.day) < day ? 1 : 0));
}
function renderInteractions() {
  const months = ageMonthsNumber(state?.profile?.birth_date);
  const current = months === null ? null : interactionBands.find(b => months >= b.min && months < b.max);
  const band = selectedActivityBand === null ? current : interactionBands.find(b => b.min === selectedActivityBand);
  const select = $("#activityAge");
  select.innerHTML = '<option value="current">跟随档案月龄</option>' + interactionBands.map(b => '<option value="' + b.min + '">浏览 ' + esc(b.label) + '</option>').join("");
  select.value = selectedActivityBand === null ? "current" : String(selectedActivityBand);
  $("#activityAgeLabel").textContent = months === null ? "请在设置中完善出生日期" : "档案月龄 · " + months + " 个月";
  $("#activityMode").textContent = selectedActivityBand === null ? "按出生日期计算；选择与宝宝当前能力相符的玩法。" : "正在浏览其他阶段，未更改档案，也不代表宝宝已适合这些动作。";
  $("#activityReturn").hidden = selectedActivityBand === null;
  const box = $("#interactionCards");
  const opened = new Set([...box.querySelectorAll("details[open]")].map(d => d.dataset.title));
  box.replaceChildren();
  if (!band) {
    $("#activityFocus").textContent = months === null ? "先确定月龄，再选择适合的活动" : "当前内容覆盖出生至未满 24 个月";
    $("#activityAbilities").replaceChildren();
    $("#activityPace").textContent = "可以选择月龄浏览内容。早产或有特殊健康情况时，请与儿保医生确认适用月龄和活动。";
    $("#activitySource").hidden = true; return;
  }
  $("#activityFocus").textContent = band.focus;
  $("#activityAbilities").innerHTML = band.abilities.map(x => "<span>" + esc(x) + "</span>").join("");
  $("#activityPace").textContent = band.min < 12 ? "分散到清醒、舒适的片刻，每次先短一点，跟随宝宝反应。WHO 建议未能移动的婴儿每天累计至少 30 分钟清醒俯卧活动，分多次进行；逐渐适应，不强撑、不一次做完。" : "把活动穿插进日常生活。WHO 建议 1–2 岁每天累计至少 180 分钟多种身体活动，分散进行，包括走动和玩耍，不是连续训练。";
  band.activities.forEach((activity, index) => {
    const card = document.createElement("details"); card.className = "activity-card"; card.dataset.title = activity.title;
    card.open = opened.size ? opened.has(activity.title) : index === 0;
    card.innerHTML = '<summary><span class="activity-kind">' + esc(activity.kind) + '</span><strong>' + esc(activity.title) + '</strong><span class="activity-goal">练习 · ' + esc(activity.goal) + '</span><span class="activity-expand" aria-hidden="true">＋</span></summary>' +
      '<div class="activity-body"><p><b>什么时候适合</b>' + esc(activity.ready) + '</p><b>陪宝宝这样做</b><ol>' + activity.steps.map(s => "<li>" + esc(s) + "</li>").join("") + '</ol><p><b>观察与调整</b>' + esc(activity.observe) + '</p><p class="activity-safety"><b>注意</b>' + esc(activity.safety) + '</p></div>';
    box.append(card);
  });
  const source = $("#activitySource"); source.hidden = false; source.href = band.source; source.textContent = band.sourceLabel + " · 查看分龄活动依据";
}
$("#activityAge").addEventListener("change", e => { selectedActivityBand = e.target.value === "current" ? null : Number(e.target.value); $("#interactionCards").replaceChildren(); renderInteractions(); });
$("#activityReturn").addEventListener("click", () => { selectedActivityBand = null; $("#interactionCards").replaceChildren(); renderInteractions(); });
function renderAiPreview(result) { aiPreview = result; aiGenerateMutationId = uid(); const p = result.provider || {}; $('#aiProviderStatus').textContent = p.configured ? `服务已配置：${p.model || '模型'}${p.endpointHost ? ` · ${p.endpointHost}` : ''}。点击“手动生成”后才会请求服务。` : 'AI 服务未配置或 endpoint 不受支持；可以继续查看预览，手动生成按钮会保持禁用。'; const snapshot = result.snapshot; const preview = $('#aiPreview'); preview.replaceChildren(); preview.hidden = false; const heading = document.createElement('strong'); heading.textContent = `将使用 ${snapshot.returned_events} 条日常记录（${snapshot.range.start} 至 ${snapshot.range.end}）`; const detail = document.createElement('p'); detail.className = 'muted small'; const typeNames = { bottle: '瓶喂', breast: '亲喂', sleep: '睡眠', diaper: '尿布', supplement: '补剂', play: '玩耍', outing: '外出' }; detail.textContent = `类型：${snapshot.types.map((type) => typeNames[type]).join('、')}。已排除姓名、署名、备注与健康记录。${snapshot.truncated ? `共有 ${snapshot.total_events} 条，预览上限返回 ${snapshot.returned_events} 条。` : ''} 捕获于 ${snapshot.captured_at || '刚刚'}`; preview.append(heading, detail); const disclosure = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = `展开查看脱敏明细（${snapshot.returned_events} 条）`; disclosure.append(summary); const list = document.createElement('div'); list.className = 'ai-event-list'; for (const event of snapshot.events) { const row = document.createElement('div'); row.className = 'ai-event-item'; row.textContent = `${typeNames[event.type] || event.type} · ${event.start_at}${event.end_at ? ` → ${event.end_at}` : ' · 进行中'} · ${event.duration_seconds} 秒 · ${JSON.stringify(event.details || {})}`; list.append(row); } disclosure.append(list); preview.append(disclosure); const generate = $('#aiGenerateBtn'); generate.hidden = false; generate.disabled = !p.configured; generate.title = p.configured ? '' : '服务器尚未配置 AI 服务'; $('#aiResult').hidden = true; }
let mediaInspectItems = [];
const mediaInspectBytes = value => { const n = Number(value || 0); if (n < 1024) return n + ' B'; if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB'; return (n / (1024 * 1024)).toFixed(1) + ' MB'; };
function mediaInspectSignal(label, state, detail) { const cell = document.createElement('span'); cell.className = 'media-signal-cell ' + state; const strong = document.createElement('strong'); strong.textContent = label; const small = document.createElement('small'); small.textContent = detail; cell.append(strong, small); return cell; }
function mediaInspectConclusion() {
  const completed = mediaInspectItems.filter(item => item.result); const errors = mediaInspectItems.filter(item => item.error); const pending = mediaInspectItems.some(item => ['waiting', 'uploading'].includes(item.status)); const summary = $('#mediaInspectSummary');
  if (!mediaInspectItems.length) { summary.textContent = '等待选择样本'; summary.dataset.state = 'plain'; return; }
  if (pending) { summary.textContent = `正在检查 ${mediaInspectItems.length} 个文件；检测期间请保持页面打开。`; summary.dataset.state = 'working'; return; }
  const motion = completed.find(item => item.result.motion?.detected); const suspected = completed.find(item => item.result.motion?.suspected); const images = completed.filter(item => item.result.kind === 'image'); const videos = completed.filter(item => item.result.kind === 'video');
  summary.dataset.state = motion ? 'success' : suspected || (images.length && videos.length) ? 'possible' : errors.length === mediaInspectItems.length ? 'error' : 'plain';
  if (motion) summary.textContent = '已确认：浏览器保留了 Motion Photo 的静态封面和内嵌动态视频。';
  else if (suspected) summary.textContent = '发现内嵌媒体片段，可能是非标准动态照片；需要用该样本继续适配。';
  else if (images.length && videos.length) summary.textContent = `浏览器交出了 ${images.length} 个图片文件和 ${videos.length} 个视频文件，具备配对式 Live Photo 的条件。`;
  else if (images.length) summary.textContent = '只收到静态图片，没有发现动态片段；当前选择路径可能丢失了 Live 内容。';
  else if (videos.length) summary.textContent = '只收到独立视频，没有同时收到静态封面。';
  else summary.textContent = errors.length ? '文件没有完成检测，请查看下方原因。' : '等待选择样本';
}
function renderMediaInspectItems() {
  const list = $('#mediaInspectList'); list.replaceChildren(); $('#mediaInspectClear').hidden = !mediaInspectItems.length;
  for (const item of mediaInspectItems) {
    const result = item.result; const row = document.createElement('article'); row.className = 'media-inspect-row'; row.dataset.state = item.status;
    const head = document.createElement('div'); head.className = 'media-inspect-head'; const mark = document.createElement('span'); mark.className = 'media-file-mark'; mark.textContent = result?.kind === 'video' ? '▶' : result?.kind === 'image' ? '▧' : '…'; const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = item.file.name; const meta = document.createElement('small'); meta.textContent = `${item.file.type || '浏览器未提供类型'} · ${mediaInspectBytes(item.file.size)}`; copy.append(title, meta); const status = document.createElement('b'); status.textContent = item.status === 'waiting' ? '等待' : item.status === 'uploading' ? '分析中' : item.status === 'done' ? result.format : '未完成'; head.append(mark, copy, status);
    const signal = document.createElement('div'); signal.className = 'media-signal'; const stillState = result ? (result.kind === 'image' ? 'on' : 'off') : 'pending'; const motionState = result ? (result.motion?.detected ? 'on' : result.motion?.suspected || result.kind === 'video' ? 'possible' : 'off') : 'pending'; signal.append(mediaInspectSignal('静态封面', stillState, result ? (result.kind === 'image' ? '已收到' : '未收到') : '等待检测'), mediaInspectSignal('动态片段', motionState, result ? (result.motion?.detected ? '已内嵌' : result.motion?.suspected ? '疑似内嵌' : result.kind === 'video' ? '独立视频' : '未发现') : '等待检测'));
    const note = document.createElement('p'); note.className = 'media-inspect-note'; note.textContent = item.error || result?.conclusion || (item.status === 'uploading' ? '正在把样本发送到当前 NAS 服务…' : '等待检测'); row.append(head, signal, note); list.append(row);
  }
  mediaInspectConclusion();
}
async function inspectMediaSelection(files) {
  mediaInspectItems = files.slice(0, 6).map(file => ({ file, status: file.size > 128 * 1024 * 1024 ? 'error' : 'waiting', error: file.size > 128 * 1024 * 1024 ? '文件超过 128 MB，没有发送。' : '' })); renderMediaInspectItems();
  const input = $('#mediaInspectInput'); input.disabled = true;
  for (const item of mediaInspectItems) {
    if (item.error) continue;
    item.status = 'uploading'; renderMediaInspectItems();
    const query = new URLSearchParams({ name: item.file.name, type: item.file.type || '', modified: item.file.lastModified ? new Date(item.file.lastModified).toISOString() : '' });
    try { item.result = await api('/api/media/inspect?' + query, { method: 'POST', body: item.file, headers: { 'content-type': 'application/octet-stream' } }); item.status = 'done'; }
    catch (error) { item.status = 'error'; item.error = error.message; }
    renderMediaInspectItems();
  }
  input.disabled = false; input.value = '';
}
$('#mediaInspectInput').addEventListener('change', event => { const files = [...event.target.files]; if (!files.length) return; if (files.length > 6) toast('一次只检测前 6 个文件'); inspectMediaSelection(files); });
$('#mediaInspectClear').addEventListener('click', () => { mediaInspectItems = []; renderMediaInspectItems(); });
let nativeLivePhotoReady = false;
let nativeLivePhotoRestoreReady = false;
function setupNativeLivePhoto() {
  nativeLivePhotoReady = typeof window.BabyMiaNative?.selectLivePhoto === 'function';
  nativeLivePhotoRestoreReady = typeof window.BabyMiaNative?.restoreLivePhoto === 'function';
  $('#nativeLivePhotoPanel').hidden = !nativeLivePhotoReady;
}
let albumViewerItems=[]; let albumViewerIndex=0; let albumViewerStartX=null;
function renderAlbumViewer() {
  const item=albumViewerItems[albumViewerIndex]; if(!item) return;
  const image=$('#albumViewerImage'); image.src=item.url; image.alt=item.caption||'家庭照片原图';
  $('#albumViewerCaption').textContent=item.caption||'家庭照片';
  $('#albumViewerCounter').textContent=albumViewerItems.length>1 ? (albumViewerIndex+1)+' / '+albumViewerItems.length : '';
  $('#albumViewerDownload').href=item.url+'?download=1';
  const single=albumViewerItems.length<2; $('#albumViewerPrev').hidden=single; $('#albumViewerNext').hidden=single;
}
function openAlbumViewer(items, index=0) {
  albumViewerItems=items.filter(Boolean); if(!albumViewerItems.length) return;
  albumViewerIndex=Math.min(Math.max(0,index),albumViewerItems.length-1); renderAlbumViewer(); $('#albumViewer').showModal();
}
function stepAlbumViewer(delta) {
  if(albumViewerItems.length<2) return;
  albumViewerIndex=(albumViewerIndex+delta+albumViewerItems.length)%albumViewerItems.length; renderAlbumViewer();
}
function closeAlbumViewer() {
  const viewer=$('#albumViewer'); viewer.close(); $('#albumViewerImage').removeAttribute('src'); albumViewerItems=[]; albumViewerIndex=0; albumViewerStartX=null;
}
$('#albumViewerClose').addEventListener('click',closeAlbumViewer);
$('#albumViewerPrev').addEventListener('click',()=>stepAlbumViewer(-1));
$('#albumViewerNext').addEventListener('click',()=>stepAlbumViewer(1));
$('#albumViewer').addEventListener('click',(event)=>{ if(event.target===$('#albumViewer')) closeAlbumViewer(); });
$('#albumViewerStage').addEventListener('pointerdown',(event)=>{ if(event.pointerType!=='mouse') albumViewerStartX=event.clientX; });
$('#albumViewerStage').addEventListener('pointerup',(event)=>{ if(albumViewerStartX===null) return; const distance=event.clientX-albumViewerStartX; albumViewerStartX=null; if(Math.abs(distance)>=45) stepAlbumViewer(distance<0?1:-1); });
$('#albumViewerStage').addEventListener('pointercancel',()=>{ albumViewerStartX=null; });
document.addEventListener('keydown',(event)=>{ if(!$('#albumViewer').open) return; if(event.key==='ArrowLeft') stepAlbumViewer(-1); if(event.key==='ArrowRight') stepAlbumViewer(1); });
function albumMediaTile(item, viewerItems=[], viewerIndex=-1) {
  const tile = document.createElement('div'); tile.className = 'album-media-tile';
  const badge = document.createElement('span'); badge.className = 'live-photo-badge';
  if (item.kind === 'live-photo') {
    const image = document.createElement('img'); image.src = item.imageUrl; image.alt = item.filename || 'Live Photo'; image.loading = 'lazy';
    const video = document.createElement('video'); video.src = item.videoUrl; video.muted = true; video.playsInline = true; video.preload = 'metadata'; video.hidden = true;
    const stop = () => { video.pause(); video.currentTime = 0; video.hidden = true; image.hidden = false; };
    const play = () => { image.hidden = true; video.hidden = false; video.currentTime = 0; video.play().catch(stop); };
    tile.addEventListener('pointerdown', play); ['pointerup','pointercancel','pointerleave'].forEach((name) => tile.addEventListener(name, stop));
    badge.textContent = 'LIVE'; tile.append(image, video, badge);
  } else if (item.kind === 'video') {
    const video = document.createElement('video'); video.src = item.mediaUrl; video.controls = true; video.playsInline = true; video.preload = 'metadata';
    badge.textContent = '视频'; tile.append(video, badge);
  } else {
    const image = document.createElement('img'); image.src = item.mediaUrl; image.alt = item.filename || '家庭照片'; image.loading = 'lazy'; image.tabIndex=0; image.setAttribute('role','button'); image.setAttribute('aria-label','查看原尺寸图片');
    const open=()=>openAlbumViewer(viewerItems,viewerIndex); image.addEventListener('click',open); image.addEventListener('keydown',(event)=>{ if(event.key==='Enter'||event.key===' '){ event.preventDefault(); open(); } }); tile.append(image);
  }
  if (item.kind === 'live-photo') {
    const view=document.createElement('button'); view.type='button'; view.className='album-view-original'; view.textContent='查看原图';
    view.addEventListener('pointerdown',(event)=>event.stopPropagation()); view.addEventListener('click',(event)=>{ event.stopPropagation(); openAlbumViewer(viewerItems,viewerIndex); }); tile.append(view);
  }
  if (item.kind === 'live-photo' && nativeLivePhotoRestoreReady) {
    const restore=document.createElement('button'); restore.type='button'; restore.className='album-restore-live'; restore.textContent='保存动态照片';
    ['pointerdown','pointerup','pointercancel'].forEach((name)=>restore.addEventListener(name,(event)=>event.stopPropagation()));
    restore.addEventListener('click',(event)=>{ event.stopPropagation(); try { window.BabyMiaNative.restoreLivePhoto(item.id); } catch { toast('原生保存入口暂不可用'); } });
    tile.append(restore);
  }
  const links = document.createElement('div'); links.className = 'album-media-downloads';
  const downloads = item.kind === 'live-photo' ? (nativeLivePhotoRestoreReady ? [] : [['JPG',item.imageUrl],['MP4',item.videoUrl]]) : [['原件',item.mediaUrl]];
  for (const [label,url] of downloads) { const link=document.createElement('a'); link.textContent=label; link.href=url+'?download=1'; links.append(link); }
  if (links.childElementCount) tile.append(links); return tile;
}
function albumDateParts(value) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  return Object.fromEntries(parts.filter((x)=>x.type!=='literal').map((x)=>[x.type,x.value]));
}
function albumDayKey(value) { const p=albumDateParts(value); return p.year+'-'+p.month+'-'+p.day; }
function albumDayLabel(value) {
  const key=albumDayKey(value); const today=albumDayKey(new Date()); const yesterday=albumDayKey(new Date(Date.now()-86400000));
  if (key===today) return '今天'; if (key===yesterday) return '昨天';
  const p=albumDateParts(value); return Number(p.month)+'月'+Number(p.day)+'日';
}
function albumEntryTime(value) { return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)); }
function albumFullDayLabel(value) { const p=albumDateParts(value); return p.year+'年'+Number(p.month)+'月'+Number(p.day)+'日'; }
function groupAlbumItems(items) {
  const batches=new Map();
  for (const item of items) {
    const key=item.batchId || ('legacy-'+item.kind+'-'+item.id);
    if (!batches.has(key)) batches.set(key,{id:key,description:item.description||'',createdBy:item.createdBy||'',createdAt:item.createdAt,items:[]});
    const entry=batches.get(key); entry.items.push(item);
    if (String(item.createdAt)>String(entry.createdAt)) entry.createdAt=item.createdAt;
    if (!entry.description && item.description) entry.description=item.description;
  }
  return [...batches.values()].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
function albumEntryCard(entry) {
  const card=document.createElement('article'); card.className='album-entry';
  const media=document.createElement('div'); media.className='album-entry-media album-entry-count-'+Math.min(entry.items.length,4);
  const viewerItems=entry.items.filter((item)=>item.kind!=='video').map((item)=>({id:item.id,url:item.kind==='live-photo'?item.imageUrl:item.mediaUrl,caption:item.filename||'家庭照片'}));
  entry.items.forEach((item)=>media.append(albumMediaTile(item,viewerItems,viewerItems.findIndex((viewer)=>viewer.id===item.id))));
  const body=document.createElement('div'); body.className='album-entry-body';
  if (entry.description) { const description=document.createElement('p'); description.className='album-entry-description'; description.textContent=entry.description; body.append(description); }
  const footer=document.createElement('div'); footer.className='album-entry-footer';
  const author=document.createElement('span'); author.textContent=entry.createdBy || '家人';
  const time=document.createElement('time'); time.dateTime=entry.createdAt; time.textContent=albumDayLabel(entry.createdAt)+' '+albumEntryTime(entry.createdAt);
  footer.append(author,time); body.append(footer); card.append(media,body); return card;
}
function renderAlbumTimeline(items) {
  const list=$('#livePhotoList'); list.replaceChildren(); const days=new Map();
  for (const entry of groupAlbumItems(items)) { const key=albumDayKey(entry.createdAt); if (!days.has(key)) days.set(key,[]); days.get(key).push(entry); }
  for (const [dayKey,entries] of days) {
    const section=document.createElement('section'); section.className='album-day'; section.dataset.day=dayKey;
    const heading=document.createElement('header'); heading.className='album-day-heading';
    const label=document.createElement('div'); label.className='album-day-label';
    const title=document.createElement('h3'); title.textContent=albumDayLabel(entries[0].createdAt);
    const date=document.createElement('time'); date.className='album-day-date'; date.dateTime=dayKey; date.textContent=albumFullDayLabel(entries[0].createdAt);
    const count=document.createElement('span'); count.textContent=entries.length+' 条记录';
    label.append(title,date); heading.append(label,count); section.append(heading,...entries.map(albumEntryCard)); list.append(section);
  }
}
async function loadLivePhotos() {
  if (!state) return;
  const status=$('#livePhotoStatus'); status.textContent='正在读取家庭相册…';
  try {
    const data=await api('/api/family-media'); const items=data.items||[]; renderAlbumTimeline(items);
    const counts={photo:0,video:0,'live-photo':0}; items.forEach((item)=>{ if (counts[item.kind] !== undefined) counts[item.kind] += 1; });
    const entries=groupAlbumItems(items).length;
    status.textContent=items.length ? entries+' 条记录 · '+counts.photo+' 张照片 · '+counts.video+' 个视频 · '+counts['live-photo']+' 个 Live Photo' : '相册还是空的，先上传今天的第一张照片。';
  } catch(error) { status.textContent=error.message; }
}
let albumPendingFiles=[]; let albumPendingUrls=[];
function clearAlbumComposer() {
  albumPendingUrls.forEach((url)=>URL.revokeObjectURL(url)); albumPendingUrls=[]; albumPendingFiles=[];
  $('#albumPendingPreview').replaceChildren(); $('#familyMediaDescription').value=''; $('#familyMediaInput').value='';
  $('#albumComposer').hidden=true; $('#albumComposerCount').textContent=''; $('#familyMediaUploadStatus').textContent='';
}
function stageAlbumFiles(files) {
  clearAlbumComposer(); albumPendingFiles=files.slice(0,6); albumPendingUrls=albumPendingFiles.map((file)=>URL.createObjectURL(file));
  const preview=$('#albumPendingPreview');
  albumPendingFiles.forEach((file,index)=>{
    const item=document.createElement('figure'); item.className='album-pending-item';
    const media=file.type.startsWith('video/')?document.createElement('video'):document.createElement('img');
    media.src=albumPendingUrls[index]; if(media.tagName==='VIDEO'){ media.muted=true; media.playsInline=true; media.preload='metadata'; } else media.alt=file.name;
    const name=document.createElement('figcaption'); name.textContent=file.name; item.append(media,name); preview.append(item);
  });
  $('#albumComposerCount').textContent=albumPendingFiles.length+' 项'; $('#albumComposer').hidden=false; $('#familyMediaDescription').focus();
}
async function uploadFamilyMedia(files) {
  const selected=files.slice(0,6); const status=$('#familyMediaUploadStatus'); const input=$('#familyMediaInput'); const save=$('#albumComposerSave');
  input.disabled=true; save.disabled=true; const batchId=uid(); const description=$('#familyMediaDescription').value.trim(); let done=0;
  try {
    for (const file of selected) {
      status.textContent='正在上传 '+file.name+'（'+(done+1)+' / '+selected.length+'）';
      const form=new FormData(); form.append('file',file,file.name); form.append('batchId',batchId); form.append('description',description);
      const result=await api('/api/family-media',{method:'POST',body:form});
      done += 1; status.textContent=result.duplicate ? file.name+' 已在相册中' : '已保存 '+file.name;
    }
    clearAlbumComposer(); await loadLivePhotos(); toast('这一刻已保存');
  } catch(error) { status.textContent='上传未完成：'+error.message; toast(error.message); }
  finally { input.disabled=false; save.disabled=false; }
}
$('#familyMediaInput').addEventListener('change',(event)=>{ const files=[...event.target.files]; if (!files.length) return; if(files.length>6) toast('一次只选择前 6 个文件'); stageAlbumFiles(files); });
$('#albumComposerCancel').addEventListener('click',clearAlbumComposer);
$('#albumComposerSave').addEventListener('click',()=>{ if(!albumPendingFiles.length) return; uploadFamilyMedia([...albumPendingFiles]); });
$('#nativeLivePhotoUpload').addEventListener('click', () => { try { window.BabyMiaNative.selectLivePhoto(); } catch { toast('原生上传入口暂不可用'); } });
$('#nativeServerConfig').addEventListener('click', () => { try { window.BabyMiaNative.configureServer(); } catch { toast('服务器设置暂不可用'); } });
$('#livePhotoRefresh').addEventListener('click', () => loadLivePhotos());
window.addEventListener('babymia:live-photo-uploaded', (event) => { const detail=event.detail||{}; toast(detail.message||(detail.success?'Live Photo 已上传':'Live Photo 上传失败')); if(detail.success) loadLivePhotos(); });
window.addEventListener('babymia:live-photo-restored', (event) => { const detail=event.detail||{}; toast(detail.message||(detail.success?'Live Photo 已保存到系统相册':'Live Photo 保存失败')); });
setupNativeLivePhoto();
let videoItems = []; let videoCurrentId = ""; let videoIndex = -1; let videoLibraryLoaded = false; let videoLibraryLoading = false;
const videoBytes = value => { const n = Number(value || 0); if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " KB"; return (n / (1024 * 1024)).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1) + " MB"; };
const videoDate = value => { try { return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(new Date(value)); } catch { return ""; } };
function renderVideos() {
  const list = $("#videoList"); list.replaceChildren(); const player = $("#videoPlayer"); const empty = $("#videoEmpty"); const now = $("#videoNow");
  const selected = videoItems.findIndex(item => item.id === videoCurrentId); videoIndex = selected;
  empty.hidden = videoItems.length > 0 || selected >= 0; player.hidden = selected < 0; now.hidden = selected < 0;
  if (selected >= 0) { const item = videoItems[selected]; $("#videoTitle").textContent = item.title; $("#videoMeta").textContent = videoBytes(item.size_bytes) + (item.updated_at ? " · 更新于 " + videoDate(item.updated_at) : ""); }
  if (!videoItems.length) { $("#videoLibraryStatus").textContent = "目录中没有 MP4。当前目录：" + videoDirectoryHint + "。把文件放入后刷新列表。"; return; }
  for (const [index, item] of videoItems.entries()) {
    const row = document.createElement("div"); row.className = "video-row" + (item.id === videoCurrentId ? " selected" : "");
    const button = document.createElement("button"); button.type = "button"; button.className = "video-row-main"; button.setAttribute("aria-pressed", String(item.id === videoCurrentId));
    const title = document.createElement("strong"); title.textContent = item.title; const meta = document.createElement("small"); meta.textContent = videoBytes(item.size_bytes) + (item.updated_at ? " · " + videoDate(item.updated_at) : "");
    const mark = document.createElement("span"); mark.className = "video-row-mark"; mark.textContent = item.id === videoCurrentId ? "正在播放" : "播放"; button.append(mark, title, meta); button.addEventListener("click", () => selectVideo(index, true)); row.append(button); list.append(row);
  }
  $("#videoLibraryStatus").textContent = "已发现 " + videoItems.length + " 个 MP4 · 目录：" + (videoDirectoryHint || "DATA_DIR/videos");
}
let videoDirectoryHint = "DATA_DIR/videos";
async function loadVideoLibrary() {
  if (videoLibraryLoading) return false; videoLibraryLoading = true;
  try { const result = await api("/api/videos"); videoItems = Array.isArray(result.videos) ? result.videos : []; videoDirectoryHint = result.directory_hint || "DATA_DIR/videos"; videoLibraryLoaded = true; if (!videoItems.some(item => item.id === videoCurrentId)) { videoCurrentId = ""; videoIndex = -1; $("#videoPlayer").removeAttribute("src"); $("#videoPlayer").load(); } renderVideos(); return true; }
  catch (e) { $("#videoLibraryStatus").textContent = "视频列表读取失败：" + e.message + "。"; return false; }
  finally { videoLibraryLoading = false; }
}
function selectVideo(index, autoplay = false) {
  const item = videoItems[index]; if (!item) return; const player = $("#videoPlayer"); videoIndex = index; videoCurrentId = item.id; player.src = item.stream; player.load(); renderVideos();
  if (autoplay) { const promise = player.play(); promise?.catch(() => { $("#videoLibraryStatus").textContent = "已选择《" + item.title + "》，请点击播放器开始。"; }); }
}
$("#videoRefresh").addEventListener("click", () => loadVideoLibrary());
$("#videoStop").addEventListener("click", () => { const player = $("#videoPlayer"); player.pause(); player.currentTime = 0; $("#videoLibraryStatus").textContent = "已停止播放 · " + (videoItems[videoIndex]?.title || ""); });
$("#videoPlayer").addEventListener("ended", () => { if (videoIndex + 1 < videoItems.length) selectVideo(videoIndex + 1, true); else $("#videoLibraryStatus").textContent = "已播放到列表末尾"; });
$("#videoPlayer").addEventListener("error", () => { if (videoCurrentId) $("#videoLibraryStatus").textContent = "这个文件无法播放，请确认是 MP4（H.264 视频 + AAC 音频）。"; });
function renderCompanion() { if (!storyLibraryLoaded) loadStoryLibrary(); if (!videoLibraryLoaded) loadVideoLibrary(); renderStory(); renderOfficialResources(); renderFavorites(); renderInteractions(); }
$('#storyPrev').addEventListener('click', () => { if (storySegmentIndex > 0) storySegmentIndex -= 1; stopSpeech(); renderStory(); }); $('#storyNext').addEventListener('click', () => { if (currentStory() && storySegmentIndex < currentStory().segments.length - 1) storySegmentIndex += 1; stopSpeech(); renderStory(); }); $('#storySpeak').addEventListener('click', speakStory); $('#storyStop').addEventListener('click', stopSpeech); $('#favoriteCancel').addEventListener('click', resetFavorite);
$('#favoriteForm').addEventListener('submit', async (e) => { e.preventDefault(); const form = e.currentTarget; const submit = form.querySelector('button.primary'); const values = formObject(form); const id = values.id; const body = { mutationId: uid(), url: values.url, title: values.title, kind: values.kind }; if (id) body.expectedVersion = Number(values.version); submit.disabled = true; try { await api(id ? `/api/favorites/${id}` : '/api/favorites', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }); resetFavorite(); await loadState(); toast('收藏已保存'); } catch (x) { toast(x.message); } finally { submit.disabled = false; } });
const aiForm = $('#aiForm'); const todayShanghai = () => { const p = shanghaiDateParts(); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; }; aiForm.elements.startDate.value = todayShanghai(); aiForm.elements.endDate.value = todayShanghai();
let aiPreviewRevision = 0;
const clearAiPreview = () => { aiPreviewRevision += 1; aiPreview = null; aiGenerateMutationId = ''; $('#aiPreview').hidden = true; $('#aiGenerateBtn').hidden = true; $('#aiGenerateBtn').disabled = false; $('#aiResult').hidden = true; $('#aiResult').textContent = ''; $('#aiProviderStatus').textContent = ''; };
aiForm.addEventListener('input', clearAiPreview);
$('#aiPreviewBtn').addEventListener('click', async (e) => { e.preventDefault(); const values = formObject(aiForm); const types = [...aiForm.querySelectorAll('input[name="types"]:checked')].map((input) => input.value); if (!types.length) return toast('至少选择一种记录类型'); const revision = aiPreviewRevision; const button = e.currentTarget; button.disabled = true; try { const result = await api('/api/ai/preview', { method: 'POST', body: JSON.stringify({ mutationId: uid(), startDate: values.startDate, endDate: values.endDate, types }) }); if (revision !== aiPreviewRevision) return; renderAiPreview(result); toast('预览已生成，请检查后再决定'); } catch (x) { toast(x.message); } finally { button.disabled = false; } });
$('#aiGenerateBtn').addEventListener('click', async (e) => { if (!aiPreview?.snapshotHash) return toast('请先预览数据'); const previewHash = aiPreview.snapshotHash; const button = e.currentTarget; button.disabled = true; $('#aiResult').hidden = false; $('#aiResult').textContent = '正在请求已配置的 AI 服务…'; try { const result = await api('/api/ai/generate', { method: 'POST', body: JSON.stringify({ mutationId: aiGenerateMutationId || uid(), snapshotHash: aiPreview.snapshotHash }) }); if (aiPreview?.snapshotHash !== previewHash) return; $('#aiResult').textContent = result.text; toast('摘要已生成'); } catch (x) { if (aiPreview?.snapshotHash !== previewHash) return; $('#aiResult').textContent = `未生成：${x.message}`; toast(x.message); } finally { button.disabled = !aiPreview?.provider?.configured; } });
async function loadStoryLibrary(preferredId) {
  if (storyLibraryLoading) return false;
  storyLibraryLoading = true;
  try {
    const old = currentStory(); const result = await api("/api/stories");
    stories = result.stories; storyLibraryLoaded = true;
    const selected = stories.findIndex(s => s.id === (preferredId || old?.id)); storyIndex = Math.max(0, selected);
    if (old?.id !== currentStory()?.id || old?.version !== currentStory()?.version) { stopSpeech(); storySegmentIndex = 0; }
    $("#storyLibraryStatus").textContent = "故事库 · " + stories.length + " 篇 · 保存在家庭数据中"; renderStory(); return true;
  } catch (e) { $("#storyLibraryStatus").textContent = "故事库未更新：" + e.message + "。可点击页面刷新重试。"; return false; }
  finally { storyLibraryLoading = false; }
}
$("#companionRefresh").addEventListener("click", () => loadStoryLibrary());
let editingStory = null; let storyDraftDirty = false; let storySaving = false;
let storyPendingSignature = ""; let storyPendingId = "";
function storyRequestBody(path, value) { const signature = JSON.stringify({ path, value }); if (signature !== storyPendingSignature) { storyPendingSignature = signature; storyPendingId = uid(); } return { ...value, mutationId: storyPendingId }; }
function storyDraftRows() { return [...$("#storyEditorSegments").children].map(row => ({ zh: row.querySelector("[name=zh]").value, en: row.querySelector("[name=en]").value, prompt: row.querySelector("[name=prompt]").value })); }
function renderStoryDraft(rows) {
  $("#storyEditorSegments").innerHTML = rows.map((s, i) => '<section class="story-draft-row"><div class="story-draft-head"><strong>第 ' + (i + 1) + ' 段</strong><div><button type="button" data-move="-1" ' + (i === 0 ? "disabled" : "") + '>上移</button><button type="button" data-move="1" ' + (i === rows.length - 1 ? "disabled" : "") + '>下移</button><button type="button" data-remove="1" ' + (rows.length === 1 ? "disabled" : "") + '>删除段落</button></div></div><label>中文<textarea name="zh" rows="4" maxlength="4000" required>' + esc(s.zh) + '</textarea></label><label>English<textarea name="en" lang="en" rows="4" maxlength="6000" required>' + esc(s.en) + '</textarea></label><label>共读提示（可选）<textarea name="prompt" rows="2" maxlength="500">' + esc(s.prompt) + "</textarea></label></section>").join("");
  $("#storySegmentAdd").disabled = rows.length >= 50;
}
function openStoryEditor(story) {
  editingStory = story ? { id: story.id, version: story.version } : null; storyDraftDirty = false;
  $("#storyEditorTitle").textContent = story ? "编辑故事" : "新增故事";
  $("#storyForm").elements.title.value = story?.title || ""; $("#storyForm").elements.subtitle.value = story?.subtitle || "";
  $("#storyEditorError").textContent = ""; renderStoryDraft(story?.segments || [{ zh: "", en: "", prompt: "" }]); $("#storyEditor").showModal();
}
$("#storyAdd").addEventListener("click", () => openStoryEditor(null));
$("#storyEdit").addEventListener("click", () => { if (currentStory()) openStoryEditor(currentStory()); });
$("#storyForm").addEventListener("input", () => { storyDraftDirty = true; });
function closeStoryEditor() { if (storySaving) return; if (!storyDraftDirty || confirm("放弃尚未保存的故事修改？")) $("#storyEditor").close(); }
$("#storyEditorClose").addEventListener("click", closeStoryEditor);
$("#storyEditor").addEventListener("cancel", e => { e.preventDefault(); closeStoryEditor(); });
$("#storySegmentAdd").addEventListener("click", () => { const rows = storyDraftRows(); if (rows.length < 50) { rows.push({ zh: "", en: "", prompt: "" }); renderStoryDraft(rows); storyDraftDirty = true; $("#storyEditorSegments").lastElementChild.querySelector("textarea").focus(); } });
$("#storyEditorSegments").addEventListener("click", e => {
  const button = e.target.closest("button"); if (!button) return;
  const rows = storyDraftRows(), index = [...$("#storyEditorSegments").children].indexOf(button.closest("section"));
  if (button.dataset.remove && rows.length > 1) { if ((rows[index].zh || rows[index].en || rows[index].prompt) && !confirm("删除这一段尚未保存的内容？")) return; rows.splice(index, 1); }
  else if (button.dataset.move) { const target = index + Number(button.dataset.move); if (target < 0 || target >= rows.length) return; [rows[index], rows[target]] = [rows[target], rows[index]]; }
  renderStoryDraft(rows); storyDraftDirty = true;
});
$("#storyForm").addEventListener("submit", async e => {
  e.preventDefault(); if (storySaving) return;
  const form = e.currentTarget; const value = { title: form.elements.title.value, subtitle: form.elements.subtitle.value, segments: storyDraftRows() };
  if (editingStory) value.expectedVersion = editingStory.version;
  const path = editingStory ? "/api/stories/" + editingStory.id : "/api/stories"; storySaving = true;
  $("#storyEditorFields").disabled = true; $("#storySave").disabled = true; $("#storyEditorError").textContent = "";
  try { const result = await api(path, { method: editingStory ? "PATCH" : "POST", body: JSON.stringify(storyRequestBody(path, value)) }); storyPendingSignature = ""; storyDraftDirty = false; $("#storyEditor").close(); await loadStoryLibrary(result.story.id); toast("故事已保存"); }
  catch (e) { $("#storyEditorError").textContent = e.message + "。编辑内容已保留。"; }
  finally { storySaving = false; $("#storyEditorFields").disabled = false; $("#storySave").disabled = false; }
});
$("#storyDelete").addEventListener("click", async e => {
  const story = currentStory(); if (!story || !confirm("从家庭故事库删除《" + story.title + "》？")) return;
  const button = e.currentTarget; button.disabled = true;
  try { await api("/api/stories/" + story.id, { method: "DELETE", body: JSON.stringify(storyRequestBody("/api/stories/" + story.id, { expectedVersion: story.version })) }); storyPendingSignature = ""; stopSpeech(); await loadStoryLibrary(); toast("故事已删除"); } catch (e) { toast(e.message); } finally { button.disabled = !currentStory(); }
});
function downloadStoryPack(storyList, name) {
  const clean = storyList.map(({ title, subtitle, segments }) => ({ title, subtitle, segments }));
  const url = URL.createObjectURL(new Blob([JSON.stringify({ format: "babymia-stories", version: 1, stories: clean }, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#storyExport").addEventListener("click", () => { if (currentStory()) downloadStoryPack([currentStory()], "babymia-story.json"); });
$("#storyTemplate").addEventListener("click", () => downloadStoryPack([{ title: "请填写故事标题", subtitle: "可选简介", segments: [{ zh: "第一段中文内容。", en: "The first paragraph in English.", prompt: "可选共读提示" }] }], "babymia-story-template.json"));
let storyImportPack = null; let storyImportRevision = 0;
$("#storyImportFile").addEventListener("change", async e => {
  const revision = ++storyImportRevision; storyImportPack = null; $("#storyImportConfirm").hidden = true; $("#storyImportPreview").hidden = true;
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024) throw Error("文件不能超过 4 MB");
    const pack = JSON.parse(await file.text()); if (revision !== storyImportRevision) return;
    if (pack.format !== "babymia-stories" || pack.version !== 1 || !Array.isArray(pack.stories) || !pack.stories.length || pack.stories.length > 20) throw Error("请选择故事包 v1，一次 1–20 篇；可先下载模板");
    for (const s of pack.stories) if (!s || typeof s.title !== "string" || !s.title.trim() || !Array.isArray(s.segments) || !s.segments.length || s.segments.length > 50 || s.segments.some(p => !p || typeof p.zh !== "string" || !p.zh.trim() || typeof p.en !== "string" || !p.en.trim())) throw Error("每篇需有标题，每段需同时填写中文和英文");
    storyImportPack = pack; $("#storyImportPreview").textContent = "将追加 " + pack.stories.length + " 篇：\n" + pack.stories.map(s => "《" + s.title + "》 · " + s.segments.length + " 段").join("\n");
    $("#storyImportPreview").hidden = false; $("#storyImportConfirm").hidden = false;
  } catch (err) { if (revision !== storyImportRevision) return; $("#storyImportPreview").textContent = err.message; $("#storyImportPreview").hidden = false; }
});
$("#storyImportConfirm").addEventListener("click", async e => {
  if (!storyImportPack) return; const button = e.currentTarget; button.disabled = true; $("#storyImportFile").disabled = true;
  try { const result = await api("/api/stories/import", { method: "POST", body: JSON.stringify(storyRequestBody("/api/stories/import", storyImportPack)) }); storyPendingSignature = ""; storyImportPack = null; button.hidden = true; $("#storyImportFile").value = ""; $("#storyImportPreview").textContent = "已导入 " + result.stories.length + " 篇故事"; await loadStoryLibrary(result.stories[0].id); toast("故事已导入"); } catch (e) { toast(e.message); } finally { button.disabled = false; $("#storyImportFile").disabled = false; }
});
const healthTypes = new Set(['growth', 'vaccine', 'food']);
let selectedGrowthMetric = 'weight';
const healthPending = new Map();
const healthNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const dateToIso = (value) => value ? new Date(`${value}T00:00:00+08:00`).toISOString() : null;
const isoToDate = (value) => value ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(value)) : '';
const healthForm = (type) => $(`#${type}Form`);
const healthEvent = (type, id) => (state.health?.[type] || []).find((event) => event.id === id);
const resetHealthForm = (type) => { const form = healthForm(type); form.reset(); form.elements.namedItem('id').value = ''; form.elements.namedItem('version').value = ''; if (type === 'growth') form.elements.namedItem('start').value = healthNow(); if (type === 'food') form.elements.namedItem('start').value = healthNow(); document.querySelector(`[data-health-cancel="${type}"]`).hidden = true; };
const fillHealthForm = (type, event) => {
  const f = healthForm(type); const field = (name) => f.elements.namedItem(name); const d = event.details || {}; field('id').value = event.id; field('version').value = event.version; document.querySelector(`[data-health-cancel="${type}"]`).hidden = false;
  if (type === 'growth') { field('start').value = new Date(Date.parse(event.start_at) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16); field('weight_kg').value = d.weight_kg || ''; field('length_cm').value = d.length_cm || ''; field('head_cm').value = d.head_cm || ''; field('note').value = event.note || ''; }
  if (type === 'vaccine') { for (const key of ['name', 'dose', 'category', 'status', 'original_appointment_date', 'appointment_date', 'actual_date', 'clinic', 'brand_batch', 'observation']) field(key).value = d[key] ?? ''; field('note').value = event.note || ''; }
  if (type === 'food') { field('food_name').value = d.food_name || ''; field('start').value = new Date(Date.parse(event.start_at) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16); field('amount_text').value = d.amount_text || ''; field('texture').value = d.texture || ''; field('first_try').checked = Boolean(d.first_try); field('observation').value = d.observation || '未观察'; field('reaction_at').value = d.reaction_at ? new Date(Date.parse(d.reaction_at) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''; field('reaction_desc').value = d.reaction_desc || ''; field('note').value = event.note || ''; }
};
const healthBody = (type, f) => {
  const o = formObject(f); let start; let details;
  if (type === 'growth') { start = localToIso(o.start); details = { weight_kg: o.weight_kg, length_cm: o.length_cm, head_cm: o.head_cm }; }
  if (type === 'food') { start = localToIso(o.start); details = { food_name: o.food_name, amount_text: o.amount_text, texture: o.texture, first_try: Boolean(f.first_try.checked), observation: o.observation, reaction_at: localToIso(o.reaction_at), reaction_desc: o.reaction_desc }; }
  if (type === 'vaccine') { const date = o.status === 'completed' ? o.actual_date : o.appointment_date; start = dateToIso(date); details = { name: o.name, dose: Number(o.dose), category: o.category, status: o.status, original_appointment_date: o.original_appointment_date, appointment_date: o.appointment_date, actual_date: o.actual_date, next_appointment_date: o.status === 'deferred' ? o.appointment_date : '', clinic: o.clinic, brand_batch: o.brand_batch, observation: o.observation }; }
  return { type, start_at: start, end_at: start, note: o.note || '', details, ...(o.id ? { expectedVersion: Number(o.version) } : {}) };
};
async function saveHealth(type) {
  const f = healthForm(type); const body = healthBody(type, f); const id = f.elements.namedItem('id').value; const signature = JSON.stringify({ id, body }); const pending = healthPending.get(type); if (!pending || pending.signature !== signature) healthPending.set(type, { signature, mutationId: uid() }); body.mutationId = healthPending.get(type).mutationId; const button = f.querySelector('button.primary'); button.disabled = true;
  try { await api(id ? `/api/events/${id}` : '/api/events', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }); healthPending.delete(type); resetHealthForm(type); await loadState(); toast('健康记录已保存'); } catch (e) { toast(e.message); } finally { button.disabled = false; }
}
function chartSvg(metric, events) {
  const reference = state.reference; const table = reference?.tables?.[metric]; const sex = state.profile.gender === '男' ? 'boys' : state.profile.gender === '女' ? 'girls' : '';
  if (!table || !sex) return `<div class="muted">${sex ? '暂无适用参考数据' : '请先在档案中补充性别，才会显示百分位参考'}</div>`;
  const rows = table[sex] || []; if (!rows.length) return '<div class="muted">暂无适用参考数据（当前日龄可能超出 0–730 日）</div>'; const zs = [-1.8808, -1.0364, 0, 1.0364, 1.8808]; const labels = ['P3', 'P15', 'P50', 'P85', 'P97']; const samples = rows.filter((r) => r[0] % 10 === 0); const vals = samples.map((r) => zs.map((z) => Math.abs(r[1]) < 1e-8 ? r[2] * Math.exp(r[3] * z) : r[2] * Math.pow(Math.max(0.001, 1 + r[1] * r[3] * z), 1 / r[1]))); const key = metric === 'weight' ? 'weight_kg' : metric === 'length' ? 'length_cm' : 'head_cm'; const points = events.flatMap((e) => { const d = e.growth?.age_days; const raw = e.details?.[key]; const v = raw === '' || raw === null || raw === undefined ? NaN : Number(raw); return Number.isInteger(d) && Number.isFinite(v) && d >= 0 && d <= 730 ? [[d, v]] : []; }); const all = vals.flat().concat(points.map((x) => x[1])); const min = Math.min(...all) * .9; const max = Math.max(...all) * 1.05; const x = (d) => 52 + d / 730 * 548; const y = (v) => 206 - (v - min) / (max - min || 1) * 170; const paths = zs.map((_, i) => `<path d="${samples.map((r, j) => `${j ? 'L' : 'M'}${x(r[0]).toFixed(1)},${y(vals[j][i]).toFixed(1)}`).join(' ')}" class="growth-line line-${i}"/>`).join(''); const dots = points.map(([d, v]) => `<circle cx="${x(d).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" class="growth-point"><title>${d}日 ${v}</title></circle>`).join(''); const ticks = [0, 1, 2, 3].map((i) => { const value = min + (max - min) * i / 3; return `<line x1="46" y1="${y(value).toFixed(1)}" x2="52" y2="${y(value).toFixed(1)}" class="axis"/><text x="2" y="${(y(value) + 4).toFixed(1)}">${value.toFixed(1)}</text>`; }).join(''); return `<svg class="growth-chart" viewBox="0 0 620 240" role="img" aria-label="WHO 生长参考曲线">${ticks}<line x1="52" y1="206" x2="600" y2="206" class="axis"/><line x1="52" y1="36" x2="52" y2="206" class="axis"/>${paths}${dots}<text x="54" y="225">0日</text><text x="562" y="225">730日</text><text x="58" y="30">${metric === 'weight' ? 'kg' : 'cm'}</text></svg><div class="chart-legend">${labels.map((label, i) => `<span class="legend-${i}">${label}</span>`).join('　')}　·　参考：WHO Child Growth Standards</div>`;
}
function renderHealth() {
  if (!state.health) return; const growth = state.health.growth || []; const metrics = [['weight', '体重'], ['length', '卧位身长'], ['head', '头围']]; const unavailable = growth.some((e) => e.growth?.age_days < 0 || e.growth?.age_days > 730 || Object.values(e.growth?.scores || {}).some((score) => !score.available)); $('#growthSummary').innerHTML = `<div class="chart-switch">${metrics.map(([key, label]) => `<button type="button" class="choice ${key === selectedGrowthMetric ? 'selected' : ''}" data-chart-metric="${key}">${label}</button>`).join('')}</div><div id="growthChart">${chartSvg(selectedGrowthMetric, growth)}</div><p class="muted small">${esc(state.reference?.source || 'WHO Child Growth Standards')} · 按上海自然日期计算日龄${unavailable ? ' · 某些测量暂无适用参考，不外推' : ''}</p>`; $('#growthList').innerHTML = growth.length ? growth.map((e) => `<div class="event-row"><div class="event-time">${esc(fmtDate(e.start_at))}<br><small>${e.growth?.age_days ?? '—'}日龄</small></div><div class="event-main"><strong>⌁ ${esc(Object.entries(e.details).filter(([k, v]) => ['weight_kg', 'length_cm', 'head_cm'].includes(k) && v !== '').map(([k, v]) => `${k === 'weight_kg' ? '体重' : k === 'length_cm' ? '身长' : '头围'} ${v}`).join(' · '))}</strong><small>${esc(Object.entries(e.growth?.scores || {}).map(([k, v]) => `${k === 'weight' ? '体重' : k === 'length' ? '身长' : '头围'} ${v.percentile ? percentileDisplay(v.percentile) : '无适用参考'}`).join(' · '))}</small></div><div class="event-actions">${eventControl('edit', '修改', `data-health-edit="growth" data-id="${esc(e.id)}"`)}${eventControl('revoke', '取消', `data-health-revoke="${esc(e.id)}"`)}</div></div>`).join('') : '<div class="panel muted">还没有生长测量。</div>';
  const vaccines = state.health.vaccine || []; const vaccineOrder = { planned: 0, completed: 1, deferred: 2 }; vaccines.sort((a, b) => vaccineOrder[a.details.status] - vaccineOrder[b.details.status] || Date.parse(a.start_at) - Date.parse(b.start_at)); $('#vaccineList').innerHTML = vaccines.length ? vaccines.map((e) => `<div class="event-row"><div class="event-time">${esc(isoToDate(e.start_at))}</div><div class="event-main"><strong>＋ ${esc(e.details.name)} · 第${e.details.dose}剂</strong><small>${esc({ planned: '即将预约', completed: '已接种', deferred: '延期' }[e.details.status] || '')}${e.details.original_appointment_date ? ` · 原预约 ${esc(e.details.original_appointment_date)}` : ''}</small></div><div class="event-actions">${eventControl('edit', '修改', `data-health-edit="vaccine" data-id="${esc(e.id)}"`)}${eventControl('revoke', '取消', `data-health-revoke="${esc(e.id)}"`)}</div></div>`).join('') : '<div class="panel muted">还没有疫苗记录。</div>';
  const filter = ($('#foodFilter')?.value || '').trim().toLowerCase(); const foods = (state.health.food || []).filter((e) => !filter || e.details.food_name.toLowerCase().includes(filter)); $('#foodList').innerHTML = foods.length ? foods.map((e) => `<div class="event-row"><div class="event-time">${esc(fmtDate(e.start_at))}<br><small>${esc(fmtTime(e.start_at))}</small></div><div class="event-main"><strong>◇ ${esc(e.details.food_name)}${e.details.first_try ? ' · 首次' : ''}</strong><small>${esc(e.details.observation)}${e.details.reaction_desc ? ` · ${esc(e.details.reaction_desc)}` : ''}</small></div><div class="event-actions">${eventControl('edit', '修改', `data-health-edit="food" data-id="${esc(e.id)}"`)}${eventControl('revoke', '取消', `data-health-revoke="${esc(e.id)}"`)}</div></div>`).join('') : '<div class="panel muted">没有匹配的辅食记录。</div>';
  document.querySelectorAll('[data-chart-metric]').forEach((b) => b.addEventListener('click', () => { selectedGrowthMetric = b.dataset.chartMetric; renderHealth(); }));
  document.querySelectorAll('[data-health-edit]').forEach((b) => b.addEventListener('click', () => fillHealthForm(b.dataset.healthEdit, healthEvent(b.dataset.healthEdit, b.dataset.id))));
  document.querySelectorAll('[data-health-revoke]').forEach((b) => b.addEventListener('click', () => revokeEvent(healthEvent(b.parentElement.querySelector('[data-health-edit]').dataset.healthEdit, b.dataset.healthRevoke))));
}
document.querySelectorAll('[data-health-tab]').forEach((b) => b.addEventListener('click', () => { document.querySelectorAll('[data-health-tab]').forEach((x) => x.classList.toggle('active', x === b)); document.querySelectorAll('[data-health-panel]').forEach((x) => { x.hidden = x.dataset.healthPanel !== b.dataset.healthTab; }); }));
for (const type of ['growth', 'vaccine', 'food']) { healthForm(type).addEventListener('submit', (e) => { e.preventDefault(); saveHealth(type); }); document.querySelector(`[data-health-cancel="${type}"]`).addEventListener('click', () => resetHealthForm(type)); resetHealthForm(type); }
$('#healthRefresh').addEventListener('click', () => loadState().catch((e) => toast(e.message)));
$('#foodFilter').addEventListener('input', () => renderHealth());
setInterval(() => state && loadState().catch(() => { if (navigator.onLine === false) toast('网络未连接，记录表单仍保留'); }), 30000); boot();
