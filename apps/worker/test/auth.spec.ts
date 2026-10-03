import { describe, it, expect } from 'vitest';
import { signJWT, verifyJWT, encodeBase64Url } from '../src/auth/jwt';
import { authenticate } from '../src/auth/middleware';

const SECRET = 'a_very_long_secure_secret_for_testing_purposes_only';
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const ANOTHER_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('Auth Identity & Session Utility', () => {
  it('1. Valid token accepted', async () => {
    const payload = {
      sub: VALID_UUID,
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    };
    const token = await signJWT(payload, SECRET);
    const verified = await verifyJWT(token, SECRET);
    expect(verified.sub).toBe(VALID_UUID);
  });

  it('2. Invalid signature rejected', async () => {
    const payload = {
      sub: VALID_UUID,
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    };
    const token = await signJWT(payload, SECRET);
    const parts = token.split('.');
    
    // Tamper payload
    const forgedPayload = encodeBase64Url(JSON.stringify({ ...payload, sub: ANOTHER_UUID }));
    const forgedToken = `${parts[0]}.${forgedPayload}.${parts[2]}`;

    await expect(verifyJWT(forgedToken, SECRET)).rejects.toThrow('Invalid signature');
  });

  it('3. Expired token rejected', async () => {
    const payload = {
      sub: VALID_UUID,
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000) - 7200, 
      exp: Math.floor(Date.now() / 1000) - 3600, 
      jti: 'j_123'
    };
    const token = await signJWT(payload, SECRET);
    await expect(verifyJWT(token, SECRET)).rejects.toThrow('Token expired');
  });

  it('4. Wrong issuer/audience rejected', async () => {
    const basePayload = {
      sub: VALID_UUID,
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
      sub: VALID_UUID,
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
      sub: VALID_UUID,
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    }, SECRET);

    const reqBearer = new Request('http://localhost/api/v1/drops/1/join', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const ctxBearer = await authenticate(reqBearer, SECRET);
    expect(ctxBearer.participantId).toBe(VALID_UUID);
    expect(ctxBearer.source).toBe('bearer');

    const reqCookie = new Request('http://localhost/api/v1/drops/1/join', {
      method: 'POST',
      headers: { 'Cookie': `session=${token}`, 'Origin': 'http://localhost' }
    });
    const ctxCookie = await authenticate(reqCookie, SECRET);
    expect(ctxCookie.participantId).toBe(VALID_UUID);
    expect(ctxCookie.source).toBe('cookie');
  });

  it('7. Client-supplied participant identity cannot override token identity', async () => {
    const token = await signJWT({
      sub: VALID_UUID,
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    }, SECRET);

    const req = new Request(`http://localhost/api/v1/drops/1/status?participant=${ANOTHER_UUID}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const ctx = await authenticate(req, SECRET);
    expect(ctx.participantId).toBe(VALID_UUID);
    expect(ctx.participantId).not.toBe(ANOTHER_UUID);
  });

  it('8. Cookie-authenticated mutation rejects invalid Origin', async () => {
    const token = await signJWT({
      sub: VALID_UUID,
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    }, SECRET);

    // Missing origin
    const reqMissingOrigin = new Request('https://api.fairdrop.com/api/v1/drops/1/join', {
      method: 'POST',
      headers: { 'Cookie': `session=${token}` } 
    });
    await expect(authenticate(reqMissingOrigin, SECRET)).rejects.toThrow('CSRF origin mismatch');

    // Random malicious origin
    const reqBadOrigin = new Request('https://api.fairdrop.com/api/v1/drops/1/join', {
      method: 'POST',
      headers: { 'Cookie': `session=${token}`, 'Origin': 'https://hacker.com' }
    });
    await expect(authenticate(reqBadOrigin, SECRET)).rejects.toThrow('CSRF origin mismatch: unauthorized origin');

    // Suffix match bypass attempt
    const reqSuffixBypass = new Request('https://api.fairdrop.com/api/v1/drops/1/join', {
      method: 'POST',
      headers: { 'Cookie': `session=${token}`, 'Origin': 'http://localhost.evil.com' }
    });
    await expect(authenticate(reqSuffixBypass, SECRET)).rejects.toThrow('CSRF origin mismatch: unauthorized origin');

    // Prefix match bypass attempt
    const reqPrefixBypass = new Request('https://api.fairdrop.com/api/v1/drops/1/join', {
      method: 'POST',
      headers: { 'Cookie': `session=${token}`, 'Origin': 'http://attacker-localhost.com' }
    });
    await expect(authenticate(reqPrefixBypass, SECRET)).rejects.toThrow('CSRF origin mismatch: unauthorized origin');

    // Malformed origin
    const reqMalformed = new Request('https://api.fairdrop.com/api/v1/drops/1/join', {
      method: 'POST',
      headers: { 'Cookie': `session=${token}`, 'Origin': 'not-a-url' }
    });
    await expect(authenticate(reqMalformed, SECRET)).rejects.toThrow('CSRF origin mismatch: malformed origin');

    // Valid configured localhost origin
    const reqValidLocal = new Request('https://api.fairdrop.com/api/v1/drops/1/join', {
      method: 'POST',
      headers: { 'Cookie': `session=${token}`, 'Origin': 'http://localhost:5173' }
    });
    const ctxLocal = await authenticate(reqValidLocal, SECRET);
    expect(ctxLocal.participantId).toBe(VALID_UUID);

    // GET bypasses CSRF check
    const reqGet = new Request('https://api.fairdrop.com/api/v1/drops/1/status', {
      method: 'GET',
      headers: { 'Cookie': `session=${token}`, 'Origin': 'https://hacker.com' }
    });
    const ctxGet = await authenticate(reqGet, SECRET);
    expect(ctxGet.participantId).toBe(VALID_UUID); 
  });

  it('9. JWT with malformed UUID subject rejected', async () => {
    const payload = {
      sub: 'p_123', // not a UUID
      iss: 'fairdrop',
      aud: 'fairdrop-client',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_123'
    };
    const token = await signJWT(payload, SECRET);
    await expect(verifyJWT(token, SECRET)).rejects.toThrow('Invalid subject: must be a valid UUID');
  });
});

