/**
 * D1 & KV 混合/适配层
 * 当绑定了 env.DB (Cloudflare D1) 时优先走 D1，读写性能提升 50~100 倍，免除 KV 配额耗尽
 * 如果未绑定 env.DB，则平滑降级使用原有的 env.img_url (KV)
 */

export const STORAGE_PREFIXES = ['img:', 'vid:', 'aud:', 'doc:', 'r2:', 's3:', 'discord:', 'hf:', 'webdav:', 'github:', ''];

/**
 * 获取文件记录（带元数据）
 * 优先从 D1 查询，若没有则从 KV 查询
 */
export async function getFileRecord(env, fileId) {
  // 1. 如果配置了 D1
  if (env.DB) {
    try {
      const hasKnownPrefix = STORAGE_PREFIXES.some((prefix) => prefix && fileId.startsWith(prefix));
      const candidateKeys = hasKnownPrefix ? [fileId] : STORAGE_PREFIXES.map((prefix) => `${prefix}${fileId}`);

      const placeholders = candidateKeys.map(() => '?').join(',');
      const row = await env.DB.prepare(
        `SELECT * FROM files WHERE id IN (${placeholders}) OR file_id = ? LIMIT 1`
      ).bind(...candidateKeys, fileId).first();

      if (row) {
        let meta = {};
        try {
          meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
        } catch {
          meta = {};
        }

        // 补全必要字段
        meta.fileName = row.file_name || meta.fileName;
        meta.fileSize = row.file_size || meta.fileSize;
        meta.storageType = row.storage_type || meta.storageType;
        meta.folderPath = row.folder_path || meta.folderPath;
        meta.ListType = row.list_type || meta.ListType || 'None';
        meta.Label = row.label || meta.Label || 'None';
        meta.liked = Boolean(row.liked);
        meta.TimeStamp = row.timestamp || meta.TimeStamp;

        return {
          record: {
            value: '',
            metadata: meta,
          },
          kvKey: row.id,
          fromD1: true,
        };
      }
    } catch (err) {
      console.warn('D1 getFileRecord error, falling back to KV:', err.message);
    }
  }

  // 2. 降级使用 KV
  if (env.img_url) {
    const hasKnownPrefix = STORAGE_PREFIXES.some((prefix) => prefix && fileId.startsWith(prefix));
    const candidateKeys = hasKnownPrefix ? [fileId] : STORAGE_PREFIXES.map((prefix) => `${prefix}${fileId}`);

    for (const key of candidateKeys) {
      const record = await env.img_url.getWithMetadata(key);
      if (record?.metadata) {
        return { record, kvKey: key, fromD1: false };
      }
    }
  }

  return { record: null, kvKey: fileId, fromD1: false };
}

/**
 * 保存/更新文件元数据到 D1（同时可兼容写入 KV）
 */
export async function saveFileRecord(env, key, metadata = {}) {
  const metaObj = { ...metadata };
  const fileName = String(metaObj.fileName || key);
  const fileSize = Number(metaObj.fileSize || 0);
  const fileType = String(metaObj.fileType || 'image');
  const storageType = String(metaObj.storageType || metaObj.storage || 'telegram');
  const folderPath = String(metaObj.folderPath || '');
  const listType = String(metaObj.ListType || 'None');
  const label = String(metaObj.Label || 'None');
  const liked = metaObj.liked ? 1 : 0;
  const timestamp = Number(metaObj.TimeStamp || Date.now());
  const metaJson = JSON.stringify(metaObj);

  // 提取原始 file_id
  let fileId = key;
  for (const p of STORAGE_PREFIXES) {
    if (p && fileId.startsWith(p)) {
      fileId = fileId.slice(p.length);
      break;
    }
  }

  if (env.DB) {
    try {
      await env.DB.prepare(`
        INSERT INTO files (id, file_id, file_name, file_size, file_type, storage_type, folder_path, list_type, label, liked, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          file_name = excluded.file_name,
          file_size = excluded.file_size,
          file_type = excluded.file_type,
          storage_type = excluded.storage_type,
          folder_path = excluded.folder_path,
          list_type = excluded.list_type,
          label = excluded.label,
          liked = excluded.liked,
          timestamp = excluded.timestamp,
          metadata = excluded.metadata
      `).bind(key, fileId, fileName, fileSize, fileType, storageType, folderPath, listType, label, liked, timestamp, metaJson).run();
    } catch (err) {
      console.error('D1 saveFileRecord error:', err);
    }
  }

  // 同步写一份 KV（双写保证兼容，若 KV 已经满额报错则安全忽略）
  if (env.img_url) {
    try {
      await env.img_url.put(key, '', { metadata: metaObj });
    } catch (kvErr) {
      console.warn('KV write ignored (quota exceeded or warning):', kvErr.message);
    }
  }
}

/**
 * 删除文件记录
 */
export async function deleteFileRecord(env, key) {
  if (env.DB) {
    try {
      await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(key).run();
    } catch (err) {
      console.error('D1 deleteFileRecord error:', err);
    }
  }
  if (env.img_url) {
    try {
      await env.img_url.delete(key);
    } catch (kvErr) {
      console.warn('KV delete ignored:', kvErr.message);
    }
  }
}
