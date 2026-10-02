import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { scoreMeasurement } from './growth.mjs';
import { createStoryStore } from './story-store.mjs';
import { createAppUpdateStore } from './app-update-store.mjs';
import { DatabaseSync } from 'node:sqlite';
const storyDb = new DatabaseSync(":memory:");
const seedFixture = [{ title: "初始", segments: [{ zh: "初始内容", en: "Seed" }] }];
let storyStoreFixture = createStoryStore(storyDb, seedFixture);
const initialStory = storyStoreFixture.list()[0];
storyStoreFixture.update(initialStory.id, { title: "家庭修改", segments: initialStory.segments, expectedVersion: 1 });
storyStoreFixture = createStoryStore(storyDb, seedFixture); assert.equal(storyStoreFixture.list()[0].title, "家庭修改");
storyStoreFixture.remove(initialStory.id, { expectedVersion: 2 });
assert.equal(createStoryStore(storyDb, seedFixture).list().length, 0); storyDb.close();
const whoReference = JSON.parse(await readFile(new URL('./reference/who-growth.json', import.meta.url), 'utf8'));
const whoChecks = JSON.parse(await readFile(new URL('./reference/who-checks.json', import.meta.url), 'utf8'));
for (const check of whoChecks) {
  const rows = whoReference.tables[check.metric][check.sex]; const row = rows[check.day]; assert.equal(row[0], check.day);
  const median = scoreMeasurement(whoReference, check.sex === 'girls' ? '女' : '男', check.metric, check.median, check.day); assert.ok(Math.abs(median.z) < 0.002, `${check.metric}/${check.sex}/${check.day} median z`);
  const sd1 = scoreMeasurement(whoReference, check.sex === 'girls' ? '女' : '男', check.metric, check.sd1, check.day); assert.ok(Math.abs(sd1.z - 1) < 0.002, `${check.metric}/${check.sex}/${check.day} sd1 z`);
}

const dir = await mkdtemp(join(tmpdir(), 'babymia-')); const port = 18995 + Math.floor(Math.random() * 300); const mockPort = 19995 + Math.floor(Math.random() * 300); let mockCalls = 0; let mockPayloads = [];
const fakeApk = Buffer.from('fake-signed-babymia-apk');
const updateStore = createAppUpdateStore({
  directory: join(dir, 'app-updates'),
  releaseApiUrl: 'https://updates.test/releases/latest',
  fetchImpl: async (url) => url === 'https://updates.test/releases/latest'
    ? new Response(JSON.stringify({ tag_name:'android-v3.11', body:'versionCode: 11\n\nUpdater bootstrap', published_at:'2026-10-02T00:00:00Z', assets:[{ name:'BabyMia-3.11-release.apk', browser_download_url:'https://updates.test/BabyMia.apk' }] }), { status:200, headers:{'content-type':'application/json'} })
    : new Response(fakeApk, { status:200, headers:{'content-type':'application/vnd.android.package-archive'} }),
  clock: () => new Date('2026-10-02T01:00:00Z'),
});
const syncedUpdate = await updateStore.sync(); assert.equal(syncedUpdate.versionCode, 11); assert.equal(syncedUpdate.versionName, '3.11'); assert.equal((await updateStore.latest()).size, fakeApk.length);
await mkdir(join(dir, 'videos'), { recursive: true }); await writeFile(join(dir, 'videos', 'sss-test.mp4'), Buffer.from('fake-mp4-content'));
let mockMode = "ok";
const mockServer = createServer(async (request, response) => { let raw = ''; for await (const chunk of request) raw += chunk; mockCalls += 1; try { mockPayloads.push(JSON.parse(raw)); } catch {} if (mockMode === 'timeout') { await new Promise(resolve => setTimeout(resolve, 1200)); }
if (mockMode === 'http') { response.writeHead(503); response.end('unavailable'); return; }
if (mockMode === 'json') { response.end('invalid json'); return; }
response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: '已根据预览记录整理：请继续交接。' } }] })); }); await new Promise((resolve) => mockServer.listen(mockPort, '127.0.0.1', resolve));
const child = spawn(process.execPath, ['server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), DATA_DIR: dir, ANDROID_UPDATE_ENABLED:'false', AI_ENDPOINT: `http://127.0.0.1:${mockPort}/v1/chat/completions`, AI_API_KEY: 'local-mock-key', AI_MODEL: 'local-mock', AI_TIMEOUT_MS: '1000' }, stdio: ['ignore','pipe','pipe'] });
let output = ''; child.stdout.on('data', (x) => { output += x; }); child.stderr.on('data', (x) => { output += x; });
const base = `http://127.0.0.1:${port}`; const wait = async () => { for (let i=0;i<50;i++) { try { if ((await fetch(`${base}/api/status`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 50)); } throw new Error(`服务未启动 ${output}`); }; await wait();
let cookie = ''; const req = async (path, body, method = 'POST', extra = {}) => { const res = await fetch(base + path, { method, headers: { ...(body ? {'content-type':'application/json'} : {}), origin: base, cookie, ...extra }, body: body ? JSON.stringify(body) : undefined }); const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]; const data = await res.json(); return { res, data }; };
try {
  const updateCheck = await fetch(base + '/api/app-update/latest?versionCode=10'); assert.equal(updateCheck.status, 200); const updateJson = await updateCheck.json(); assert.equal(updateJson.available, true); assert.equal(updateJson.latest.versionCode, 11); assert.equal(updateJson.latest.downloadUrl, '/api/app-update/apk');
  const updateDownload = await fetch(base + '/api/app-update/apk'); assert.equal(updateDownload.status, 200); assert.equal(updateDownload.headers.get('content-type'), 'application/vnd.android.package-archive'); assert.deepEqual(Buffer.from(await updateDownload.arrayBuffer()), fakeApk);
  const currentCheck = await fetch(base + '/api/app-update/latest?versionCode=11'); assert.equal((await currentCheck.json()).available, false);
  const setup = { mutationId: randomUUID(), babyName:'米娅', birthDate:'2026-05-01', caregiverName:'妈妈', password:'family-pass-8' };
  const [a,b] = await Promise.all([req('/api/setup', setup), req('/api/setup', { ...setup, mutationId: randomUUID() })]); assert.equal([a.res.status,b.res.status].sort((x,y)=>x-y).join(','), '201,409');
  const login = await req('/api/login', { caregiverName:'妈妈', password: setup.password }); assert.equal(login.res.status, 200); const momCookie = cookie;
  const videoList = await req('/api/videos', null, 'GET'); assert.equal(videoList.res.status, 200); assert.equal(videoList.data.videos.length, 1); assert.equal(videoList.data.directory_hint, 'DATA_DIR/videos');
  const videoUrl = base + '/api/videos/' + encodeURIComponent('sss-test.mp4') + '/stream';
  const videoRange = await fetch(videoUrl, { headers: { origin: base, cookie, range: 'bytes=5-9' } }); assert.equal(videoRange.status, 206); assert.equal(videoRange.headers.get('content-range'), 'bytes 5-9/16'); assert.equal(Buffer.from(await videoRange.arrayBuffer()).toString(), 'mp4-c');
  const videoHead = await fetch(videoUrl, { method: 'HEAD', headers: { origin: base, cookie } }); assert.equal(videoHead.status, 200); assert.equal(videoHead.headers.get('content-length'), '16');
  const videoTraversal = await fetch(base + '/api/videos/' + encodeURIComponent('../server.mjs') + '/stream', { headers: { origin: base, cookie } }); assert.equal(videoTraversal.status, 404);
  const motionFixture = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.from('<x:xmpmeta Camera:MotionPhoto="1"><Container:Directory>video</Container:Directory></x:xmpmeta>'), Buffer.from([0, 0, 0, 16]), Buffer.from('ftypisom'), Buffer.alloc(4)]);
  const motionResponse = await fetch(base + '/api/media/inspect?name=vivo-live.jpg&type=image%2Fjpeg', { method: 'POST', headers: { origin: base, cookie, 'content-type': 'application/octet-stream' }, body: motionFixture });
  assert.equal(motionResponse.status, 200); const motionInspection = await motionResponse.json(); assert.equal(motionInspection.persisted, false); assert.equal(motionInspection.format, 'JPEG'); assert.equal(motionInspection.kind, 'image'); assert.equal(motionInspection.motion.detected, true); assert.equal(motionInspection.motion.embedded_video, true); assert.equal(motionInspection.file.size_bytes, motionFixture.length);
  const vivoId = '0123456789abcdef0123456789ab';
  const vivoImage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.from(`{"com.android.camera.livephoto":"${vivoId}"}`)]);
  const vivoVideo = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.from(`vivoMediaExtInfo {"com.android.camera.livephoto":"${vivoId}"}`)]);
  const vivoForm = new FormData(); vivoForm.append('livePhotoId', vivoId); vivoForm.append('batchId','live-timeline-batch'); vivoForm.append('description','第一次动态记录'); vivoForm.append('image', new Blob([vivoImage], { type:'image/jpeg' }), 'vivo.jpg'); vivoForm.append('video', new Blob([vivoVideo], { type:'video/mp4' }), 'vivo.mp4');
  const vivoUpload = await fetch(base + '/api/live-photo', { method:'POST', headers:{ origin:base, cookie }, body:vivoForm }); assert.equal(vivoUpload.status, 201); const vivoSaved = await vivoUpload.json(); assert.equal(vivoSaved.success, true); assert.equal(vivoSaved.item.livePhotoId, vivoId);
  const vivoList = await req('/api/live-photos', null, 'GET'); assert.equal(vivoList.res.status, 200); assert.equal(vivoList.data.items.length, 1); assert.equal(vivoList.data.items[0].id, vivoSaved.item.id);
  const vivoManifest = await req('/api/live-photo/' + vivoSaved.item.id, null, 'GET'); assert.equal(vivoManifest.res.status, 200); assert.equal(vivoManifest.data.schemaVersion, 1); assert.equal(vivoManifest.data.itemId, vivoSaved.item.id); assert.equal(vivoManifest.data.livePhotoId, vivoId); assert.equal(vivoManifest.data.imageSize, vivoImage.length); assert.equal(vivoManifest.data.videoSize, vivoVideo.length); assert.match(vivoManifest.data.imageSha256, /^[0-9a-f]{64}$/); assert.match(vivoManifest.data.videoSha256, /^[0-9a-f]{64}$/); assert.equal(vivoManifest.data.videoHasVivoMediaExtInfo, true);
  const vivoRange = await fetch(base + vivoSaved.item.videoUrl, { headers:{ origin:base, cookie, range:'bytes=4-11' } }); assert.equal(vivoRange.status, 206); assert.equal(Buffer.from(await vivoRange.arrayBuffer()).toString(), 'ftypisom');
  const vivoDownload = await fetch(base + vivoSaved.item.imageUrl + '?download=1', { headers:{ origin:base, cookie } }); assert.equal(vivoDownload.status, 200); assert.match(vivoDownload.headers.get('content-disposition') || '', /vivo\.jpg/); assert.deepEqual(Buffer.from(await vivoDownload.arrayBuffer()), vivoImage);
  const familyBatch='family-timeline-batch'; const familyDescription='第一次一起看窗外';
  const familyPhoto = Buffer.concat([Buffer.from([0xff,0xd8,0xff]), Buffer.from('family-photo')]); const photoForm = new FormData(); photoForm.append('file', new Blob([familyPhoto], { type:'image/jpeg' }), '宝宝照片.jpg'); photoForm.append('batchId',familyBatch); photoForm.append('description',familyDescription);
  const photoUpload = await fetch(base + '/api/family-media', { method:'POST', headers:{ origin:base, cookie }, body:photoForm }); assert.equal(photoUpload.status, 201); const photoSaved=await photoUpload.json(); assert.equal(photoSaved.item.kind,'photo');
  const familyVideo = Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.from('family-video')]); const familyVideoForm=new FormData(); familyVideoForm.append('file',new Blob([familyVideo],{type:'video/mp4'}),'宝宝视频.mp4'); familyVideoForm.append('batchId',familyBatch); familyVideoForm.append('description',familyDescription);
  const familyVideoUpload=await fetch(base + '/api/family-media',{method:'POST',headers:{origin:base,cookie},body:familyVideoForm}); assert.equal(familyVideoUpload.status,201); const familyVideoSaved=await familyVideoUpload.json(); assert.equal(familyVideoSaved.item.kind,'video');
  const familyList=await req('/api/family-media',null,'GET'); assert.equal(familyList.res.status,200); assert.equal(familyList.data.items.length,3); assert.deepEqual(new Set(familyList.data.items.map((item)=>item.kind)),new Set(['photo','video','live-photo']));
  const ordinaryItems=familyList.data.items.filter((item)=>item.kind!=='live-photo'); assert.equal(new Set(ordinaryItems.map((item)=>item.batchId)).size,1); assert.equal(ordinaryItems[0].batchId,familyBatch); assert.ok(ordinaryItems.every((item)=>item.description===familyDescription));
  const liveItem=familyList.data.items.find((item)=>item.kind==='live-photo'); assert.equal(liveItem.batchId,'live-timeline-batch'); assert.equal(liveItem.description,'第一次动态记录');
  const familyPhotoDownload=await fetch(base + photoSaved.item.mediaUrl+'?download=1',{headers:{origin:base,cookie}}); assert.equal(familyPhotoDownload.status,200); assert.deepEqual(Buffer.from(await familyPhotoDownload.arrayBuffer()),familyPhoto);
  const familyVideoRange=await fetch(base + familyVideoSaved.item.mediaUrl,{headers:{origin:base,cookie,range:'bytes=4-11'}}); assert.equal(familyVideoRange.status,206); assert.equal(Buffer.from(await familyVideoRange.arrayBuffer()).toString(),'ftypisom');
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai' }).format(new Date()); const dayStart = Date.parse(`${dayKey}T00:00:00+08:00`);
  const endMs = Math.min(dayStart + 3600000, Date.now()); const start = new Date(dayStart - 3600000).toISOString(); const end = new Date(endMs).toISOString(); const expectedSleep = Math.max(0, Math.round((endMs - dayStart) / 60000));
  const yesterdayBottle = await req('/api/events', { mutationId:randomUUID(), type:'bottle', start_at:new Date(dayStart - 3600000).toISOString(), end_at:null, details:{kind:'奶', amount_ml:100} }); assert.equal(yesterdayBottle.res.status, 201);
  const todayBottle = await req('/api/events', { mutationId:randomUUID(), type:'bottle', start_at:new Date(Date.now()).toISOString(), end_at:null, details:{kind:'奶', amount_ml:80} }); assert.equal(todayBottle.res.status, 201);
  const todayDiaper = await req('/api/events', { mutationId:randomUUID(), type:'diaper', start_at:new Date(Date.now()).toISOString(), end_at:null, details:{kind:'pee', urine_amount:120} }); assert.equal(todayDiaper.res.status, 201);
  const open = { mutationId: randomUUID(), type:'sleep', start_at:start, end_at:null, details:{}, note:'夜间睡眠' }; const created = await req('/api/events', open); assert.equal(created.res.status, 201); const event = created.data.event;
  const repeat = await req('/api/events', open); assert.equal(repeat.res.status, 201); assert.equal(repeat.data.event.id, event.id);
  const mismatch = await req('/api/events', { ...open, details:{ note:'different' } }); assert.equal(mismatch.res.status, 409);
  const secondLogin = await req('/api/login', { caregiverName:'爸爸', password:setup.password }); assert.equal(secondLogin.res.status, 200); assert.notEqual(cookie, momCookie);
  const changed = await req('/api/password', { mutationId:randomUUID(), oldPassword:setup.password, newPassword:'family-pass-9' }, 'PATCH'); assert.equal(changed.res.status, 200);
  const oldPasswordLogin = await req('/api/login', { caregiverName:'爸爸', password:setup.password }); assert.equal(oldPasswordLogin.res.status, 401);
  const newPasswordLogin = await req('/api/login', { caregiverName:'爸爸', password:'family-pass-9' }); assert.equal(newPasswordLogin.res.status, 200);
  const healthDate = new Date(Date.now() - 86400000).toISOString();
  const growthNoGender = await req('/api/events', { mutationId:randomUUID(), type:'growth', start_at:healthDate, end_at:healthDate, details:{weight_kg:6.2}, note:'一项测量' }); assert.equal(growthNoGender.res.status, 201); assert.equal(growthNoGender.data.event.end_at, growthNoGender.data.event.start_at); assert.equal(growthNoGender.data.health?.growth, undefined);
  const noMeasurement = await req('/api/events', { mutationId:randomUUID(), type:'growth', start_at:healthDate, end_at:healthDate, details:{} }); assert.equal(noMeasurement.res.status, 400);
  const futureGrowth = await req('/api/events', { mutationId:randomUUID(), type:'growth', start_at:new Date(Date.now()+86400000).toISOString(), end_at:new Date(Date.now()+86400000).toISOString(), details:{weight_kg:6} }); assert.equal(futureGrowth.res.status, 400);
  const profileUpdate = await req('/api/profile', { mutationId:randomUUID(), babyName:'米娅', birthDate:'2026-05-01', gender:'女', caregiverName:'爸爸' }, 'PATCH'); assert.equal(profileUpdate.res.status, 200);
  const growthP50 = await req('/api/events', { mutationId:randomUUID(), type:'growth', start_at:new Date(Date.parse('2026-05-01T12:00:00+08:00')).toISOString(), end_at:null, details:{weight_kg:3.2322} }); assert.equal(growthP50.res.status, 201);
  const stateWithGrowth = await req('/api/state', null, 'GET'); assert.equal(stateWithGrowth.res.status, 200); const scored = stateWithGrowth.data.health.growth.find((e) => e.id === growthP50.data.event.id); assert.equal(scored.growth.age_days, 0); assert.ok(scored.growth.scores.weight.percentile.startsWith('P50'));
  const growthStale = await req(`/api/events/${growthP50.data.event.id}`, { mutationId:randomUUID(), expectedVersion:growthP50.data.event.version, start_at:healthDate, details:{weight_kg:6.3} }, 'PATCH'); assert.equal(growthStale.res.status, 200);
  const growthConflict = await req(`/api/events/${growthP50.data.event.id}`, { mutationId:randomUUID(), expectedVersion:growthP50.data.event.version, start_at:healthDate, details:{weight_kg:6.4} }, 'PATCH'); assert.equal(growthConflict.res.status, 409);
  const appointment = new Date(Date.now()+7*86400000); const appointmentDate = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai' }).format(appointment);
  const plannedVaccine = await req('/api/events', { mutationId:randomUUID(), type:'vaccine', start_at:new Date(`${appointmentDate}T12:00:00+08:00`).toISOString(), end_at:null, details:{name:'乙肝疫苗', dose:1, category:'免疫规划', status:'planned', appointment_date:appointmentDate} }); assert.equal(plannedVaccine.res.status, 201); assert.equal(plannedVaccine.data.event.end_at, plannedVaccine.data.event.start_at);
  const futureCompleted = await req('/api/events', { mutationId:randomUUID(), type:'vaccine', start_at:new Date(`${appointmentDate}T12:00:00+08:00`).toISOString(), end_at:null, details:{name:'卡介苗', dose:1, category:'待确认', status:'completed', actual_date:appointmentDate} }); assert.equal(futureCompleted.res.status, 400);
  const invalidReaction = await req('/api/events', { mutationId:randomUUID(), type:'food', start_at:healthDate, end_at:null, details:{food_name:'南瓜', observation:'有反应', reaction_at:new Date(Date.now()+86400000).toISOString(), reaction_desc:'红疹'} }); assert.equal(invalidReaction.res.status, 400);
  const food = await req('/api/events', { mutationId:randomUUID(), type:'food', start_at:healthDate, end_at:null, details:{food_name:'南瓜', amount_text:'两勺', texture:'泥糊', first_try:true, observation:'观察中'} }); assert.equal(food.res.status, 201);
  const revokedHealth = await req(`/api/events/${food.data.event.id}/revoke`, { mutationId:randomUUID(), expectedVersion:food.data.event.version }, 'PATCH'); assert.equal(revokedHealth.res.status, 200); assert.equal(revokedHealth.data.event.revoked, true);
  const stopped = await req(`/api/events/${event.id}/stop`, { mutationId:randomUUID(), expectedVersion:event.version, end_at:end }, 'PATCH'); assert.equal(stopped.res.status, 200); assert.ok(stopped.data.event.end_at); assert.equal(stopped.data.event.modified_by, '爸爸');
  const stale = await req(`/api/events/${event.id}`, { mutationId:randomUUID(), expectedVersion:event.version, end_at:end, details:{} }, 'PATCH'); assert.equal(stale.res.status, 409);
  const invalid = await req('/api/events', { mutationId:randomUUID(), type:'bottle', start_at:new Date(Date.now()+86400000).toISOString(), end_at:new Date(Date.now()+86400000+60000).toISOString(), details:{amount_ml:10} }); assert.equal(invalid.res.status, 400);
  const state = await req('/api/state', null, 'GET'); assert.equal(state.res.status, 200); assert.equal(state.data.summary.sleep_minutes, expectedSleep); assert.equal(state.data.summary.bottle_ml, 80); assert.equal(state.data.summary.urine_grams, 120);
  const seeded = await req("/api/stories", null, "GET"); assert.equal(seeded.data.stories.length, 2);
  const storyInput = { title: "测试故事 <b>", subtitle: "可编辑", segments: [{ zh: "中文一", en: "English one", prompt: "轻声读" }, { zh: "中文二", en: "English two" }] };
  const storyBody = { ...storyInput, mutationId: randomUUID() };
  const createdStory = await req("/api/stories", storyBody); assert.equal(createdStory.res.status, 201);
  const repeatedStory = await req("/api/stories", storyBody); assert.equal(repeatedStory.data.story.id, createdStory.data.story.id);
  const editedStory = await req("/api/stories/" + createdStory.data.story.id, { ...storyInput, title: "已编辑故事", expectedVersion: 1, mutationId: randomUUID() }, "PATCH"); assert.equal(editedStory.data.story.version, 2);
  const staleStory = await req("/api/stories/" + createdStory.data.story.id, { ...storyInput, expectedVersion: 1, mutationId: randomUUID() }, "PATCH"); assert.equal(staleStory.res.status, 409);
  const invalidPack = await req("/api/stories/import", { format: "babymia-stories", version: 1, stories: [storyInput, { title: "坏故事", segments: [{ zh: "缺英文" }] }], mutationId: randomUUID() }); assert.equal(invalidPack.res.status, 400);
  assert.equal((await req("/api/stories", null, "GET")).data.stories.length, 3);
  const packBody = { format: "babymia-stories", version: 1, stories: [storyInput], mutationId: randomUUID() };
  const importedStory = await req("/api/stories/import", packBody); assert.equal(importedStory.res.status, 201);
  const repeatPack = await req("/api/stories/import", packBody); assert.equal(repeatPack.data.stories[0].id, importedStory.data.stories[0].id);
  const duplicatePack = await req("/api/stories/import", { ...packBody, mutationId: randomUUID() }); assert.equal(duplicatePack.res.status, 409);
  const deletedStory = await req("/api/stories/" + importedStory.data.stories[0].id, { expectedVersion: 1, mutationId: randomUUID() }, "DELETE"); assert.equal(deletedStory.res.status, 200);
  const favorite = await req('/api/favorites', { mutationId:randomUUID(), url:'https://supersimple.com/super-simple-songs/', title:'官方歌曲', kind:'official' }); assert.equal(favorite.res.status, 201); assert.equal(favorite.data.favorites.length, 1);
  const duplicateFavorite = await req('/api/favorites', { mutationId:randomUUID(), url:'https://supersimple.com/super-simple-songs/', title:'重复链接', kind:'official' }); assert.equal(duplicateFavorite.res.status, 409);
  const favoriteUpdated = await req(`/api/favorites/${favorite.data.favorite.id}`, { mutationId:randomUUID(), expectedVersion:favorite.data.favorite.version, title:'官方歌曲入口', url:'https://supersimple.com/super-simple-songs/', kind:'official' }, 'PATCH'); assert.equal(favoriteUpdated.res.status, 200); assert.equal(favoriteUpdated.data.favorite.version, 2);
  const favoriteStale = await req(`/api/favorites/${favorite.data.favorite.id}`, { mutationId:randomUUID(), expectedVersion:favorite.data.favorite.version, title:'过期修改', url:'https://supersimple.com/super-simple-songs/', kind:'official' }, 'PATCH'); assert.equal(favoriteStale.res.status, 409);
  const emptyTypes = await req('/api/ai/preview', { mutationId:randomUUID(), startDate:dayKey, endDate:dayKey, types:[] }); assert.equal(emptyTypes.res.status, 400);
  const aiPreview = await req('/api/ai/preview', { mutationId:randomUUID(), startDate:dayKey, endDate:dayKey, types:['bottle'] }); assert.equal(aiPreview.res.status, 200); assert.equal(aiPreview.data.configured, true); assert.equal(aiPreview.data.snapshot.truncated, false); assert.equal(aiPreview.data.snapshot.events[0].details.kind, '奶'); assert.equal(Object.hasOwn(aiPreview.data.snapshot.events[0], 'created_by'), false); assert.ok(aiPreview.data.snapshot.captured_at);
  const generateBody = { mutationId:randomUUID(), snapshotHash:aiPreview.data.snapshotHash }; const [aiGenerated, aiGeneratedRepeat] = await Promise.all([req('/api/ai/generate', generateBody), req('/api/ai/generate', generateBody)]); assert.equal(aiGenerated.res.status, 200); assert.equal(aiGenerated.data.text, '已根据预览记录整理：请继续交接。'); assert.equal(aiGeneratedRepeat.data.text, aiGenerated.data.text); assert.equal(mockCalls, 1); assert.equal(mockPayloads[0].messages[1].content.includes('夜间睡眠'), false);
  assert.deepEqual(JSON.parse(mockPayloads[0].messages[1].content), aiPreview.data.snapshot);
  const invalidSnapshot = await req('/api/ai/generate', { mutationId: randomUUID(), snapshotHash: 'missing' }); assert.equal(invalidSnapshot.res.status, 409);
  const changedSnapshot = await req('/api/ai/generate', { ...generateBody, snapshotHash: 'changed' }); assert.equal(changedSnapshot.res.status, 409);
  for (const mode of ['http', 'json', 'timeout']) {
    mockMode = mode;
    const failed = await req('/api/ai/generate', { mutationId: randomUUID(), snapshotHash: aiPreview.data.snapshotHash });
    assert.equal(failed.res.status, 502, mode);
    assert.ok(failed.data.error, mode);
  }
  mockMode = 'ok';
  const revokeCreate = await req('/api/events', { mutationId:randomUUID(), type:'bottle', start_at:new Date(Date.now() - 120000).toISOString(), end_at:null, details:{kind:'奶', amount_ml:1} }); assert.equal(revokeCreate.res.status, 201);
  const revoked = await req(`/api/events/${revokeCreate.data.event.id}/revoke`, { mutationId:randomUUID(), expectedVersion:revokeCreate.data.event.version }, 'PATCH'); assert.equal(revoked.res.status, 200); assert.equal(revoked.data.event.revoked, true);
  const revokedOpenCreate = await req('/api/events', { mutationId:randomUUID(), type:'play', start_at:new Date(Date.now() - 120000).toISOString(), end_at:null, details:{} }); assert.equal(revokedOpenCreate.res.status, 201);
  const revokedOpen = await req(`/api/events/${revokedOpenCreate.data.event.id}/revoke`, { mutationId:randomUUID(), expectedVersion:revokedOpenCreate.data.event.version }, 'PATCH'); assert.equal(revokedOpen.res.status, 200); assert.equal(revokedOpen.data.event.revoked, true);
  const backup = await req('/api/export', null, 'GET'); assert.equal(backup.data.format, 'babymia-backup'); assert.equal(backup.data.version, 4); assert.equal(backup.data.favorites.length, 1);
  assert.equal(backup.data.stories.length, 3);
  const legacyBackup = { ...backup.data, version: 1, events: backup.data.events.filter((e) => !['growth', 'vaccine', 'food'].includes(e.type)), mutationId: randomUUID(), confirm: '覆盖并恢复' };
  const legacyRestored = await req('/api/restore', legacyBackup); assert.equal(legacyRestored.res.status, 200); const legacySessionGone = await req('/api/state', null, 'GET'); assert.equal(legacySessionGone.res.status, 401);
  assert.equal(legacyRestored.data.state.profile.baby_name, backup.data.profile.baby_name);
  const afterLegacyLogin = await req('/api/login', { caregiverName:'爸爸', password:'family-pass-9' }); assert.equal(afterLegacyLogin.res.status, 200);
  assert.deepEqual((await req("/api/stories", null, "GET")).data.stories, backup.data.stories);
  const bulk = Array.from({ length: 301 }, (_, i) => ({ id:randomUUID(), type:'bottle', start_at:new Date(Date.now() - 180000 - i).toISOString(), end_at:new Date(Date.now() - 180000 - i).toISOString(), details:{kind:'奶', amount_ml:1}, note:'', created_by:'爸爸', modified_by:'爸爸', version:1, created_at:new Date().toISOString(), updated_at:new Date().toISOString(), revoked:false }));
  const largeBackup = { ...backup.data, events:[...backup.data.events, ...bulk] }; assert.ok(largeBackup.events.length > 300);
  const invalidRestore = await req('/api/restore', { ...largeBackup, events:[largeBackup.events[0], largeBackup.events[0]], mutationId:randomUUID(), confirm:'覆盖并恢复' }); assert.equal(invalidRestore.res.status, 400); const intact = await req('/api/state', null, 'GET'); assert.equal(intact.res.status, 200);
  const restoredEvents = await req('/api/restore', { ...largeBackup, mutationId:randomUUID(), confirm:'覆盖并恢复' }); assert.equal(restoredEvents.res.status, 200); assert.equal(restoredEvents.data.state.events.length, largeBackup.events.filter((e) => !e.revoked).length); assert.equal(restoredEvents.data.state.favorites.length, 1); const afterRestore = await req('/api/state', null, 'GET'); assert.equal(afterRestore.res.status, 401);
  const relogin = await req('/api/login', { caregiverName:'爸爸', password:'family-pass-9' }); assert.equal(relogin.res.status, 200);
  assert.deepEqual((await req("/api/stories", null, "GET")).data.stories, backup.data.stories);
  const traversal = await fetch(`${base}/assets/%2e%2e/server.mjs`, { headers:{origin:base} }); assert.equal(traversal.status, 404);
  console.log('BabyMia selfcheck passed');
} finally {
  if (!child.killed) child.kill('SIGTERM');
  await new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); setTimeout(resolve, 2000); });
  await new Promise((resolve) => mockServer.close(resolve));
  await rm(dir, { recursive:true, force:true });
}
