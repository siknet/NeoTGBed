import { 
  checkAuthentication,
  isAuthRequired 
} from '../../utils/auth.js';

async function errorHandling(context) {
    try {
      return await context.next();
    } catch (err) {
      return new Response(`${err.message}\n${err.stack}`, { status: 500 });
    }
  }

  function UnauthorizedException(reason) {
    return new Response(reason, {
        status: 401,
        statusText: 'Unauthorized',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'Cache-Control': 'no-store',
          'Content-Length': reason.length,
        },
      });
  }
  
  function BadRequestException(reason) {
    return new Response(reason, {
        status: 400,
        statusText: 'Bad Request',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'Cache-Control': 'no-store',
          'Content-Length': reason.length,
        },
      });
  }
  
  
  async function authentication(context) {
    // 检查 D1 或 KV 是否绑定
    const hasDb = (context.env.DB !== undefined && context.env.DB !== null && context.env.DB !== '') ||
                  (context.env.img_url !== undefined && context.env.img_url !== null && context.env.img_url !== '');
    if (!hasDb) {
        return new Response('Dashboard is disabled. Please bind a D1 (DB) or KV (img_url) database to use this feature.', { status: 200 });
    }

    // 如果没有配置认证，直接放行
    if (!isAuthRequired(context.env)) {
        return context.next();
    }
    
    // 使用统一的认证检查（支持 Cookie session 和 Basic Auth）
    const authResult = await checkAuthentication(context);
    
    if (authResult.authenticated) {
        return context.next();
    }
    
    // 认证失败，返回 401
    return new Response('You need to login.', {
        status: 401,
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'Cache-Control': 'no-store',
        },
    });
  }
  
  export const onRequest = [errorHandling, authentication];