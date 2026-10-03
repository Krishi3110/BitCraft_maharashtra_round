export interface JWTPayload {
  sub: string; // participant_id
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

const encoder = new TextEncoder();

export function encodeBase64Url(input: Uint8Array | string): string {
  const buf = typeof input === 'string' ? encoder.encode(input) : input;
  const base64 = btoa(String.fromCharCode(...buf));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBase64Url(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(base64 + padding), c => c.charCodeAt(0));
}

async function getCryptoKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET is missing or too short (min 32 bytes required)');
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signJWT(payload: JWTPayload, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = encodeBase64Url(JSON.stringify(header));
  const payloadB64 = encodeBase64Url(JSON.stringify(payload));
  const dataToSign = `${headerB64}.${payloadB64}`;

  const key = await getCryptoKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(dataToSign));
  
  const signatureB64 = encodeBase64Url(new Uint8Array(signature));
  return `${dataToSign}.${signatureB64}`;
}

export async function verifyJWT(token: string, secret: string, expectedIss = 'fairdrop', expectedAud = 'fairdrop-client'): Promise<JWTPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const dataToVerify = `${headerB64}.${payloadB64}`;

  const key = await getCryptoKey(secret);
  const signatureBytes = decodeBase64Url(signatureB64);
  
  const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(dataToVerify));
  if (!isValid) {
    throw new Error('Invalid signature');
  }

  const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadB64))) as JWTPayload;
  
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired');
  }
  if (payload.iss !== expectedIss) {
    throw new Error('Invalid issuer');
  }
  if (payload.aud !== expectedAud) {
    throw new Error('Invalid audience');
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!payload.sub || typeof payload.sub !== 'string' || !uuidRegex.test(payload.sub)) {
    throw new Error('Invalid subject: must be a valid UUID');
  }

  return payload;
}
