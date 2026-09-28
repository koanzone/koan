import { accessIssuer, verifyAccess } from './access.mjs';

const MAX_BODY = 512 * 1024;
const error = (status, message) => Response.json({detail: message}, {
  status, headers: {'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'},
});
async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) throw new Error('Body too large');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new Error('Body too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

// Injectable I/O lets tests verify authentication and streaming without secrets.
export function createWorker({fetchBackend = fetch, authenticate = verifyAccess} = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      const method = {'/api/health':'GET', '/api/chat':'POST'}[url.pathname];
      if (!method) return error(404, 'Not found');
      if (request.method !== method) return error(405, 'Method not allowed');
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) return error(403, 'Cross-origin requests are not allowed');
      const publicSite = env.PUBLIC_SITE === 'true';
      const required = [env.CF_ACCESS_CLIENT_ID, env.CF_ACCESS_CLIENT_SECRET];
      if (!publicSite) required.push(env.CF_ACCESS_TEAM_DOMAIN, env.CF_ACCESS_AUD);
      if (!required.every(Boolean)) {
        return error(503, 'Website connection is not configured yet');
      }
      let backend;
      try {
        backend = new URL(env.BACKEND_URL);
        if (backend.protocol !== 'https:' || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) throw new Error();
        if (!publicSite) accessIssuer(env.CF_ACCESS_TEAM_DOMAIN);
      } catch { return error(503, 'Website connection configuration is invalid'); }
      // Public mode opens the website, while upstream service authentication remains required.
      if (!publicSite) {
        try { await authenticate(request, env); }
        catch { return error(401, 'Please reload the page and sign in again'); }
      }
      let body;
      if (method === 'POST') {
        if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return error(415, 'JSON is required');
        try { body = await readBody(request); }
        catch { return error(413, 'Message is too large'); }
      }
      // Build a fresh header set: never forward browser cookies, user-supplied
      // credentials, or the website Access JWT to the backend application.
      const headers = new Headers({
        'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
        'Accept': method === 'POST' ? 'text/event-stream' : 'application/json',
      });
      if (body) headers.set('Content-Type', 'application/json');
      let upstream;
      try {
        upstream = await fetchBackend(new URL(url.pathname, backend), {
          method, headers, body, redirect:'manual', signal:request.signal,
        });
      } catch { return error(502, 'Cannot reach the guide on your Mac'); }
      // Access login redirects must not become an HTML response or leak a
      // service credential through a redirect to another host.
      if ((upstream.status >= 300 && upstream.status < 400) || [401,403].includes(upstream.status)) {
        await upstream.body?.cancel();
        return error(502, 'The backend Access policy rejected the website credential');
      }
      if (upstream.status >= 500) {
        await upstream.body?.cancel();
        return error(502, 'The guide on your Mac is unavailable');
      }
      const type = upstream.headers.get('Content-Type') || '';
      const expected = method === 'POST' && upstream.ok ? 'text/event-stream' : 'application/json';
      if (!type.toLowerCase().startsWith(expected)) {
        await upstream.body?.cancel();
        return error(502, 'Unexpected response from the guide');
      }
      // Pass the readable stream through immediately. Do not await text()/json().
      return new Response(upstream.body, {status:upstream.status, headers:{
        'Content-Type':type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
      }});
    },
  };
}
export default createWorker();
