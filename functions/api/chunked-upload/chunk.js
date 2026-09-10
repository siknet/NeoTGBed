/**
 * Upload one file chunk.
 * POST /api/chunked-upload/chunk
 */
import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';
import { getUploadTask, saveUploadTask } from '../../utils/chunk-storage.js';

const TEMP_CHUNK_PREFIX = 'chunk-upload';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (isAuthRequired(env)) {
      const auth = await checkAuthentication(context);
      if (!auth.authenticated) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
    }

    if (!env.DB && !env.R2_BUCKET && !env.img_url) {
      return jsonResponse({ error: 'No storage available for chunk upload task state.' }, 500);
    }

    const formData = await request.formData();
    const uploadId = formData.get('uploadId');
    const chunkIndex = parseInt(formData.get('chunkIndex'), 10);
    const chunk = formData.get('chunk');

    if (!uploadId || Number.isNaN(chunkIndex) || !chunk) {
      return jsonResponse({ error: '缺少必要参数' }, 400);
    }

    const taskData = await getUploadTask(env, uploadId);
    if (!taskData) {
      return jsonResponse({ error: '上传任务不存在或已过期' }, 404);
    }
    const totalChunks = Number(taskData.totalChunks || 0);
    if (!Number.isFinite(totalChunks) || totalChunks <= 0) {
      return jsonResponse({ error: 'Invalid totalChunks in upload task.' }, 400);
    }

    const chunkBackend = resolveChunkBackend(taskData, env);
    const minimizeKvWrites = isKvWriteMinimized(env);

    if (!minimizeKvWrites && Array.isArray(taskData.uploadedChunks) && taskData.uploadedChunks.includes(chunkIndex)) {
      return jsonResponse({
        success: true,
        message: '分片已存在',
        uploadedChunks: taskData.uploadedChunks,
      });
    }

    const chunkArrayBuffer = await chunk.arrayBuffer();

    if (chunkBackend === 'r2') {
      if (!env.R2_BUCKET) {
        return jsonResponse({ error: 'R2 chunk backend requested but R2_BUCKET is not configured.' }, 500);
      }

      if (taskData.r2Multipart?.uploadId && taskData.r2Multipart?.key) {
        // R2 原生分片上传：partNumber 从 1 开始
        const mpUpload = env.R2_BUCKET.resumeMultipartUpload(taskData.r2Multipart.key, taskData.r2Multipart.uploadId);
        await mpUpload.uploadPart(chunkIndex + 1, chunkArrayBuffer);
      } else {
        await env.R2_BUCKET.put(getChunkObjectKey(uploadId, chunkIndex), chunkArrayBuffer, {
          customMetadata: {
            type: 'chunk',
            uploadId,
            chunkIndex: String(chunkIndex),
            createdAt: String(Date.now()),
          },
        });
      }
    } else {
      if (!env.img_url) {
        return jsonResponse({ error: 'Neither R2 nor KV is available to store chunk data.' }, 500);
      }
      await env.img_url.put(`chunk:${uploadId}:${chunkIndex}`, chunkArrayBuffer, {
        expirationTtl: 3600,
        metadata: {
          type: 'chunk',
          uploadId,
          chunkIndex,
          createdAt: Date.now(),
        },
      });
    }

    let uploadedChunks = taskData.uploadedChunks || [];
    // 当使用 R2 存储分片时，分片文件本身已经在 R2 桶中作为实体存在，无需每个分片重复更新 D1/KV 任务表
    if (!minimizeKvWrites && chunkBackend !== 'r2') {
      uploadedChunks = Array.from(new Set([...uploadedChunks, chunkIndex])).sort((a, b) => a - b);
      taskData.uploadedChunks = uploadedChunks;
      taskData.chunkBackend = chunkBackend;

      await saveUploadTask(env, uploadId, taskData);
    }

    const progress = (((chunkIndex + 1) / totalChunks) * 100).toFixed(1);

    return jsonResponse({
      success: true,
      chunkIndex,
      uploadedChunks,
      chunkBackend,
      progress,
    });
  } catch (error) {
    console.error('Chunk upload error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isKvWriteMinimized(env) {
  return env.MINIMIZE_KV_WRITES === 'true';
}

function resolveChunkBackend(taskData, env) {
  if (taskData?.chunkBackend === 'r2' && env.R2_BUCKET) return 'r2';
  if (taskData?.chunkBackend === 'kv') return 'kv';
  return env.R2_BUCKET ? 'r2' : 'kv';
}

function getChunkObjectKey(uploadId, chunkIndex) {
  return `${TEMP_CHUNK_PREFIX}/${uploadId}/${chunkIndex}`;
}
