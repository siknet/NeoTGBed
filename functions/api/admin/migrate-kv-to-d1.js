/**
 * KV -> D1 数据平滑迁移 API
 * POST /api/admin/migrate-kv-to-d1
 * 管理员专用，逐批将旧 KV 中的文件元数据导入到 D1 数据库
 */

import { checkAuthentication } from '../../utils/auth.js';
import { saveFileRecord } from '../../utils/db.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. 鉴权
  const auth = await checkAuthentication(context);
  if (!auth.authenticated) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. 检查配置
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 binding (DB) is not configured in Cloudflare Pages.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!env.img_url) {
    return new Response(JSON.stringify({ error: 'KV binding (img_url) is not configured.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') || undefined;
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10));

  try {
    const listResult = await env.img_url.list({ limit, cursor });
    const keys = listResult.keys || [];

    let migratedCount = 0;
    let skippedCount = 0;

    for (const item of keys) {
      const keyName = item.name;
      // 过滤系统临时 key
      if (keyName.startsWith('session:') || keyName.startsWith('chunk:') || keyName.startsWith('upload:')) {
        skippedCount += 1;
        continue;
      }

      // 获取元数据
      let metadata = item.metadata;
      if (!metadata) {
        const full = await env.img_url.getWithMetadata(keyName);
        metadata = full?.metadata;
      }

      if (metadata) {
        await saveFileRecord(env, keyName, metadata);
        migratedCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      batchSize: keys.length,
      migratedCount,
      skippedCount,
      nextCursor: listResult.list_complete ? null : listResult.cursor,
      isComplete: listResult.list_complete,
      message: listResult.list_complete
        ? 'All KV records have been migrated to D1 successfully!'
        : 'Batch completed. Call again with nextCursor to continue migration.',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
