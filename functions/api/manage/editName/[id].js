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
  const { request, params, env } = context;

  if (!env.DB && !env.img_url) {
    return jsonResponse({ success: false, error: 'Database binding is not configured.' }, 500);
  }

  const url = new URL(request.url);
  const requestedName = (url.searchParams.get('newName') || params.name || '').trim();

  if (!requestedName) {
    return jsonResponse({ success: false, error: 'newName is required.' }, 400);
  }

  if (requestedName.length > 180) {
    return jsonResponse({ success: false, error: 'newName is too long.' }, 400);
  }

  const fileId = decodeFileId(params.id);
  const { record, kvKey } = await getFileRecord(env, fileId);

  if (!record?.metadata) {
    return jsonResponse({ success: false, error: `Image metadata not found for ID: ${fileId}` }, 404);
  }

  const metadata = {
    ...record.metadata,
    fileName: requestedName,
  };

  await saveFileRecord(env, kvKey, metadata);

  return jsonResponse({ success: true, fileName: metadata.fileName, key: kvKey });
}
