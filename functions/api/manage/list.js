const INVALID_PREFIXES = ['session:', 'chunk:', 'upload:', 'temp:'];

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'ico', 'svg', 'heic', 'heif', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'm4v', '3gp', 'ts']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'ape', 'opus']);

function normalizeFolderPath(value = '') {
  const raw = String(value || '').replace(/\\/g, '/').trim();
  const output = [];
  for (const part of raw.split('/')) {
    const piece = part.trim();
    if (!piece || piece === '.') continue;
    if (piece === '..') {
      output.pop();
      continue;
    }
    output.push(piece);
  }
  return output.join('/');
}

function inferStorageType(name, metadata = {}) {
  const explicit = metadata.storageType || metadata.storage;
  if (explicit) return String(explicit).toLowerCase();

  const keyName = String(name || '');
  if (keyName.startsWith('r2:')) return 'r2';
  if (keyName.startsWith('s3:')) return 's3';
  if (keyName.startsWith('discord:')) return 'discord';
  if (keyName.startsWith('hf:')) return 'huggingface';
  if (keyName.startsWith('webdav:')) return 'webdav';
  if (keyName.startsWith('github:')) return 'github';
  return 'telegram';
}

function inferFileType(name, metadata = {}) {
  const sourceName = metadata.fileName || name || '';
  const segments = String(sourceName).split('.');
  const ext = segments.length > 1 ? segments.pop().toLowerCase() : '';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return 'document';
}

function isFolderMarker(key) {
  if (!key?.name) return false;
  if (String(key.name).startsWith('folder:')) return true;
  return key.metadata?.folderMarker === true;
}

function shouldIncludeKey(key) {
  if (!key?.name) return false;
  if (INVALID_PREFIXES.some((item) => key.name.startsWith(item))) return false;
  if (isFolderMarker(key)) return false;

  const metadata = key.metadata || {};
  return Boolean(metadata.fileName) && metadata.TimeStamp !== undefined && metadata.TimeStamp !== null;
}

function normalizeKey(key) {
  const metadata = key.metadata || {};
  const storageType = inferStorageType(key.name, metadata);
  const fileType = inferFileType(key.name, metadata);
  const folderPath = normalizeFolderPath(metadata.folderPath || metadata.path || '');

  return {
    ...key,
    metadata: {
      ...metadata,
      storageType,
      fileType,
      folderPath,
    },
  };
}

function matchStorage(storageType, storageFilter) {
  if (!storageFilter) return true;
  if (storageFilter === 'kv' || storageFilter === 'telegram') return storageType === 'telegram';
  return storageType === storageFilter;
}

function matchFolder(folderPath, folderFilter) {
  if (!folderFilter) return true;
  return normalizeFolderPath(folderPath) === folderFilter;
}

function compareByTimestampDesc(a, b) {
  const left = Number(a?.metadata?.TimeStamp || 0);
  const right = Number(b?.metadata?.TimeStamp || 0);
  return right - left;
}

function compareByFileSizeAsc(a, b) {
  const left = Number(a?.metadata?.fileSize || 0);
  const right = Number(b?.metadata?.fileSize || 0);
  if (left !== right) return left - right;
  const leftTs = Number(a?.metadata?.TimeStamp || 0);
  const rightTs = Number(b?.metadata?.TimeStamp || 0);
  return rightTs - leftTs;
}

function computeStats(files) {
  const stats = {
    total: 0,
    byType: { image: 0, video: 0, audio: 0, document: 0 },
    byStorage: {
      telegram: 0,
      r2: 0,
      s3: 0,
      discord: 0,
      huggingface: 0,
      webdav: 0,
      github: 0,
    },
  };

  for (const file of files) {
    const fileType = file.metadata?.fileType || 'document';
    const storageType = file.metadata?.storageType || 'telegram';

    stats.total += 1;
    if (Object.prototype.hasOwnProperty.call(stats.byType, fileType)) {
      stats.byType[fileType] += 1;
    } else {
      stats.byType.document += 1;
    }

    if (Object.prototype.hasOwnProperty.call(stats.byStorage, storageType)) {
      stats.byStorage[storageType] += 1;
    }
  }

  return stats;
}

function collectFolderPaths(files, folderMarkers = []) {
  const paths = new Set();

  for (const marker of folderMarkers) {
    const metadataPath = normalizeFolderPath(marker?.metadata?.folderPath || marker?.metadata?.path || '');
    const keyPath = String(marker?.name || '').startsWith('folder:')
      ? normalizeFolderPath(String(marker.name).slice('folder:'.length))
      : '';
    const path = metadataPath || keyPath;
    if (path) {
      paths.add(path);
      includeParentPaths(path, paths);
    }
  }

  for (const file of files) {
    const path = normalizeFolderPath(file?.metadata?.folderPath || '');
    if (!path) continue;
    paths.add(path);
    includeParentPaths(path, paths);
  }

  return paths;
}

function includeParentPaths(pathValue, targetSet) {
  const parts = normalizeFolderPath(pathValue).split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i += 1) {
    targetSet.add(parts.slice(0, i).join('/'));
  }
}

function buildFolderNodes(files, folderMarkers = []) {
  const fileCountByFolder = new Map();
  for (const file of files) {
    const folderPath = normalizeFolderPath(file?.metadata?.folderPath || '');
    if (!folderPath) continue;
    fileCountByFolder.set(folderPath, (fileCountByFolder.get(folderPath) || 0) + 1);
  }

  const folderPaths = [...collectFolderPaths(files, folderMarkers)].sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    return a.localeCompare(b, 'en', { sensitivity: 'base' });
  });

  return folderPaths.map((pathValue) => {
    const parts = pathValue.split('/');
    const name = parts[parts.length - 1] || pathValue;
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    return {
      path: pathValue,
      name,
      parentPath,
      depth: parts.length,
      fileCount: fileCountByFolder.get(pathValue) || 0,
    };
  });
}

async function listAllKeys(env, prefix = '') {
  const allKeys = [];
  let cursor = undefined;
  let guard = 0;

  do {
    const page = await env.img_url.list({ limit: 1000, cursor, prefix: prefix || undefined });
    allKeys.push(...(page.keys || []));
    cursor = page.list_complete ? undefined : page.cursor;
    guard += 1;
  } while (cursor && guard < 10000);

  return allKeys;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!env.DB && !env.img_url) {
    return new Response(JSON.stringify({ error: 'Neither D1 (DB) nor KV (img_url) is configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawLimit = url.searchParams.get('limit');
  let limit = parseInt(rawLimit || '100', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  if (limit > 1000) limit = 1000;

  const offset = Math.max(0, parseInt(url.searchParams.get('cursor') || '0', 10) || 0);
  const prefix = url.searchParams.get('prefix') || '';
  const storageFilter = String(url.searchParams.get('storage') || '').toLowerCase();
  const folderFilter = normalizeFolderPath(url.searchParams.get('folderPath') || url.searchParams.get('folder') || '');
  const sort = String(url.searchParams.get('sort') || '').toLowerCase();
  const includeStats = ['1', 'true', 'yes'].includes(
    String(url.searchParams.get('includeStats') || url.searchParams.get('stats') || '').toLowerCase()
  );
  const includeFolders = ['1', 'true', 'yes'].includes(
    String(url.searchParams.get('includeFolders') || '').toLowerCase()
  );

  // 1. 如果配置了 D1，直接通过 D1 高性能查询，彻底免受 KV 限制
  if (env.DB) {
    try {
      const conditions = [];
      const params = [];

      if (prefix) {
        conditions.push('id LIKE ?');
        params.push(`${prefix}%`);
      }
      if (storageFilter && storageFilter !== 'all') {
        if (storageFilter === 'kv' || storageFilter === 'telegram') {
          conditions.push("storage_type = 'telegram'");
        } else {
          conditions.push('storage_type = ?');
          params.push(storageFilter);
        }
      }
      if (folderFilter) {
        conditions.push('folder_path = ?');
        params.push(folderFilter);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const orderBy = (sort === 'sizeasc' || sort === 'smallfirst')
        ? 'ORDER BY file_size ASC, timestamp DESC'
        : 'ORDER BY timestamp DESC';

      const countQuery = `SELECT COUNT(*) AS total FROM files ${whereClause}`;
      const totalRow = await env.DB.prepare(countQuery).bind(...params).first();
      const totalCount = Number(totalRow?.total || 0);

      const dataQuery = `SELECT * FROM files ${whereClause} ${orderBy} LIMIT ? OFFSET ?`;
      const { results: rows } = await env.DB.prepare(dataQuery).bind(...params, limit, offset).all();

      const pageKeys = (rows || []).map((row) => {
        let meta = {};
        try {
          meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
        } catch {
          meta = {};
        }
        meta.fileName = row.file_name || meta.fileName;
        meta.fileSize = row.file_size || meta.fileSize;
        meta.fileType = row.file_type || meta.fileType;
        meta.storageType = row.storage_type || meta.storageType;
        meta.folderPath = row.folder_path || meta.folderPath;
        meta.ListType = row.list_type || meta.ListType || 'None';
        meta.Label = row.label || meta.Label || 'None';
        meta.liked = Boolean(row.liked);
        meta.TimeStamp = row.timestamp || meta.TimeStamp;

        return {
          name: row.id,
          metadata: meta,
        };
      });

      const nextOffset = offset + limit < totalCount ? offset + limit : null;
      const payload = {
        keys: pageKeys,
        pageCount: pageKeys.length,
        cursor: nextOffset == null ? null : String(nextOffset),
        list_complete: nextOffset == null,
      };

      if (includeStats) {
        const statsRows = await env.DB.prepare('SELECT file_type, storage_type FROM files').all();
        const allList = (statsRows?.results || []).map((r) => ({
          metadata: { fileType: r.file_type, storageType: r.storage_type },
        }));
        payload.stats = computeStats(allList);
      }

      if (includeFolders) {
        const folderRows = await env.DB.prepare('SELECT DISTINCT folder_path FROM files WHERE folder_path != ""').all();
        const folderSet = new Set();
        (folderRows?.results || []).forEach((r) => {
          if (r.folder_path) {
            folderSet.add(r.folder_path);
            includeParentPaths(r.folder_path, folderSet);
          }
        });
        payload.folders = [...folderSet].sort().map((p) => ({
          path: p,
          name: p.split('/').pop(),
          parentPath: p.includes('/') ? p.substring(0, p.lastIndexOf('/')) : null,
          depth: p.split('/').length,
          fileCount: 0,
        }));
      }

      return new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (d1Error) {
      console.warn('D1 list query failed, falling back to KV:', d1Error.message);
    }
  }

  // 2. 降级使用原有 KV 逻辑
  const allKeys = await listAllKeys(env, prefix);
  const folderMarkers = allKeys.filter(isFolderMarker);

  const normalizedFiles = allKeys
    .filter(shouldIncludeKey)
    .map(normalizeKey)
    .filter((item) => matchStorage(item.metadata?.storageType, storageFilter));

  const sorter = (sort === 'sizeasc' || sort === 'smallfirst')
    ? compareByFileSizeAsc
    : compareByTimestampDesc;

  const filtered = normalizedFiles
    .filter((item) => matchFolder(item.metadata?.folderPath || '', folderFilter))
    .sort(sorter);

  const page = filtered.slice(offset, offset + limit);
  const nextOffset = offset + limit < filtered.length ? offset + limit : null;

  const payload = {
    keys: page,
    pageCount: page.length,
    cursor: nextOffset == null ? null : String(nextOffset),
    list_complete: nextOffset == null,
  };

  if (includeStats) {
    payload.stats = computeStats(filtered);
  }

  if (includeFolders) {
    payload.folders = buildFolderNodes(normalizedFiles, folderMarkers);
  }

  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}
