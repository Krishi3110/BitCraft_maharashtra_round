import { describe, it, expect } from 'vitest';
import { signJWT, verifyJWT, encodeBase64Url } from '../src/auth/jwt';
import { authenticate } from '../src/auth/middleware';

const SECRET = 'a_very_long_secure_secret_for_testing_purposes_only';

describe('Auth Identity & Session Utility', () => {
  it('1. Valid token accepted', async () => {
    const payload = {
      sub: 'p_123',
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    };
    const token = await signJWT(payload, SECRET);
    const verified = await verifyJWT(token, SECRET);
    expect(verified.sub).toBe('p_123');
  });

  it('2. Invalid signature rejected', async () => {
    const payload = {
      sub: 'p_123',
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    };
    const token = await signJWT(payload, SECRET);
    const parts = token.split('.');
    
    // Tamper payload
    const forgedPayload = encodeBase64Url(JSON.stringify({ ...payload, sub: 'p_hacker' }));
    const forgedToken = `${parts[0]}.${forgedPayload}.${parts[2]}`;

    await expect(verifyJWT(forgedToken, SECRET)).rejects.toThrow('Invalid signature');
  });

  it('3. Expired token rejected', async () => {
    const payload = {
      sub: 'p_123',
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000) - 7200, // Issued 2 hours ago
      exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      jti: 'j_123'
    };
    const token = await signJWT(payload, SECRET);
    await expect(verifyJWT(token, SECRET)).rejects.toThrow('Token expired');
  });

  it('4. Wrong issuer/audience rejected', async () => {
    const basePayload = {
      sub: 'p_123',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    };
    
    const badIssToken = await signJWT({ ...basePayload, iss: 'hacker', aud: 'fairdrop-client' }, SECRET);
    await expect(verifyJWT(badIssToken, SECRET)).rejects.toThrow('Invalid issuer');

    const badAudToken = await signJWT({ ...basePayload, iss: 'fairdrop', aud: 'hacker' }, SECRET);
    await expect(verifyJWT(badAudToken, SECRET)).rejects.toThrow('Invalid audience');
  });

  it('5. Missing secret fails safely', async () => {
    const payload = {
      sub: 'p_123',
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    };
    await expect(signJWT(payload, '')).rejects.toThrow('missing or too short');
  });

  it('6. Cookie and Bearer authentication work', async () => {
    const token = await signJWT({
      sub: 'p_123',
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    }, SECRET);

    // Test Bearer (Simulator style)
    const reqBearer = new Request('http://localhost/api/v1/drops/1/join', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const ctxBearer = await authenticate(reqBearer, SECRET);
    expect(ctxBearer.participantId).toBe('p_123');
    expect(ctxBearer.source).toBe('bearer');

    // Test Cookie (Browser style)
    const reqCookie = new Request('http://localhost/api/v1/drops/1/join', {
      method: 'POST',
      headers: { 'Cookie': `session=${token}`, 'Origin': 'http://localhost' }
    });
    const ctxCookie = await authenticate(reqCookie, SECRET);
    expect(ctxCookie.participantId).toBe('p_123');
    expect(ctxCookie.source).toBe('cookie');
  });

  it('7. Client-supplied participant identity cannot override token identity', async () => {
    // Identity is derived purely from authenticate() returning context. 
    // It ignores any ?participant= querystring or body payload by design.
    // We assert this by proving authenticate only reads the header/cookie.
    const token = await signJWT({
      sub: 'p_real',
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    }, SECRET);

    const req = new Request('http://localhost/api/v1/drops/1/status?participant=p_hacker', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const ctx = await authenticate(req, SECRET);
    expect(ctx.participantId).toBe('p_real');
    expect(ctx.participantId).not.toBe('p_hacker');
  });

  it('8. Cookie-authenticated mutation rejects invalid Origin', async () => {
    const token = await signJWT({
      sub: 'p_123',
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    }, SECRET);

    const reqMissingOrigin = new Request('https://api.fairdrop.com/api/v1/drops/1/join', {
      method: 'POST',
      headers: { 'Cookie': `session=${token}` } // Missing Origin
    });
    await expect(authenticate(reqMissingOrigin, SECRET)).rejects.toThrow('CSRF origin mismatch');

    const reqBadOrigin = new Request('https://api.fairdrop.com/api/v1/drops/1/join', {
      method: 'POST',
      headers: { 'Cookie': `session=${token}`, 'Origin': 'https://hacker.com' }
    });
    await expect(authenticate(reqBadOrigin, SECRET)).rejects.toThrow('CSRF origin mismatch');

    // Check GET doesn't require origin check
    const reqGet = new Request('https://api.fairdrop.com/api/v1/drops/1/status', {
      method: 'GET',
      headers: { 'Cookie': `session=${token}`, 'Origin': 'https://hacker.com' }
    });
    const ctxGet = await authenticate(reqGet, SECRET);
    expect(ctxGet.participantId).toBe('p_123'); // Succeeds because it's a read operation
  });
});
