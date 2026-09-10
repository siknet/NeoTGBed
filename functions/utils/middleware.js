/**
 * 轻量化中间件：处理全局异常
 * 避免依赖外部 sentry 第三方 npm 包导致 Cloudflare 构建失败
 */

export async function errorHandling(context) {
  try {
    return await context.next();
  } catch (err) {
    console.error('Unhandled request error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export function telemetryData(context) {
  // 无需外部遥测上报，直接放行
  return typeof context.next === 'function' ? context.next() : undefined;
}

export async function traceData() {
  // no-op
}
