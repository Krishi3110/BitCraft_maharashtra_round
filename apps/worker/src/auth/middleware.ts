import { verifyJWT, JWTPayload } from './jwt';

export interface AuthContext {
  participantId: string;
  source: 'cookie' | 'bearer';
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, val] = cookie.split('=').map(c => c.trim());
    if (key && val) acc[key] = val;
    return acc;
  }, {} as Record<string, string>);
}

export async function authenticate(request: Request, secret: string, allowedOrigins: string[] = []): Promise<AuthContext> {
  const authHeader = request.headers.get('Authorization');
  const cookieHeader = request.headers.get('Cookie');
  
  let token: string | null = null;
  let source: 'cookie' | 'bearer' | null = null;

  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
    source = 'bearer';
  } else if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    if (cookies['session']) {
      token = cookies['session'];
      source = 'cookie';
    }
  }

  if (!token || !source) {
    throw new Error('Missing authentication token');
  }

  // Validate CSRF for cookie-based state-changing requests
  if (source === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('Origin');
    if (!origin) {
      throw new Error('CSRF origin mismatch: missing Origin header');
    }

    let isAllowed = false;
    try {
      const originUrl = new URL(origin);
      const requestUrl = new URL(request.url);

      if (originUrl.origin === requestUrl.origin) {
        isAllowed = true;
      } else if ((originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') && originUrl.protocol === 'http:') {
        isAllowed = true;
      } else if (allowedOrigins.includes(originUrl.origin)) {
        isAllowed = true;
      }
    } catch {
      throw new Error('CSRF origin mismatch: malformed origin');
    }

    if (!isAllowed) {
      throw new Error('CSRF origin mismatch: unauthorized origin');
    }
  }

  const payload = await verifyJWT(token, secret);
  return {
    participantId: payload.sub,
    source
  };
}
