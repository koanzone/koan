import { createRemoteJWKSet, jwtVerify } from 'jose';

// Cached public signing keys; no visitor tokens or conversation data are stored.
let cachedIssuer, cachedKeys;
export function accessIssuer(teamDomain) {
  if (typeof teamDomain !== 'string' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(teamDomain)) {
    throw new Error('Invalid Access team domain');
  }
  return `https://${teamDomain.toLowerCase()}`;
}
export async function verifyAccess(request, env, keys) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.CF_ACCESS_AUD) throw new Error('Access login required');
  const issuer = accessIssuer(env.CF_ACCESS_TEAM_DOMAIN);
  if (!keys) {
    if (cachedIssuer !== issuer) {
      cachedKeys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      cachedIssuer = issuer;
    }
    keys = cachedKeys;
  }
  await jwtVerify(token, keys, {
    issuer, audience: env.CF_ACCESS_AUD, algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub'],
  });
}
