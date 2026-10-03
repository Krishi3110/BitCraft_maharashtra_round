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

export async function authenticate(request: Request, secret: string): Promise<AuthContext> {
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
    const url = new URL(request.url);
    
    // In production, you would check against a strict whitelist of allowed origins.
    // For this demonstration, we enforce that Origin must match the requested Host,
    // or allow local development origins if applicable.
    if (!origin || (origin !== url.origin && !origin.startsWith('http://localhost'))) {
      throw new Error('CSRF origin mismatch');
    }
  }

  const payload = await verifyJWT(token, secret);
  return {
    participantId: payload.sub,
    source
  };
}
