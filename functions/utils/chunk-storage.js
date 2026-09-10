/**
 * 分片上传任务存储辅助层 (D1 / R2 / KV 兼容)
 * 优先使用 D1 或 R2 管理分片状态，避免强依赖 KV 导致配额耗尽。
 */

const TASK_TTL_MS = 3600 * 1000; // 1小时超时
let d1TableInitialized = false;

/**
 * 确保存储 chunk_uploads 任务表的 D1 表存在
 */
async function ensureD1ChunkTable(db) {
  if (d1TableInitialized || !db) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS chunk_uploads (
        upload_id TEXT PRIMARY KEY,
        task_data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `).run();
    d1TableInitialized = true;
  } catch (e) {
    // 忽略并发建表或已存在的错误
    d1TableInitialized = true;
  }
}

/**
 * 保存分片任务元数据
 */
export async function saveUploadTask(env, uploadId, taskData) {
  const expiresAt = Date.now() + TASK_TTL_MS;
  const taskJson = JSON.stringify(taskData);

  // 1. 如果有 D1，写入 D1
  if (env.DB) {
    try {
      await ensureD1ChunkTable(env.DB);
      await env.DB.prepare(`
        INSERT INTO chunk_uploads (upload_id, task_data, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(upload_id) DO UPDATE SET
          task_data = excluded.task_data,
          expires_at = excluded.expires_at
      `).bind(uploadId, taskJson, expiresAt).run();
      return;
    } catch (err) {
      console.warn('D1 saveUploadTask error, falling back:', err.message);
    }
  }

  // 2. 如果有 R2，可存入 R2 内部临时对象
  if (env.R2_BUCKET) {
    try {
      await env.R2_BUCKET.put(`chunk-upload/${uploadId}/task.json`, taskJson, {
        customMetadata: { expiresAt: String(expiresAt) },
      });
      return;
    } catch (err) {
      console.warn('R2 saveUploadTask error, falling back:', err.message);
    }
  }

  // 3. 降级使用 KV
  if (env.img_url) {
    await env.img_url.put(`upload:${uploadId}`, taskJson, {
      expirationTtl: 3600,
    });
  }
}

/**
 * 获取分片任务元数据
 */
export async function getUploadTask(env, uploadId) {
  // 1. 从 D1 读取
  if (env.DB) {
    try {
      await ensureD1ChunkTable(env.DB);
      const row = await env.DB.prepare(
        'SELECT task_data, expires_at FROM chunk_uploads WHERE upload_id = ?'
      ).bind(uploadId).first();

      if (row) {
        if (row.expires_at && Date.now() > row.expires_at) {
          // 已过期，异步清理
          env.DB.prepare('DELETE FROM chunk_uploads WHERE upload_id = ?').bind(uploadId).run().catch(() => {});
          return null;
        }
        return JSON.parse(row.task_data);
      }
    } catch (err) {
      console.warn('D1 getUploadTask error:', err.message);
    }
  }

  // 2. 从 R2 读取
  if (env.R2_BUCKET) {
    try {
      const obj = await env.R2_BUCKET.get(`chunk-upload/${uploadId}/task.json`);
      if (obj) {
        const text = await obj.text();
        return JSON.parse(text);
      }
    } catch (err) {
      console.warn('R2 getUploadTask error:', err.message);
    }
  }

  // 3. 从 KV 读取
  if (env.img_url) {
    return await env.img_url.get(`upload:${uploadId}`, { type: 'json' });
  }

  return null;
}

/**
 * 清理分片任务元数据
 */
export async function deleteUploadTask(env, uploadId) {
  if (env.DB) {
    try {
      await ensureD1ChunkTable(env.DB);
      await env.DB.prepare('DELETE FROM chunk_uploads WHERE upload_id = ?').bind(uploadId).run();
    } catch (err) {
      console.warn('D1 deleteUploadTask error:', err.message);
    }
  }

  if (env.R2_BUCKET) {
    try {
      await env.R2_BUCKET.delete(`chunk-upload/${uploadId}/task.json`);
    } catch (err) {
      console.warn('R2 deleteUploadTask error:', err.message);
    }
  }

  if (env.img_url) {
    try {
      await env.img_url.delete(`upload:${uploadId}`);
    } catch (err) {
      console.warn('KV deleteUploadTask error:', err.message);
    }
  }
}
