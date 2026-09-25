import { randomUUID } from 'node:crypto';

const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const text = (value, max, label, optional = false) => {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) fail(label + '格式或长度不正确');
  return value.trim();
};
export function validateStory(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('故事格式不正确');
  const title = text(input.title, 120, '故事标题');
  const subtitle = text(input.subtitle, 300, '故事简介', true);
  if (!Array.isArray(input.segments) || !input.segments.length || input.segments.length > 50) fail('每篇故事需要 1–50 段');
  const segments = input.segments.map((s, i) => {
    if (!s || typeof s !== 'object') fail('第 ' + (i + 1) + ' 段格式不正确');
    return { zh: text(s.zh, 4000, '中文段落'), en: text(s.en, 6000, '英文段落'), prompt: text(s.prompt, 500, '共读提示', true) };
  });
  const result = { title, subtitle, segments };
  if (Buffer.byteLength(JSON.stringify(result)) > 180000) fail('单篇故事不能超过 180 KB');
  return result;
}

export function createStoryStore(db, seeds) {
  db.exec('CREATE TABLE IF NOT EXISTS stories (id TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS story_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const decode = row => ({ ...JSON.parse(row.content), id: row.id, version: row.version, created_at: row.created_at, updated_at: row.updated_at });
  const list = () => db.prepare('SELECT * FROM stories ORDER BY created_at, rowid').all().map(decode);
  const insert = (story, id = randomUUID(), version = 1, created = new Date().toISOString(), updated = created) => {
    db.prepare('INSERT INTO stories (id,content,version,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, JSON.stringify(story), version, created, updated);
    return decode(db.prepare('SELECT * FROM stories WHERE id=?').get(id));
  };
  // A migration marker preserves intentional empty libraries across upgrades and restarts.
  if (!db.prepare("SELECT value FROM story_meta WHERE key='seeded'").get()) {
    const checked = seeds.map(validateStory);
    db.exec('BEGIN IMMEDIATE');
    try { if (!list().length) checked.forEach(s => insert(s)); db.prepare("INSERT INTO story_meta VALUES ('seeded','1')").run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  const existing = (id, version) => {
    const row = db.prepare('SELECT * FROM stories WHERE id=?').get(id);
    if (!row) fail('故事不存在，请刷新故事库', 404);
    if (!Number.isInteger(version) || row.version !== version) fail('故事已被其他设备修改，请刷新后重新编辑', 409);
    return row;
  };
  const checkCapacity = count => { if (list().length + count > 100) fail('故事库最多保存 100 篇'); };
  const create = body => { checkCapacity(1); return { story: insert(validateStory(body)) }; };
  const update = (id, body) => {
    existing(id, body.expectedVersion); const story = validateStory(body);
    db.prepare('UPDATE stories SET content=?, version=version+1, updated_at=? WHERE id=?').run(JSON.stringify(story), new Date().toISOString(), id);
    return { story: decode(db.prepare('SELECT * FROM stories WHERE id=?').get(id)) };
  };
  const remove = (id, body) => { existing(id, body.expectedVersion); db.prepare('DELETE FROM stories WHERE id=?').run(id); return { ok: true }; };
  const importStories = body => {
    if (body.format !== 'babymia-stories' || body.version !== 1 || !Array.isArray(body.stories) || !body.stories.length || body.stories.length > 20) fail('请选择故事包 v1，一次导入 1–20 篇');
    checkCapacity(body.stories.length); const checked = body.stories.map(validateStory);
    const fingerprints = new Set(list().map(s => JSON.stringify(validateStory(s))));
    for (const s of checked) { const fingerprint = JSON.stringify(s); if (fingerprints.has(fingerprint)) fail('存在完全相同的故事：' + s.title, 409); fingerprints.add(fingerprint); }
    // Called inside the request mutation transaction: all stories succeed or none do.
    return { stories: checked.map(s => insert(s)) };
  };
  const validateBackup = stories => {
    if (!Array.isArray(stories) || stories.length > 100) fail('备份中的故事库格式不正确');
    const ids = new Set();
    return stories.map(s => {
      const value = validateStory(s);
      if (typeof s.id !== 'string' || !s.id || s.id.length > 100 || ids.has(s.id) || !Number.isInteger(s.version) || s.version < 1) fail('备份中的故事编号或版本不正确');
      ids.add(s.id);
      return { ...value, id: s.id, version: s.version, created_at: s.created_at, updated_at: s.updated_at };
    });
  };
  const restore = checked => { db.exec('DELETE FROM stories'); for (const s of checked) insert(validateStory(s), s.id, s.version, typeof s.created_at === 'string' ? s.created_at : undefined, typeof s.updated_at === 'string' ? s.updated_at : undefined); };
  return { list, create, update, remove, importStories, validateBackup, restore };
}
