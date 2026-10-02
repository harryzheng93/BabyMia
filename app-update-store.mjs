import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const METADATA_FILE = 'latest.json';
const MAX_APK_BYTES = 250 * 1024 * 1024;

const parseRelease = (release) => {
  const tag = String(release?.tag_name || '');
  const versionName = /^android-v([0-9]+(?:\.[0-9]+)*)$/.exec(tag)?.[1];
  const versionCode = Number(/versionCode:\s*(\d+)/i.exec(String(release?.body || ''))?.[1]);
  const asset = Array.isArray(release?.assets)
    ? release.assets.find((item) => String(item?.name || '').toLowerCase().endsWith('.apk'))
    : null;
  if (!versionName || !Number.isSafeInteger(versionCode) || versionCode < 1 || !asset?.browser_download_url) {
    throw new Error('GitHub Android Release 缺少版本号或 APK');
  }
  return {
    releaseTag: tag,
    versionName,
    versionCode,
    publishedAt: String(release.published_at || ''),
    releaseNotes: String(release.body || '').replace(/^versionCode:\s*\d+\s*/i, '').trim().slice(0, 4000),
    sourceUrl: String(asset.browser_download_url),
  };
};

export const createAppUpdateStore = ({ directory, releaseApiUrl, fetchImpl = fetch, clock = () => new Date() }) => {
  const metadataPath = join(directory, METADATA_FILE);

  const latest = async () => {
    try {
      const value = JSON.parse(await readFile(metadataPath, 'utf8'));
      const fileName = basename(String(value.fileName || ''));
      if (!fileName.endsWith('.apk') || !existsSync(join(directory, fileName))) return null;
      return { ...value, fileName };
    } catch {
      return null;
    }
  };

  const apkPath = async () => {
    const value = await latest();
    return value ? join(directory, value.fileName) : null;
  };

  const sync = async () => {
    await mkdir(directory, { recursive: true });
    const releaseResponse = await fetchImpl(releaseApiUrl, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'BabyMia-update-sync' },
    });
    if (!releaseResponse.ok) throw new Error(`GitHub Release 查询失败：HTTP ${releaseResponse.status}`);
    const candidate = parseRelease(await releaseResponse.json());
    const current = await latest();
    if (current?.releaseTag === candidate.releaseTag && current.versionCode === candidate.versionCode) return current;

    const apkResponse = await fetchImpl(candidate.sourceUrl, { headers: { 'user-agent': 'BabyMia-update-sync' } });
    if (!apkResponse.ok) throw new Error(`APK 下载失败：HTTP ${apkResponse.status}`);
    const bytes = Buffer.from(await apkResponse.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_APK_BYTES) throw new Error('APK 文件大小不正确');
    const fileName = `BabyMia-${candidate.versionName}-release.apk`;
    const target = join(directory, fileName);
    const temporary = join(directory, `.download-${process.pid}-${Date.now()}.tmp`);
    await writeFile(temporary, bytes);
    await rm(target, { force: true });
    await rename(temporary, target);
    const metadata = {
      ...candidate,
      fileName,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      syncedAt: clock().toISOString(),
    };
    const metadataTemporary = join(directory, `.metadata-${process.pid}-${Date.now()}.tmp`);
    await writeFile(metadataTemporary, JSON.stringify(metadata, null, 2), 'utf8');
    await rm(metadataPath, { force: true });
    await rename(metadataTemporary, metadataPath);
    for (const name of await readdir(directory)) {
      if (name.endsWith('.apk') && name !== fileName) await rm(join(directory, name), { force: true });
    }
    return metadata;
  };

  const describeFile = async () => {
    const value = await latest();
    if (!value) return null;
    const file = join(directory, value.fileName);
    const info = await stat(file);
    return { metadata: value, file, size: info.size };
  };

  return { latest, apkPath, sync, describeFile };
};

