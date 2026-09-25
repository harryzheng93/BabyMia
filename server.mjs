import http from 'node:http';
import { createStoryStore } from './story-store.mjs';
import { readFile, writeFile, mkdir, readdir, unlink, stat, realpath, rm } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { join, extname, resolve, basename, sep } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ageDaysShanghai, scoreGrowthEvent, referenceSource } from './growth.mjs';

const PORT = Number(process.env.PORT || 8185);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = resolve(process.env.DATA_DIR || join(process.cwd(), 'data'));
const VIDEO_DIR = resolve(process.env.VIDEO_DIR || join(DATA_DIR, 'videos'));
const LIVE_PHOTO_DIR = resolve(process.env.LIVE_PHOTO_DIR || join(DATA_DIR, 'live-photos'));
const FAMILY_MEDIA_DIR = resolve(process.env.FAMILY_MEDIA_DIR || join(DATA_DIR, 'family-media'));
const VIDEO_DIRECTORY_HINT = process.env.VIDEO_DIR ? 'VIDEO_DIR' : 'DATA_DIR/videos';
const DB_FILE = resolve(process.env.DB_FILE || join(DATA_DIR, 'babymia.sqlite'));
const PUBLIC_DIR = resolve(join(process.cwd(), 'public'));
const MAX_BODY = 256 * 1024;
const MEDIA_INSPECT_LIMIT = 128 * 1024 * 1024;
const LIVE_PHOTO_UPLOAD_LIMIT = 250 * 1024 * 1024;
const SESSION_DAYS = 14;
const ALLOWED_TYPES = new Set(['bottle', 'breast', 'sleep', 'diaper', 'supplement', 'play', 'outing', 'growth', 'vaccine', 'food']);
const TIMER_TYPES = new Set(['breast', 'sleep', 'play', 'outing']);
const HEALTH_TYPES = new Set(['growth', 'vaccine', 'food']);
const AI_TYPES = new Set(['bottle', 'breast', 'sleep', 'diaper', 'supplement', 'play', 'outing']);
const VACCINE_STATUSES = new Set(['planned', 'completed', 'deferred']);
const VACCINE_CATEGORIES = new Set(['免疫规划', '非免疫规划', '待确认']);
const FAVORITE_KINDS = new Set(['official', 'story', 'other']);
const AI_ENDPOINT = String(process.env.AI_ENDPOINT || '').trim();
const AI_API_KEY = String(process.env.AI_API_KEY || '').trim();
const AI_MODEL = String(process.env.AI_MODEL || '').trim();
const AI_TIMEOUT_MS = Math.min(30000, Math.max(1000, Number(process.env.AI_TIMEOUT_MS || 12000)));
const REFERENCE_FILE = resolve(join(process.cwd(), 'reference', 'who-growth.json'));
let whoReference = null;
try { whoReference = JSON.parse(readFileSync(REFERENCE_FILE, 'utf8')); } catch { whoReference = null; }
const loginAttempts = new Map();
const aiSnapshots = new Map();
const aiGenerationInflight = new Map();
const aiGenerationCache = new Map();
let writeQueue = Promise.resolve();

await mkdir(DATA_DIR, { recursive: true });
await mkdir(VIDEO_DIR, { recursive: true });
await mkdir(LIVE_PHOTO_DIR, { recursive: true });
await mkdir(FAMILY_MEDIA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1), baby_name TEXT NOT NULL, birth_date TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT '', timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  caregiver_name TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT,
  details TEXT NOT NULL DEFAULT '{}', note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
  modified_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_start_idx ON events(start_at);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL, caregiver_name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mutations (
  mutation_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, kind TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS live_photos (
  id TEXT PRIMARY KEY, live_photo_id TEXT NOT NULL UNIQUE,
  image_filename TEXT NOT NULL, video_filename TEXT NOT NULL,
  image_size INTEGER NOT NULL, video_size INTEGER NOT NULL,
  image_sha256 TEXT NOT NULL, video_sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);`);

db.exec('CREATE TABLE IF NOT EXISTS family_media (id TEXT PRIMARY KEY, kind TEXT NOT NULL, filename TEXT NOT NULL, stored_filename TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created_at TEXT NOT NULL)');
const ensureColumn = (table, column, definition) => {
  const columns = db.prepare('PRAGMA table_info(' + table + ')').all();
  if (!columns.some((row) => row.name === column)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition);
};
ensureColumn('family_media', 'batch_id', 'TEXT');
ensureColumn('family_media', 'description', "TEXT NOT NULL DEFAULT ''");
ensureColumn('live_photos', 'batch_id', 'TEXT');
ensureColumn('live_photos', 'description', "TEXT NOT NULL DEFAULT ''");

const storyStore = createStoryStore(db, JSON.parse(readFileSync(join(process.cwd(), 'reference', 'starter-stories.json'), 'utf8')));
const now = () => new Date().toISOString();
const json = (res, status, body, headers = {}) => {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(data);
};
const error = (res, status, message) => json(res, status, { error: message });
const safeMessage = (e) => e instanceof Error ? e.message : '请求未完成';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const parseJson = async (req, limit = MAX_BODY) => {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('请求格式不正确'); }
};
const parseBinary = async (req, limit = MEDIA_INSPECT_LIMIT) => {
  const declared = Number(req.headers['content-length'] || 0);
  const sizeLabel = `${Math.round(limit / 1024 / 1024)} MB`;
  if (Number.isFinite(declared) && declared > limit) { const e = new Error(`上传内容不能超过 ${sizeLabel}`); e.status = 413; throw e; }
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) { const e = new Error(`上传内容不能超过 ${sizeLabel}`); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  if (!size) throw new Error('没有收到文件内容');
  return Buffer.concat(chunks);
};
const inspectMediaBuffer = (buffer, metadata = {}) => {
  const name = String(metadata.name || '未命名文件').slice(0, 255);
  const browserType = String(metadata.browserType || '').slice(0, 120);
  const extension = extname(name).toLowerCase();
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  const isGif = buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  const firstBox = buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  const brand = firstBox ? buffer.subarray(8, 12).toString('ascii') : '';
  const heicBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);
  const avifBrands = new Set(['avif', 'avis']);
  let format = isJpeg ? 'JPEG' : isPng ? 'PNG' : isWebp ? 'WebP' : isGif ? 'GIF' : firstBox && heicBrands.has(brand) ? 'HEIC/HEIF' : firstBox && avifBrands.has(brand) ? 'AVIF' : firstBox && brand.trim() === 'qt' ? 'MOV/QuickTime' : firstBox ? 'MP4/ISOBMFF' : '未知格式';
  if (format === '未知格式' && ['.heic', '.heif'].includes(extension)) format = 'HEIC/HEIF';
  const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.avif', '.webp']);
  const videoExtensions = new Set(['.mov', '.mp4', '.m4v', '.3gp']);
  const kind = isJpeg || isPng || isWebp || isGif || heicBrands.has(brand) || avifBrands.has(brand) || browserType.startsWith('image/') || imageExtensions.has(extension) ? 'image' : firstBox || browserType.startsWith('video/') || videoExtensions.has(extension) ? 'video' : 'unknown';
  const markers = {
    motion_photo: buffer.indexOf('MotionPhoto') >= 0,
    micro_video: buffer.indexOf('MicroVideo') >= 0,
    container_directory: buffer.indexOf('Container:Directory') >= 0 || buffer.indexOf('GContainer') >= 0
  };
  const ftypOffsets = [];
  let cursor = 0;
  while (cursor < buffer.length - 8 && ftypOffsets.length < 8) {
    const pos = buffer.indexOf('ftyp', cursor, 'ascii');
    if (pos < 0) break;
    const boxStart = pos - 4;
    if (boxStart >= 0) {
      const boxSize = buffer.readUInt32BE(boxStart);
      if (boxSize >= 8 && boxSize <= 4096 && boxStart + boxSize <= buffer.length) ftypOffsets.push(boxStart);
    }
    cursor = pos + 4;
  }
  const embeddedVideoOffset = ftypOffsets.find((offset) => offset > 0) ?? null;
  const hasMotionMetadata = Object.values(markers).some(Boolean);
  const detectedMotionPhoto = kind === 'image' && hasMotionMetadata && embeddedVideoOffset !== null;
  const suspectedMotionPhoto = kind === 'image' && embeddedVideoOffset !== null;
  let conclusion = kind === 'video' ? '浏览器交出了一段独立视频。' : kind === 'image' ? '浏览器交出了一张普通静态图片。' : '浏览器交出的文件格式暂时无法识别。';
  if (detectedMotionPhoto) conclusion = '检测到 Android Motion Photo：静态图和动态视频位于同一个文件中。';
  else if (suspectedMotionPhoto) conclusion = '文件中发现第二个媒体容器，可能是动态照片，但没有读到标准 Motion Photo 标记。';
  return {
    persisted: false,
    file: { name, size_bytes: buffer.length, browser_type: browserType || '未提供', modified_at: metadata.modified || null, sha256: hash(buffer) },
    format,
    kind,
    motion: { detected: detectedMotionPhoto, suspected: suspectedMotionPhoto, metadata: markers, embedded_video: embeddedVideoOffset !== null, embedded_video_offset: embeddedVideoOffset },
    conclusion
  };
};
const VIVO_LIVE_PHOTO_ID_RE = /com\.android\.camera\.livephoto(?:\\?")?\s*[:=]\s*(?:\\?")?([0-9a-f]{28})/i;
const vivoLivePhotoId = (buffer) => {
  const match = buffer.toString('latin1').replaceAll('\\"', '"').match(VIVO_LIVE_PHOTO_ID_RE);
  return match ? match[1].toLowerCase() : null;
};
const multipartBoundary = (contentType) => {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ''));
  if (!match) throw new Error('上传格式缺少 multipart boundary');
  return match[1] || match[2];
};
const decodeMultipartFilename = (value) => {
  const decoded = Buffer.from(String(value || ''), 'latin1').toString('utf8');
  return decoded.includes('�') ? String(value || '') : decoded;
};
const parseMultipart = (buffer, contentType) => {
  const boundary = Buffer.from(`--${multipartBoundary(contentType)}`, 'latin1');
  const fields = {}; const files = {};
  let cursor = 0;
  while (true) {
    const marker = buffer.indexOf(boundary, cursor);
    if (marker < 0) break;
    let start = marker + boundary.length;
    if (buffer.subarray(start, start + 2).toString('latin1') === '--') break;
    if (buffer.subarray(start, start + 2).toString('latin1') === '\r\n') start += 2;
    const headerEnd = buffer.indexOf('\r\n\r\n', start, 'latin1');
    if (headerEnd < 0) throw new Error('multipart 分段头不完整');
    const next = buffer.indexOf(boundary, headerEnd + 4);
    if (next < 0) throw new Error('multipart 分段未结束');
    let dataEnd = next;
    if (buffer.subarray(dataEnd - 2, dataEnd).toString('latin1') === '\r\n') dataEnd -= 2;
    const headers = buffer.subarray(start, headerEnd).toString('latin1');
    const disposition = /content-disposition:\s*form-data;[^\r\n]*/i.exec(headers)?.[0] || '';
    const name = /name="([^"]+)"/i.exec(disposition)?.[1];
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
    if (name) {
      const data = buffer.subarray(headerEnd + 4, dataEnd);
      if (filename !== undefined) {
        const mediaType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() || 'application/octet-stream';
        files[name] = { filename: basename(decodeMultipartFilename(filename)) || name, contentType: mediaType, data };
      } else fields[name] = data.toString('utf8');
    }
    cursor = next;
  }
  return { fields, files };
};
const albumBatchId = (fields) => {
  const supplied = String(fields.batchId || '').trim();
  return /^[0-9a-z-]{8,100}$/i.test(supplied) ? supplied : randomUUID();
};
const albumDescription = (fields) => String(fields.description || '').trim().slice(0, 500);
const publicLivePhoto = (row) => ({
  id: row.id, livePhotoId: row.live_photo_id, imageFilename: row.image_filename,
  videoFilename: row.video_filename, imageSize: row.image_size, videoSize: row.video_size,
  batchId: row.batch_id || row.id, description: row.description || '',
  createdBy: row.created_by, createdAt: row.created_at,
  imageUrl: `/api/live-photo/${row.id}/image`, videoUrl: `/api/live-photo/${row.id}/video`
});
const allLivePhotos = () => db.prepare('SELECT * FROM live_photos ORDER BY created_at DESC').all().map(publicLivePhoto);
const livePhotoManifest = (row) => ({
  schemaVersion: 1, itemId: row.id, createdAt: row.created_at, livePhotoId: row.live_photo_id,
  imageFilename: row.image_filename, videoFilename: row.video_filename,
  imageContentType: 'image/jpeg', videoContentType: 'video/mp4',
  imageSize: row.image_size, videoSize: row.video_size,
  imageSha256: row.image_sha256, videoSha256: row.video_sha256,
  videoHasVivoMediaExtInfo: true,
  metadataUrl: `/api/live-photo/${row.id}`,
  imageUrl: `/api/live-photo/${row.id}/image`,
  videoUrl: `/api/live-photo/${row.id}/video`,
  galleryUrl: '/#album'
});
const oneLivePhotoManifest = (id) => {
  const row = db.prepare('SELECT * FROM live_photos WHERE id=?').get(id);
  if (!row) { const error = new Error('Live Photo 不存在'); error.status = 404; throw error; }
  return livePhotoManifest(row);
};
const saveLivePhoto = async (req, caregiver) => {
  const body = await parseBinary(req, LIVE_PHOTO_UPLOAD_LIMIT);
  const { fields, files } = parseMultipart(body, req.headers['content-type']);
  const image = files.image; const video = files.video;
  const batchId = albumBatchId(fields); const description = albumDescription(fields);
  if (!image || !video || !String(fields.livePhotoId || '').trim()) throw new Error('需要同时上传 JPG、MP4 和 Live Photo ID');
  if (!(image.data[0] === 0xff && image.data[1] === 0xd8 && image.data[2] === 0xff)) throw new Error('图片不是有效的 JPG 原件');
  if (video.data.indexOf('ftyp', 0, 'ascii') < 0) throw new Error('视频不是有效的 MP4 原件');
  const submittedId = String(fields.livePhotoId).trim().toLowerCase();
  const imageId = vivoLivePhotoId(image.data); const videoId = vivoLivePhotoId(video.data);
  if (!imageId || !videoId || imageId !== videoId || imageId !== submittedId) throw new Error('JPG 与 MP4 的 vivo Live Photo ID 不匹配');
  if (video.data.indexOf('vivoMediaExtInfo', 0, 'ascii') < 0) throw new Error('MP4 缺少 vivoMediaExtInfo，未保存为 Live Photo');
  const imageSha = hash(image.data); const videoSha = hash(video.data);
  const previous = db.prepare('SELECT * FROM live_photos WHERE live_photo_id=?').get(imageId);
  if (previous) {
    if (previous.image_sha256 !== imageSha || previous.video_sha256 !== videoSha) { const e = new Error('相同 Live Photo ID 对应的文件内容不同'); e.status = 409; throw e; }
    return { success: true, duplicate: true, item: publicLivePhoto(previous) };
  }
  const id = randomUUID(); const directory = join(LIVE_PHOTO_DIR, id);
  await mkdir(directory, { recursive: false });
  try {
    await Promise.all([writeFile(join(directory, 'image.jpg'), image.data), writeFile(join(directory, 'video.mp4'), video.data)]);
    const createdAt = now();
    db.prepare('INSERT INTO live_photos (id,live_photo_id,image_filename,video_filename,image_size,video_size,image_sha256,video_sha256,batch_id,description,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, imageId, basename(image.filename).slice(0, 255), basename(video.filename).slice(0, 255), image.data.length, video.data.length, imageSha, videoSha, batchId, description, caregiver, createdAt);
    return { success: true, duplicate: false, item: publicLivePhoto(db.prepare('SELECT * FROM live_photos WHERE id=?').get(id)) };
  } catch (e) { await rm(directory, { recursive: true, force: true }); throw e; }
};
const streamLivePhotoMedia = async (req, res, id, kind, download) => {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['image', 'video'].includes(kind)) return videoFailure('Live Photo 不存在');
  const row = db.prepare('SELECT * FROM live_photos WHERE id=?').get(id);
  if (!row) return videoFailure('Live Photo 不存在');
  const file = join(LIVE_PHOTO_DIR, id, kind === 'image' ? 'image.jpg' : 'video.mp4');
  let info; try { info = await stat(file); } catch { return videoFailure('Live Photo 文件不存在'); }
  const size = info.size; const type = kind === 'image' ? 'image/jpeg' : 'video/mp4';
  let start = 0; let end = Math.max(0, size - 1); let partial = false;
  if (kind === 'video' && req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range).trim());
    if (!match) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    partial = true; start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2])); end = match[2] && match[1] ? Number(match[2]) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    end = Math.min(end, size - 1);
  }
  const headers = { 'content-type': type, 'content-length': Math.max(0, end - start + 1), 'cache-control': 'private, max-age=3600', 'accept-ranges': 'bytes' };
  if (partial) headers['content-range'] = `bytes ${start}-${end}/${size}`;
  if (download) {
    const originalName = kind === 'image' ? row.image_filename : row.video_filename;
    const fallback = kind === 'image' ? 'live-photo.jpg' : 'live-photo.mp4';
    headers['content-disposition'] = `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`;
  }
  res.writeHead(partial ? 206 : 200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
};

const publicFamilyMedia = (row) => ({
  id: row.id, kind: row.kind, filename: row.filename, mimeType: row.mime_type,
  size: row.size, batchId: row.batch_id || row.id, description: row.description || '',
  createdBy: row.created_by, createdAt: row.created_at,
  mediaUrl: '/api/family-media/' + row.id + '/file'
});
const allFamilyMedia = () => {
  const ordinary = db.prepare('SELECT * FROM family_media ORDER BY created_at DESC').all().map(publicFamilyMedia);
  const live = allLivePhotos().map((item) => ({
    id: item.id, kind: 'live-photo', filename: item.imageFilename, imageFilename: item.imageFilename,
    videoFilename: item.videoFilename, size: Number(item.imageSize) + Number(item.videoSize),
    batchId: item.batchId, description: item.description,
    createdBy: item.createdBy, createdAt: item.createdAt, imageUrl: item.imageUrl, videoUrl: item.videoUrl
  }));
  return ordinary.concat(live).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
};
const saveFamilyMedia = async (req, caregiver) => {
  const body = await parseBinary(req, LIVE_PHOTO_UPLOAD_LIMIT);
  const { fields, files } = parseMultipart(body, req.headers['content-type']);
  const batchId = albumBatchId(fields); const description = albumDescription(fields);
  const file = files.file;
  if (!file) throw new Error('请选择一张照片或一个视频');
  const data = file.data;
  const jpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const png = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  const webp = data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
  const gif = data.length >= 6 && ['GIF87a','GIF89a'].includes(data.subarray(0, 6).toString('ascii'));
  const mp4 = data.length >= 12 && data.subarray(4, 8).toString('ascii') === 'ftyp';
  let kind = ''; let extension = ''; let mimeType = '';
  if (jpeg) { kind = 'photo'; extension = '.jpg'; mimeType = 'image/jpeg'; }
  else if (png) { kind = 'photo'; extension = '.png'; mimeType = 'image/png'; }
  else if (webp) { kind = 'photo'; extension = '.webp'; mimeType = 'image/webp'; }
  else if (gif) { kind = 'photo'; extension = '.gif'; mimeType = 'image/gif'; }
  else if (mp4) { kind = 'video'; extension = '.mp4'; mimeType = 'video/mp4'; }
  else { const e = new Error('仅支持 JPG、PNG、WebP、GIF 照片和 MP4 视频'); e.status = 415; throw e; }
  const checksum = hash(data);
  const previous = db.prepare('SELECT * FROM family_media WHERE sha256=?').get(checksum);
  if (previous) return { success: true, duplicate: true, item: publicFamilyMedia(previous) };
  const id = randomUUID(); const directory = join(FAMILY_MEDIA_DIR, id); const storedFilename = 'original' + extension;
  await mkdir(directory, { recursive: false });
  try {
    await writeFile(join(directory, storedFilename), data);
    const createdAt = now();
    db.prepare('INSERT INTO family_media (id,kind,filename,stored_filename,mime_type,size,sha256,batch_id,description,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, kind, basename(file.filename).slice(0,255), storedFilename, mimeType, data.length, checksum, batchId, description, caregiver, createdAt);
    return { success: true, duplicate: false, item: publicFamilyMedia(db.prepare('SELECT * FROM family_media WHERE id=?').get(id)) };
  } catch (e) { await rm(directory, { recursive: true, force: true }); throw e; }
};
const streamFamilyMedia = async (req, res, id, download) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return videoFailure('媒体文件不存在');
  const row = db.prepare('SELECT * FROM family_media WHERE id=?').get(id);
  if (!row) return videoFailure('媒体文件不存在');
  const file = join(FAMILY_MEDIA_DIR, id, row.stored_filename);
  let info; try { info = await stat(file); } catch { return videoFailure('媒体文件不存在'); }
  const size = info.size; let start = 0; let end = Math.max(0, size - 1); let partial = false;
  if (row.kind === 'video' && req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range).trim());
    if (!match) { res.writeHead(416, { 'content-range': 'bytes */' + size }); return res.end(); }
    partial = true; start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2])); end = match[2] && match[1] ? Number(match[2]) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) { res.writeHead(416, { 'content-range': 'bytes */' + size }); return res.end(); }
    end = Math.min(end, size - 1);
  }
  const headers = { 'content-type': row.mime_type, 'content-length': Math.max(0,end-start+1), 'cache-control':'private, max-age=3600', 'accept-ranges':'bytes' };
  if (partial) headers['content-range'] = 'bytes ' + start + '-' + end + '/' + size;
  if (download) headers['content-disposition'] = "attachment; filename=\"media-file" + extname(row.stored_filename) + "\"; filename*=UTF-8''" + encodeURIComponent(row.filename);
  res.writeHead(partial ? 206 : 200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
};

const cookie = (req, name) => {
  const line = req.headers.cookie || '';
  const pair = line.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : '';
};
const requestOriginOk = (req) => {
  const origin = req.headers.origin;
  if (!origin) return false;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return origin === `${proto}://${req.headers.host}`;
};
const requireSameOrigin = (req, res) => {
  if (!requestOriginOk(req)) { error(res, 403, '请求来源不安全，请从本页面操作'); return false; }
  return true;
};
const session = (req) => {
  const raw = cookie(req, 'babymia_session');
  if (!raw) return null;
  const row = db.prepare('SELECT token_hash, caregiver_name, expires_at FROM sessions WHERE token_hash = ?').get(hash(raw));
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  return row;
};
const ensureSession = (tokenHash) => {
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(tokenHash);
  if (!row || Date.parse(row.expires_at) <= Date.now()) { const e = new Error('登录已失效，请重新登录'); e.status = 401; throw e; }
};
const auth = (req, res) => {
  const s = session(req);
  if (!s) { error(res, 401, '请先登录'); return null; }
  return s;
};
const requireMutation = (body) => {
  if (!body.mutationId || typeof body.mutationId !== 'string' || body.mutationId.length > 100) throw new Error('缺少请求标识');
  return body.mutationId;
};
const withMutation = (mutationId, method, path, payload, action) => {
  const payloadHash = hash(JSON.stringify({ method, path, payload }));
  const old = db.prepare('SELECT payload_hash, response_json FROM mutations WHERE mutation_id = ?').get(mutationId);
  if (old) {
    if (old.payload_hash !== payloadHash) { const e = new Error('请求标识已用于另一份内容'); e.status = 409; throw e; }
    return JSON.parse(old.response_json);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.prepare('INSERT INTO mutations (mutation_id, payload_hash, response_json, created_at) VALUES (?, ?, ?, ?)').run(mutationId, payloadHash, JSON.stringify(result), now());
    db.exec('COMMIT');
    return result;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
};
const withSessionMutation = (sessionHash, mutationId, method, path, payload, action) => {
  ensureSession(sessionHash);
  return withMutation(mutationId, method, path, payload, () => { ensureSession(sessionHash); return action(); });
};
const withAsyncMutation = async (mutationId, method, path, payload, action) => {
  const payloadHash = hash(JSON.stringify({ method, path, payload }));
  const old = db.prepare('SELECT payload_hash, response_json FROM mutations WHERE mutation_id = ?').get(mutationId);
  if (old) {
    if (old.payload_hash !== payloadHash) { const e = new Error('请求标识已用于另一份内容'); e.status = 409; throw e; }
    return JSON.parse(old.response_json);
  }
  const result = await action();
  db.prepare('INSERT INTO mutations (mutation_id, payload_hash, response_json, created_at) VALUES (?, ?, ?, ?)').run(mutationId, payloadHash, JSON.stringify(result), now());
  return result;
};
const queueWrite = (action) => { const next = writeQueue.then(action, action); writeQueue = next.catch(() => {}); return next; };
const profile = () => db.prepare('SELECT id, baby_name, birth_date, gender, timezone, caregiver_name FROM profile WHERE id=1').get();
const validDateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00+08:00`)) && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(`${value}T00:00:00+08:00`)) === value;
const localDateOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(iso));
const parseTime = (value, name = '时间') => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) throw new Error(`${name}格式不正确`);
  const t = Date.parse(value); if (!Number.isFinite(t)) throw new Error(`${name}格式不正确`);
  return t;
};
const validateDetails = (type, details) => {
  if (!details || typeof details !== 'object' || Array.isArray(details)) throw new Error('记录内容不正确');
  if (type === 'bottle') {
    const amount = Number(details.amount_ml);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 2000) throw new Error('瓶喂量应为 1 至 2000 ml');
    details.amount_ml = Math.round(amount);
    details.kind = String(details.kind || '奶').slice(0, 20);
  }
  if (type === 'breast' && details.side && !['左', '右'].includes(details.side)) throw new Error('亲喂请选择左侧或右侧');
  if (type === 'diaper' && !['pee', 'poop', 'both'].includes(details.kind)) throw new Error('请选择尿布类型');
  if (type === 'diaper') {
    const rawUrine = details.urine_amount ?? '';
    if (rawUrine !== '' && !['轻', '中', '满'].includes(rawUrine)) {
      const amount = Number(rawUrine);
      if (!Number.isFinite(amount) || amount < 0 || amount > 5000) throw new Error('尿量应为 0 至 5000 克');
      details.urine_amount = Math.round(amount);
    } else details.urine_amount = rawUrine;
  }
  if (type === 'supplement' && (!String(details.name || '').trim() || String(details.name).length > 80)) throw new Error('请填写补剂名称');
  if (type === 'supplement') details.name = String(details.name).trim();
  if (type === 'growth') {
    const fields = [['weight_kg', 0.01, 100], ['length_cm', 0.1, 150], ['head_cm', 0.1, 100]];
    let count = 0;
    for (const [key, min, max] of fields) {
      if (details[key] === undefined || details[key] === '') continue;
      const value = Number(details[key]);
      if (!Number.isFinite(value) || value < min || value > max) throw new Error('生长测量数值不在可记录范围内');
      details[key] = value; count += 1;
    }
    if (!count) throw new Error('体重、卧位身长、头围至少填写一项');
  }
  if (type === 'vaccine') {
    details.name = String(details.name || '').trim(); details.category = String(details.category || '待确认'); details.status = String(details.status || 'planned'); details.dose = Number(details.dose);
    if (!details.name || details.name.length > 80) throw new Error('请填写疫苗名称');
    if (!Number.isInteger(details.dose) || details.dose < 1 || details.dose > 99) throw new Error('剂次应为正整数');
    if (!VACCINE_CATEGORIES.has(details.category) || !VACCINE_STATUSES.has(details.status)) throw new Error('疫苗分类或状态不正确');
    if (details.status === 'completed' && (!details.actual_date || !validDateOnly(details.actual_date))) throw new Error('已接种记录需要实际接种日期');
    if (details.status !== 'completed' && (!details.appointment_date || !validDateOnly(details.appointment_date))) throw new Error('预约或延期记录需要预约日期');
    if (details.status === 'deferred' && (!details.original_appointment_date || !validDateOnly(details.original_appointment_date))) throw new Error('延期记录需要保留原预约日期');
    for (const key of ['appointment_date', 'actual_date', 'original_appointment_date', 'next_appointment_date']) if (details[key] && !validDateOnly(details[key])) throw new Error('疫苗日期格式不正确');
    details.clinic = String(details.clinic || '').slice(0, 120); details.brand_batch = String(details.brand_batch || '').slice(0, 120); details.observation = String(details.observation || '').slice(0, 500);
  }
  if (type === 'food') {
    details.food_name = String(details.food_name || '').trim();
    if (!details.food_name || details.food_name.length > 80) throw new Error('请填写食材或菜品');
    details.amount_text = String(details.amount_text || '').slice(0, 120); details.texture = String(details.texture || '').slice(0, 80); details.first_try = Boolean(details.first_try);
    details.observation = String(details.observation || '未观察');
    if (!['未观察', '观察中', '本次未见异常', '有反应'].includes(details.observation)) throw new Error('观察状态不正确');
    details.reaction_at = details.reaction_at ? String(details.reaction_at) : ''; details.reaction_desc = String(details.reaction_desc || '').slice(0, 500);
  }
  return details;
};
const validateEvent = (input, allowOpen = true, birthDate = profile()?.birth_date) => {
  const type = String(input.type || '');
  if (!ALLOWED_TYPES.has(type)) throw new Error('记录类型不支持');
  const startMs = parseTime(input.start_at, '开始时间');
  const details = validateDetails(type, { ...(input.details || {}) });
  const vaccineFuture = type === 'vaccine' && ['planned', 'deferred'].includes(details.status);
  if (!vaccineFuture && startMs > Date.now() + 5 * 60 * 1000) throw new Error('不能记录未来时间');
  if (type === 'growth' || type === 'food') {
    if (birthDate && localDateOf(input.start_at) < birthDate) throw new Error('发生时间不能早于出生日期');
  }
  if (type === 'vaccine' && details.status === 'completed' && startMs > Date.now() + 5 * 60 * 1000) throw new Error('已接种记录不能使用未来日期');
  if (type === 'vaccine') {
    const expectedDate = details.status === 'completed' ? details.actual_date : details.appointment_date;
    if (localDateOf(input.start_at) !== expectedDate) throw new Error('疫苗日期与状态字段不一致');
  }
  if (type === 'food' && details.reaction_at) {
    const reactionMs = parseTime(details.reaction_at, '反应时间');
    if (reactionMs < startMs || reactionMs > Date.now() + 5 * 60 * 1000) throw new Error('反应时间应在尝试时间之后且不能晚于现在');
  }
  let endMs = null;
  if (HEALTH_TYPES.has(type)) {
    endMs = startMs;
  } else if (input.end_at !== null && input.end_at !== undefined && input.end_at !== '') {
    endMs = parseTime(input.end_at, '结束时间');
    if (endMs < startMs) throw new Error('结束时间不能早于开始时间');
    if (endMs > Date.now() + 5 * 60 * 1000 && !vaccineFuture) throw new Error('不能记录未来时间');
  } else if (!allowOpen) throw new Error('请填写结束时间');
  if (!TIMER_TYPES.has(type) && endMs === null) endMs = startMs;
  const note = String(input.note || '').slice(0, 500);
  return { type, start_at: new Date(startMs).toISOString(), end_at: endMs === null ? null : new Date(endMs).toISOString(), details, note };
};
const publicEvent = (row) => ({ ...row, details: JSON.parse(row.details), revoked: Boolean(row.revoked) });
const publicFavorite = (row) => ({ id: row.id, url: row.url, title: row.title, kind: row.kind, created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at, version: row.version });
const allFavorites = () => db.prepare('SELECT * FROM favorites ORDER BY updated_at DESC').all().map(publicFavorite);
const validateFavorite = (input) => {
  const rawUrl = String(input.url || '').trim();
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('资源链接格式不正确'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || rawUrl.length > 2000) throw new Error('只支持不含账号信息的 HTTP 或 HTTPS 链接');
  const title = String(input.title || '').trim();
  if (!title || title.length > 120) throw new Error('请填写不超过 120 字的资源名称');
  const kind = String(input.kind || 'other');
  if (!FAVORITE_KINDS.has(kind)) throw new Error('收藏类型不正确');
  return { url: rawUrl, title, kind };
};
const createFavorite = (body, caregiver) => {
  const input = validateFavorite(body);
  if (db.prepare('SELECT id FROM favorites WHERE url=?').get(input.url)) { const e = new Error('这个链接已经收藏'); e.status = 409; throw e; }
  const id = randomUUID(); const timestamp = now();
  db.prepare('INSERT INTO favorites (id,url,title,kind,created_by,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,1)').run(id, input.url, input.title, input.kind, caregiver, timestamp, timestamp);
  return { favorite: publicFavorite(db.prepare('SELECT * FROM favorites WHERE id=?').get(id)), favorites: allFavorites() };
};
const updateFavorite = (id, body, caregiver) => {
  const old = db.prepare('SELECT * FROM favorites WHERE id=?').get(id);
  if (!old) { const e = new Error('收藏不存在'); e.status = 404; throw e; }
  if (Number(body.expectedVersion) !== old.version) { const e = new Error('收藏已被其他设备修改，请刷新后再试'); e.status = 409; throw e; }
  const input = validateFavorite({ url: body.url ?? old.url, title: body.title ?? old.title, kind: body.kind ?? old.kind });
  const duplicate = db.prepare('SELECT id FROM favorites WHERE url=? AND id<>?').get(input.url, id);
  if (duplicate) { const e = new Error('这个链接已经收藏'); e.status = 409; throw e; }
  db.prepare('UPDATE favorites SET url=?,title=?,kind=?,updated_at=?,version=version+1 WHERE id=? AND version=?').run(input.url, input.title, input.kind, now(), id, old.version);
  return { favorite: publicFavorite(db.prepare('SELECT * FROM favorites WHERE id=?').get(id)), favorites: allFavorites() };
};
const deleteFavorite = (id, body) => {
  const old = db.prepare('SELECT * FROM favorites WHERE id=?').get(id);
  if (!old) { const e = new Error('收藏不存在'); e.status = 404; throw e; }
  if (Number(body.expectedVersion) !== old.version) { const e = new Error('收藏已被其他设备修改，请刷新后再试'); e.status = 409; throw e; }
  db.prepare('DELETE FROM favorites WHERE id=? AND version=?').run(id, old.version);
  return { ok: true, favorites: allFavorites() };
};
const videoFailure = (message = '视频不存在') => { const e = new Error(message); e.status = 404; throw e; };
const resolveVideo = (encodedId) => {
  let name;
  try { name = decodeURIComponent(encodedId); } catch { return videoFailure(); }
  if (!name || name.length > 255 || name === '.' || name === '..' || name !== basename(name) || name.includes('/') || name.includes('\\') || extname(name).toLowerCase() !== '.mp4') return videoFailure();
  const file = resolve(VIDEO_DIR, name);
  if (file !== VIDEO_DIR && !file.startsWith(VIDEO_DIR + sep)) return videoFailure();
  return { name, file };
};
const listVideos = async () => {
  let entries;
  try { entries = await readdir(VIDEO_DIR, { withFileTypes: true }); } catch { return []; }
  const videos = [];
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.mp4') continue;
    try {
      const info = await stat(join(VIDEO_DIR, entry.name));
      if (info.isFile()) videos.push({ id: entry.name, title: entry.name.replace(/\.[^.]+$/, ''), size_bytes: info.size, updated_at: info.mtime.toISOString(), stream: '/api/videos/' + encodeURIComponent(entry.name) + '/stream' });
    } catch {}
  }
  videos.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN', { numeric: true }));
  return videos;
};
const streamVideo = async (req, res, encodedId) => {
  const target = resolveVideo(encodedId);
  let info;
  try {
    const [rootPath, filePath] = await Promise.all([realpath(VIDEO_DIR), realpath(target.file)]);
    if (filePath !== rootPath && !filePath.startsWith(rootPath + sep)) return videoFailure();
    info = await stat(target.file);
  } catch { return videoFailure(); }
  if (!info.isFile()) return videoFailure();
  const size = info.size;
  if (size === 0) {
    res.writeHead(200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': 0, 'cache-control': 'private, max-age=3600' }); return res.end();
  }
  let start = 0; let end = Math.max(0, size - 1); let partial = false;
  const range = req.headers.range;
  if (range !== undefined) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (!match || size === 0) {
      res.writeHead(416, { 'content-range': 'bytes */' + size, 'accept-ranges': 'bytes' }); return res.end();
    }
    partial = true;
    if (match[1] === '') { const suffix = Number(match[2]); if (!Number.isFinite(suffix) || suffix <= 0) { res.writeHead(416, { 'content-range': 'bytes */' + size, 'accept-ranges': 'bytes' }); return res.end(); } start = Math.max(0, size - suffix); }
    else { start = Number(match[1]); end = match[2] === '' ? end : Number(match[2]); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) { res.writeHead(416, { 'content-range': 'bytes */' + size, 'accept-ranges': 'bytes' }); return res.end(); }
    end = Math.min(end, size - 1);
  }
  const length = end - start + 1;
  const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': length, 'cache-control': 'private, max-age=3600' };
  if (partial) headers['content-range'] = 'bytes ' + start + '-' + end + '/' + size;
  res.writeHead(partial ? 206 : 200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(target.file, { start, end }).on('error', () => res.destroy()).pipe(res);
};
const durationBetween = (event, rangeStart, rangeEnd) => {
  const start = Date.parse(event.start_at); const end = event.end_at ? Date.parse(event.end_at) : Date.now();
  if (event.type === 'breast' && Array.isArray(event.details?.intervals) && event.details.intervals.length) return event.details.intervals.reduce((total, part) => {
    const a = Math.max(Date.parse(part.start_at), rangeStart); const z = Math.min(Date.parse(part.end_at || now()), rangeEnd, Date.now()); return total + Math.max(0, z - a);
  }, 0);
  return Math.max(0, Math.min(end, rangeEnd, Date.now()) - Math.max(start, rangeStart));
};
const aiDetails = (event) => {
  const d = event.details || {};
  if (event.type === 'bottle') return { amount_ml: Number(d.amount_ml || 0), kind: String(d.kind || '奶').slice(0, 20) };
  if (event.type === 'breast') return { side: ['左', '右'].includes(d.side) ? d.side : '', paused: Boolean(d.paused) };
  if (event.type === 'diaper') return { kind: String(d.kind || ''), urine_amount: ['轻', '中', '满'].includes(d.urine_amount) ? d.urine_amount : Number(d.urine_amount || 0) };
  if (event.type === 'supplement') return {};
  return {};
};
const aiDateRange = (body) => {
  const startDate = String(body.startDate || '').trim(); const endDate = String(body.endDate || '').trim();
  if (!validDateOnly(startDate) || !validDateOnly(endDate) || startDate > endDate) throw new Error('请选择有效的起止日期');
  const start = dayBounds(startDate).start; const end = dayBounds(endDate).end;
  if (end - start > 31 * 86400000) throw new Error('交接摘要时间范围不能超过 31 天');
  const types = body.types === undefined ? [...AI_TYPES] : (Array.isArray(body.types) ? [...new Set(body.types.map(String))] : []);
  if (!types.length || types.some((type) => !AI_TYPES.has(type))) throw new Error('事件类型选择不正确');
  return { startDate, endDate, start, end, types };
};
const buildAiSnapshot = (body) => {
  const range = aiDateRange(body); const selectedEvents = allEvents().filter((event) => range.types.includes(event.type) && Date.parse(event.start_at) < range.end && (!event.end_at || Date.parse(event.end_at) >= range.start)); const events = selectedEvents.slice(0, 300);
  const snapshot = {
    range: { start: range.startDate, end: range.endDate },
    types: range.types,
    captured_at: now(),
    events: events.map((event) => ({ type: event.type, start_at: event.start_at, end_at: event.end_at, duration_seconds: Math.round(durationBetween(event, range.start, range.end) / 1000), details: aiDetails(event) })),
    total_events: selectedEvents.length,
    returned_events: events.length,
    truncated: selectedEvents.length > events.length,
    note: '这是用户选择的日常照护记录摘要数据，不含姓名、照护者署名、备注或成长/疫苗/辅食健康记录。'
  };
  return snapshot;
};
const aiEndpointAllowed = () => {
  if (!AI_ENDPOINT) return false;
  try { const endpoint = new URL(AI_ENDPOINT); return endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)); } catch { return false; }
};
const aiConfigured = () => Boolean(aiEndpointAllowed() && AI_API_KEY && AI_MODEL);
const storeAiSnapshot = (sessionHash, snapshot) => {
  const snapshotHash = hash(`${sessionHash}:${JSON.stringify(snapshot)}`); const expiresAt = Date.now() + 10 * 60 * 1000;
  aiSnapshots.set(snapshotHash, { sessionHash, snapshot, expiresAt });
  for (const [key, value] of aiSnapshots) if (value.expiresAt <= Date.now()) aiSnapshots.delete(key);
  let endpointHost = '';
  try { endpointHost = AI_ENDPOINT ? new URL(AI_ENDPOINT).host : ''; } catch {}
  return { snapshot, snapshotHash, expiresAt: new Date(expiresAt).toISOString(), configured: aiConfigured(), provider: { configured: aiConfigured(), model: AI_MODEL, endpointHost }, fieldsExcluded: ['baby_name', 'created_by', 'modified_by', 'note', 'growth', 'vaccine', 'food'] };
};
const generateAi = async (body, sessionHash) => {
  const item = aiSnapshots.get(String(body.snapshotHash || ''));
  if (!item || item.sessionHash !== sessionHash || item.expiresAt <= Date.now()) { const e = new Error('预览已过期，请重新预览后再生成'); e.status = 409; throw e; }
  if (!aiConfigured()) { const e = new Error('AI 服务尚未配置；请在服务器环境变量中设置 AI_ENDPOINT、AI_API_KEY 和 AI_MODEL'); e.status = 503; throw e; }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const payload = { model: AI_MODEL, temperature: 0.2, messages: [{ role: 'system', content: '请用简洁中文整理家庭照护交接重点。只根据给定记录，不作医疗判断，不补造未提供的信息。' }, { role: 'user', content: JSON.stringify(item.snapshot) }] };
  let response; let rawResponse;
  try {
    response = await fetch(AI_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${AI_API_KEY}` }, body: JSON.stringify(payload), signal: controller.signal });
    rawResponse = await response.text();
  } catch (e) { const errorValue = new Error(e?.name === 'AbortError' ? 'AI 服务请求超时' : 'AI 服务暂时不可用'); errorValue.status = 502; throw errorValue; } finally { clearTimeout(timer); }
  if (!response.ok) { const e = new Error(`AI 服务返回错误（${response.status}）`); e.status = 502; throw e; }
  let result; try { result = JSON.parse(rawResponse); } catch { const e = new Error('AI 服务返回的内容无法读取'); e.status = 502; throw e; }
  const text = result?.choices?.[0]?.message?.content ?? result?.choices?.[0]?.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) { const e = new Error('AI 服务没有返回可用摘要'); e.status = 502; throw e; }
  return { text: text.trim(), generated_at: now(), snapshotHash: String(body.snapshotHash) };
};
const generateAiIdempotent = async (body, sessionHash) => {
  const mutationId = String(body.mutationId || ''); const key = `${sessionHash}:${mutationId}`; const payloadHash = hash(JSON.stringify({ path: '/api/ai/generate', payload: body }));
  const cached = aiGenerationCache.get(key);
  if (cached) { if (cached.expiresAt > Date.now()) { if (cached.payloadHash !== payloadHash) { const e = new Error('请求标识已用于另一份内容'); e.status = 409; throw e; } return cached.result; } aiGenerationCache.delete(key); }
  const running = aiGenerationInflight.get(key);
  if (running) { if (running.payloadHash !== payloadHash) { const e = new Error('请求标识已用于另一份内容'); e.status = 409; throw e; } return running.promise; }
  const promise = (async () => { ensureSession(sessionHash); const result = await generateAi(body, sessionHash); ensureSession(sessionHash); aiGenerationCache.set(key, { payloadHash, result, expiresAt: Date.now() + 10 * 60 * 1000 }); return result; })();
  aiGenerationInflight.set(key, { payloadHash, promise });
  try { return await promise; } finally { if (aiGenerationInflight.get(key)?.promise === promise) aiGenerationInflight.delete(key); for (const [cacheKey, item] of aiGenerationCache) if (item.expiresAt <= Date.now()) aiGenerationCache.delete(cacheKey); }
};
const allEvents = (includeRevoked = false, limit = null) => {
  const sql = `SELECT * FROM events ${includeRevoked ? '' : 'WHERE revoked=0'} ORDER BY start_at DESC${limit ? ` LIMIT ${Number(limit)}` : ''}`;
  const rows = db.prepare(sql).all();
  return rows.map(publicEvent);
};
const dayBounds = (dateKey) => ({ start: Date.parse(`${dateKey}T00:00:00+08:00`), end: Date.parse(`${dateKey}T00:00:00+08:00`) + 86400000 });
const localDateKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d);
const durationInDay = (event, day) => {
  const b = dayBounds(day);
  if (event.type === 'breast' && Array.isArray(event.details?.intervals) && event.details.intervals.length) return event.details.intervals.reduce((sum, part) => { const a = Math.max(Date.parse(part.start_at), b.start); const z = Math.min(Date.parse(part.end_at || now()), b.end); return sum + Math.max(0, z - a); }, 0);
  const a = Math.max(Date.parse(event.start_at), b.start); const z = Math.min(Date.parse(event.end_at || now()), b.end);
  return Math.max(0, z - a);
};
const summary = () => {
  const day = localDateKey(); const rows = db.prepare('SELECT * FROM events WHERE revoked=0').all().map(publicEvent);
  const result = { day, bottle_ml: 0, breast_minutes: 0, breast_left_minutes: 0, breast_right_minutes: 0, sleep_minutes: 0, diaper_count: 0, urine_grams: 0, supplement_count: 0, play_minutes: 0, outing_minutes: 0, active: [] };
  const bounds = dayBounds(day);
  for (const e of rows) {
    const ms = durationInDay(e, day);
    const happenedToday = Date.parse(e.start_at) >= bounds.start && Date.parse(e.start_at) < bounds.end;
    if (e.type === 'bottle' && happenedToday) result.bottle_ml += Number(e.details.amount_ml || 0);
    if (e.type === 'breast') { const minutes = Math.round(ms / 60000); result.breast_minutes += minutes; if (e.details.side === '左') result.breast_left_minutes += minutes; if (e.details.side === '右') result.breast_right_minutes += minutes; }
    if (e.type === 'sleep') result.sleep_minutes += Math.round(ms / 60000);
    if (e.type === 'play') result.play_minutes += Math.round(ms / 60000);
    if (e.type === 'outing') result.outing_minutes += Math.round(ms / 60000);
    if (e.type === 'diaper' && happenedToday) { result.diaper_count += 1; const amount = Number(e.details.urine_amount); if (e.details.urine_amount !== '' && Number.isFinite(amount)) result.urine_grams += amount; }
    if (e.type === 'supplement' && happenedToday) result.supplement_count += 1;
    if (!e.end_at) result.active.push(e);
  }
  result.urine_grams = Math.round(result.urine_grams);
  return result;
};
const ensureUserEvent = (id) => {
  const row = db.prepare('SELECT * FROM events WHERE id=?').get(id);
  if (!row) { const e = new Error('记录不存在'); e.status = 404; throw e; }
  return row;
};
const mutationResponse = (row) => ({ event: publicEvent(row), summary: summary() });
const createEvent = (body, caregiver) => {
  const input = validateEvent(body); const activeConflict = !input.end_at && (input.type === 'breast'
    ? db.prepare("SELECT id FROM events WHERE type=? AND end_at IS NULL AND revoked=0 AND json_extract(details, '$.side')=?").get(input.type, input.details.side)
    : db.prepare('SELECT id FROM events WHERE type=? AND end_at IS NULL AND revoked=0').get(input.type));
  if (activeConflict) { const e = new Error(input.type === 'breast' ? '同侧已有进行中的记录' : '同类型已有进行中的记录'); e.status = 409; throw e; }
  const id = randomUUID(); const t = now();
  db.prepare(`INSERT INTO events (id,type,start_at,end_at,details,note,created_by,modified_by,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)`).run(id, input.type, input.start_at, input.end_at, JSON.stringify(input.details), input.note, caregiver, caregiver, t, t);
  return mutationResponse(db.prepare('SELECT * FROM events WHERE id=?').get(id));
};
const updateEvent = (id, body, caregiver) => {
  const old = ensureUserEvent(id); const expected = Number(body.expectedVersion);
  if (!Number.isInteger(expected) || expected !== old.version) { const e = new Error('记录已被其他设备修改，请刷新后再试'); e.status = 409; throw e; }
  const input = validateEvent({ ...old, ...body, type: old.type, details: body.details ?? JSON.parse(old.details), start_at: body.start_at ?? old.start_at, end_at: body.end_at === undefined ? old.end_at : body.end_at });
  if (!input.end_at && old.end_at) {
    const conflict = old.type === 'breast'
      ? db.prepare("SELECT id FROM events WHERE type=? AND end_at IS NULL AND revoked=0 AND id<>? AND json_extract(details, '$.side')=?").get(old.type, id, input.details.side)
      : db.prepare('SELECT id FROM events WHERE type=? AND end_at IS NULL AND revoked=0 AND id<>?').get(old.type, id);
    if (conflict) { const e = new Error(old.type === 'breast' ? '同侧已有进行中的记录' : '同类型已有进行中的记录'); e.status = 409; throw e; }
  }
  db.prepare('UPDATE events SET start_at=?, end_at=?, details=?, note=?, modified_by=?, version=version+1, updated_at=? WHERE id=? AND version=?').run(input.start_at, input.end_at, JSON.stringify(input.details), input.note, caregiver, now(), id, expected);
  return mutationResponse(ensureUserEvent(id));
};
const stopEvent = (id, body, caregiver) => {
  const old = ensureUserEvent(id); if (old.end_at) return mutationResponse(old);
  const endAt = body.end_at || now();
  const details = JSON.parse(old.details);
  if (old.type === 'breast' && Array.isArray(details.intervals)) { const active = details.intervals.find((part) => !part.end_at); if (active) active.end_at = endAt; details.paused = false; }
  return updateEvent(id, { expectedVersion: body.expectedVersion, end_at: endAt, details, note: old.note }, caregiver);
};
const revokeEvent = (id, body, caregiver) => {
  const old = ensureUserEvent(id); const expected = Number(body.expectedVersion);
  if (expected !== old.version) { const e = new Error('记录已被其他设备修改，请刷新后再试'); e.status = 409; throw e; }
  db.prepare('UPDATE events SET revoked=1, modified_by=?, version=version+1, updated_at=? WHERE id=? AND version=?').run(caregiver, now(), id, expected);
  return { event: publicEvent(db.prepare('SELECT * FROM events WHERE id=?').get(id)), summary: summary() };
};
const snapshot = async () => {
  const dir = join(DATA_DIR, 'backups'); await mkdir(dir, { recursive: true });
  const file = join(dir, `babymia-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  await backup(db, file);
  const files = (await readdir(dir)).filter((x) => x.endsWith('.sqlite')).sort().reverse();
  for (const old of files.slice(7)) await unlink(join(dir, old));
  return file;
};
const exportData = () => ({ format: 'babymia-backup', version: 4, exported_at: now(), profile: db.prepare('SELECT baby_name,birth_date,gender,timezone,caregiver_name FROM profile WHERE id=1').get(), events: allEvents(true, null), favorites: allFavorites(), stories: storyStore.list() });
const restoreData = async (body) => {
  if (!body || body.format !== 'babymia-backup' || ![1, 2, 3, 4].includes(body.version) || !body.profile || !Array.isArray(body.events)) throw new Error('备份文件格式不支持');
  if (!body.profile.baby_name || !validDateOnly(body.profile.birth_date) || body.profile.birth_date > localDateOf(now())) throw new Error('备份中的档案不完整');
  const ids = new Set(); const openTypes = new Set();
  const checked = body.events.map((x) => {
    if (!x.id || ids.has(String(x.id))) throw new Error('备份中存在重复记录编号');
    ids.add(String(x.id));
    if (!Number.isInteger(x.version) || x.version < 1) throw new Error('备份中的记录版本不正确');
    const event = validateEvent(x, true, body.profile.birth_date);
    if (!event.end_at && !x.revoked) { if (openTypes.has(event.type)) throw new Error('备份中存在多个同类进行中记录'); openTypes.add(event.type); }
    return event;
  });
  const favorites = body.version >= 3 ? body.favorites : [];
  if (!Array.isArray(favorites) || favorites.length > 300) throw new Error('备份中的收藏格式不正确');
  const favoriteIds = new Set(); const checkedFavorites = favorites.map((item) => {
    if (!item?.id || favoriteIds.has(String(item.id))) throw new Error('备份中存在重复收藏编号');
    favoriteIds.add(String(item.id));
    return { source: item, value: validateFavorite(item) };
  });
  const checkedStories = body.version >= 4 ? storyStore.validateBackup(body.stories) : null;
  const oldBackup = await snapshot();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE profile SET baby_name=?, birth_date=?, gender=?, timezone=?, caregiver_name=?, updated_at=? WHERE id=1').run(String(body.profile.baby_name).slice(0, 80), body.profile.birth_date, String(body.profile.gender || ''), 'Asia/Shanghai', String(body.profile.caregiver_name || '').slice(0, 80), now());
    db.exec('DELETE FROM events');
    const insert = db.prepare(`INSERT INTO events (id,type,start_at,end_at,details,note,created_by,modified_by,version,created_at,updated_at,revoked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const [i, x] of checked.entries()) { const source = body.events[i]; insert.run(String(source.id || randomUUID()), x.type, x.start_at, x.end_at, JSON.stringify(x.details), x.note, String(source.created_by || body.profile.caregiver_name), String(source.modified_by || body.profile.caregiver_name), Math.max(1, Number(source.version) || 1), String(source.created_at || now()), String(source.updated_at || now()), source.revoked ? 1 : 0); }
    db.exec('DELETE FROM favorites');
    const favoriteInsert = db.prepare('INSERT INTO favorites (id,url,title,kind,created_by,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?)');
    for (const item of checkedFavorites) { const source = item.source; favoriteInsert.run(String(source.id), item.value.url, item.value.title, item.value.kind, String(source.created_by || body.profile.caregiver_name).slice(0, 80), String(source.created_at || now()), String(source.updated_at || now()), Math.max(1, Number(source.version) || 1)); }
    if (checkedStories !== null) storyStore.restore(checkedStories);
    db.exec('DELETE FROM sessions');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { backup: basename(oldBackup), state: currentState() };
};
const healthState = () => {
  const p = profile();
  const events = allEvents().filter((event) => HEALTH_TYPES.has(event.type));
  return {
    growth: events.filter((event) => event.type === 'growth').map((event) => ({ ...event, growth: scoreGrowthEvent(whoReference, p, event) })),
    vaccine: events.filter((event) => event.type === 'vaccine'),
    food: events.filter((event) => event.type === 'food')
  };
};
const currentState = () => ({ profile: profile(), summary: summary(), events: allEvents(), health: healthState(), favorites: allFavorites(), reference: whoReference ? { ...whoReference, source: referenceSource(whoReference) } : { source: referenceSource(whoReference), available: false } });

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const path = url.pathname;
  if (req.method === 'GET' && path === '/api/status') return json(res, 200, { setup: Boolean(profile()) });
  if (req.method === 'POST' && path === '/api/setup') {
    if (!requireSameOrigin(req, res)) return;
    const body = await parseJson(req); const mutationId = requireMutation(body);
    const result = await queueWrite(() => withMutation(mutationId, req.method, path, body, () => {
      if (profile()) { const e = new Error('已经完成首次设置'); e.status = 409; throw e; }
      if (!String(body.babyName || '').trim() || !validDateOnly(body.birthDate) || body.birthDate > localDateOf(now()) || String(body.password || '').length < 8 || !String(body.caregiverName || '').trim()) throw new Error('请完整填写档案与至少 8 位访问口令');
      const salt = randomBytes(16).toString('hex'); const created = now();
      db.prepare('INSERT INTO profile (id,baby_name,birth_date,gender,timezone,caregiver_name,password_hash,password_salt,created_at,updated_at) VALUES (1,?,?,?,?,?,?,?,?,?)').run(String(body.babyName).trim().slice(0, 80), body.birthDate, String(body.gender || ''), 'Asia/Shanghai', String(body.caregiverName).trim().slice(0, 80), scryptSync(body.password, salt, 64).toString('hex'), salt, created, created);
      return { profile: profile() };
    }));
    return json(res, 201, result);
  }
  if (req.method === 'POST' && path === '/api/login') {
    if (!requireSameOrigin(req, res)) return; const ip = req.socket.remoteAddress || 'unknown'; const attempt = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (attempt.until > Date.now() && attempt.count >= 8) return error(res, 429, '尝试次数过多，请稍后再试');
    const body = await parseJson(req); const p = db.prepare('SELECT * FROM profile WHERE id=1').get();
    const valid = p && typeof body.password === 'string' && timingSafeEqual(Buffer.from(scryptSync(body.password, p.password_salt, 64).toString('hex')), Buffer.from(p.password_hash));
    if (!valid) { const next = attempt.until > Date.now() ? { count: attempt.count + 1, until: attempt.until } : { count: 1, until: Date.now() + 60000 }; loginAttempts.set(ip, next); return error(res, 401, '口令不正确'); }
    loginAttempts.delete(ip); const raw = randomBytes(32).toString('base64url'); const caregiver = String(body.caregiverName || p.caregiver_name).trim().slice(0, 80) || p.caregiver_name; db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(raw), new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(), caregiver);
    return json(res, 200, { profile: profile() }, { 'set-cookie': `babymia_session=${encodeURIComponent(raw)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}` });
  }
  if (req.method === 'GET' && path.startsWith('/assets/')) return staticFile(req, res, path.slice(8));
  if (path.startsWith('/api/')) {
    const s = auth(req, res); if (!s) return;
    const sessionHash = hash(cookie(req, 'babymia_session'));
    if (req.method !== 'GET' && !requireSameOrigin(req, res)) return;
    if (req.method === 'POST' && path === '/api/logout') { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(cookie(req, 'babymia_session'))); return json(res, 200, { ok: true }, { 'set-cookie': 'babymia_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }); }
    if (req.method === 'GET' && path === '/api/state') return json(res, 200, { ...currentState(), profile: { ...profile(), caregiver_name: s.caregiver_name } });
    if (req.method === 'GET' && path === '/api/export') return json(res, 200, exportData(), { 'content-disposition': 'attachment; filename="babymia-backup.json"' });
    if (req.method === 'POST' && path === '/api/media/inspect') {
      const buffer = await parseBinary(req);
      return json(res, 200, inspectMediaBuffer(buffer, { name: url.searchParams.get('name'), browserType: url.searchParams.get('type'), modified: url.searchParams.get('modified') }));
    }
    if (req.method === 'POST' && path === '/api/live-photo') return json(res, 201, await saveLivePhoto(req, s.caregiver_name));
    if (req.method === 'GET' && path === '/api/live-photos') return json(res, 200, { items: allLivePhotos() });
    const livePhotoManifestMatch = path.match(/^\/api\/live-photo\/([0-9a-f-]{36})$/i);
    if (livePhotoManifestMatch && req.method === 'GET') return json(res, 200, oneLivePhotoManifest(livePhotoManifestMatch[1]));
    const livePhotoMatch = path.match(/^\/api\/live-photo\/([0-9a-f-]{36})\/(image|video)$/i);
    if (livePhotoMatch && ['GET', 'HEAD'].includes(req.method)) return streamLivePhotoMedia(req, res, livePhotoMatch[1], livePhotoMatch[2], url.searchParams.get('download') === '1');
    if (req.method === 'POST' && path === '/api/family-media') return json(res, 201, await saveFamilyMedia(req, s.caregiver_name));
    if (req.method === 'GET' && path === '/api/family-media') return json(res, 200, { items: allFamilyMedia() });
    const familyMediaMatch = path.match(/^\/api\/family-media\/([0-9a-f-]{36})\/file$/i);
    if (familyMediaMatch && ['GET', 'HEAD'].includes(req.method)) return streamFamilyMedia(req, res, familyMediaMatch[1], url.searchParams.get('download') === '1');
    if (req.method === 'GET' && path === '/api/videos') return json(res, 200, { videos: await listVideos(), directory_hint: VIDEO_DIRECTORY_HINT });
    const videoMatch = path.match(/^\/api\/videos\/([^/]+)\/stream$/);
    if (videoMatch && ['GET', 'HEAD'].includes(req.method)) return streamVideo(req, res, videoMatch[1]);
    if (req.method === 'GET' && path === '/api/stories') return json(res, 200, { stories: storyStore.list() });
    if (req.method === 'POST' && ['/api/stories', '/api/stories/import'].includes(path)) {
      const body = await parseJson(req, path.endsWith('/import') ? 4 * 1024 * 1024 : MAX_BODY); const mutationId = requireMutation(body);
      return json(res, 201, await queueWrite(() => withSessionMutation(sessionHash, mutationId, req.method, path, body, () => path.endsWith('/import') ? storyStore.importStories(body) : storyStore.create(body))));
    }
    const storyMatch = path.match(/^\/api\/stories\/([^/]+)$/);
    if (storyMatch && ['PATCH', 'DELETE'].includes(req.method)) {
      const body = await parseJson(req); const mutationId = requireMutation(body);
      return json(res, 200, await queueWrite(() => withSessionMutation(sessionHash, mutationId, req.method, path, body, () => req.method === 'PATCH' ? storyStore.update(storyMatch[1], body) : storyStore.remove(storyMatch[1], body))));
    }
    if (req.method === 'GET' && path === '/api/favorites') return json(res, 200, { favorites: allFavorites() });
    if (req.method === 'POST' && path === '/api/favorites') {
      const body = await parseJson(req); const mutationId = requireMutation(body);
      return json(res, 201, await queueWrite(() => withSessionMutation(sessionHash, mutationId, req.method, path, body, () => createFavorite(body, s.caregiver_name))));
    }
    const favoriteMatch = path.match(/^\/api\/favorites\/([^/]+)$/);
    if (favoriteMatch && req.method === 'PATCH') {
      const body = await parseJson(req); const mutationId = requireMutation(body);
      return json(res, 200, await queueWrite(() => withSessionMutation(sessionHash, mutationId, req.method, path, body, () => updateFavorite(favoriteMatch[1], body, s.caregiver_name))));
    }
    if (favoriteMatch && req.method === 'DELETE') {
      const body = await parseJson(req); const mutationId = requireMutation(body);
      return json(res, 200, await queueWrite(() => withSessionMutation(sessionHash, mutationId, req.method, path, body, () => deleteFavorite(favoriteMatch[1], body))));
    }
    if (req.method === 'POST' && path === '/api/ai/preview') {
      const body = await parseJson(req); const mutationId = requireMutation(body);
      return json(res, 200, await queueWrite(() => withSessionMutation(sessionHash, mutationId, req.method, path, body, () => storeAiSnapshot(sessionHash, buildAiSnapshot(body)))));
    }
    if (req.method === 'POST' && path === '/api/ai/generate') {
      const body = await parseJson(req); requireMutation(body); ensureSession(sessionHash);
      return json(res, 200, await generateAiIdempotent(body, sessionHash));
    }
    if (req.method === 'PATCH' && path === '/api/profile') {
      const body = await parseJson(req); const mutationId = requireMutation(body);
      return json(res, 200, await queueWrite(() => withSessionMutation(sessionHash, mutationId, req.method, path, body, () => {
        if (!String(body.babyName || '').trim() || !validDateOnly(body.birthDate) || body.birthDate > localDateOf(now()) || !String(body.caregiverName || '').trim()) throw new Error('请完整填写档案');
        db.prepare('UPDATE profile SET baby_name=?, birth_date=?, gender=?, caregiver_name=?, updated_at=? WHERE id=1').run(String(body.babyName).trim().slice(0, 80), body.birthDate, String(body.gender || ''), String(body.caregiverName).trim().slice(0, 80), now());
        db.prepare('UPDATE sessions SET caregiver_name=? WHERE token_hash=?').run(String(body.caregiverName).trim().slice(0, 80), hash(cookie(req, 'babymia_session')));
        return { profile: profile() };
      })));
    }
    if (req.method === 'PATCH' && path === '/api/password') {
      const body = await parseJson(req); const mutationId = requireMutation(body);
      return json(res, 200, await queueWrite(() => withSessionMutation(sessionHash, mutationId, req.method, path, body, () => {
        const p = db.prepare('SELECT password_hash,password_salt FROM profile WHERE id=1').get();
        if (!p || typeof body.oldPassword !== 'string' || !timingSafeEqual(Buffer.from(scryptSync(body.oldPassword, p.password_salt, 64).toString('hex')), Buffer.from(p.password_hash))) throw new Error('旧口令不正确');
        if (typeof body.newPassword !== 'string' || body.newPassword.length < 8) throw new Error('新口令至少需要 8 位');
        const salt = randomBytes(16).toString('hex'); db.prepare('UPDATE profile SET password_hash=?, password_salt=?, updated_at=? WHERE id=1').run(scryptSync(body.newPassword, salt, 64).toString('hex'), salt, now()); db.exec('DELETE FROM sessions');
        return { ok: true };
      })));
    }
    if (req.method === 'POST' && path === '/api/events') { const body = await parseJson(req); const mutationId = requireMutation(body); return json(res, 201, await queueWrite(() => withSessionMutation(sessionHash, mutationId, req.method, path, body, () => createEvent(body, s.caregiver_name)))); }
    const match = path.match(/^\/api\/events\/([^/]+)(?:\/(stop|revoke))?$/);
    if (match && req.method === 'PATCH') { const body = await parseJson(req); const mutationId = requireMutation(body); const action = match[2]; return json(res, 200, await queueWrite(() => withSessionMutation(sessionHash, mutationId, req.method, path, body, () => action === 'stop' ? stopEvent(match[1], body, s.caregiver_name) : action === 'revoke' ? revokeEvent(match[1], body, s.caregiver_name) : updateEvent(match[1], body, s.caregiver_name)))); }
    if (req.method === 'POST' && path === '/api/restore') {
      const body = await parseJson(req, 20 * 1024 * 1024); const mutationId = requireMutation(body); if (body.confirm !== '覆盖并恢复') return error(res, 400, '请输入“覆盖并恢复”确认恢复');
      return json(res, 200, await queueWrite(() => { ensureSession(sessionHash); return withAsyncMutation(mutationId, req.method, path, body, () => restoreData(body)); }));
    }
    return error(res, 404, '接口不存在');
  }
  if (req.method === 'GET' && (path === '/' || path === '/index.html')) return staticFile(req, res, 'index.html');
  if (req.method === 'GET') return error(res, 404, '页面不存在');
  return error(res, 404, '页面不存在');
}
async function staticFile(req, res, relative) {
  const allowed = new Set(['index.html', 'app.js', 'companion-content.js', 'styles.css', 'live-photo.css', 'baby-care-icons.png', 'icon-bottle.png', 'icon-breast.png', 'icon-sleep.png', 'icon-diaper.png', 'icon-supplement.png', 'icon-play.png', 'icon-outing.png']); const name = basename(relative);
  if (relative.includes('..') || !allowed.has(name) || name !== relative) return error(res, 404, '页面不存在');
  try { const body = await readFile(join(PUBLIC_DIR, name)); const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' }; res.writeHead(200, { 'content-type': types[extname(name)], 'cache-control': 'no-cache' }); res.end(body); } catch { error(res, 404, '页面不存在'); }
}
const server = http.createServer((req, res) => route(req, res).catch((e) => error(res, e.status || 400, safeMessage(e))));
let lastSnapshotDay = '';
const ensureDailySnapshot = async () => {
  const day = localDateKey();
  if (day === lastSnapshotDay) return;
  try { await snapshot(); lastSnapshotDay = day; console.log(`Daily SQLite snapshot created for ${day}`); } catch (e) { console.error(`Daily snapshot skipped: ${safeMessage(e)}`); }
};
server.listen(PORT, HOST, () => { console.log(`BabyMia listening on http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`); ensureDailySnapshot(); });
setInterval(ensureDailySnapshot, 6 * 60 * 60 * 1000).unref();
process.on('SIGTERM', () => { db.close(); server.close(); });
export { db, server, currentState, snapshot, DB_FILE };
