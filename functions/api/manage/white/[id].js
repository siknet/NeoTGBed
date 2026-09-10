import { getFileRecord, saveFileRecord } from '../../../utils/db.js';

function decodeFileId(raw) {
  try {
    return decodeURIComponent(raw || '');
  } catch {
    return String(raw || '');
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequest(context) {
  const { params, env } = context;

  if (!env.DB && !env.img_url) {
    return jsonResponse({ success: false, error: 'Database binding is not configured.' }, 500);
  }

  const fileId = decodeFileId(params.id);
  const { record, kvKey } = await getFileRecord(env, fileId);

  if (!record?.metadata) {
    return jsonResponse({ success: false, error: `Image metadata not found for ID: ${fileId}` }, 404);
  }

  const metadata = {
    ...record.metadata,
    ListType: 'White',
  };

  await saveFileRecord(env, kvKey, metadata);

  return jsonResponse({ success: true, listType: metadata.ListType, key: kvKey });
}
