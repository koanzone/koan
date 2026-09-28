import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { createWorker } from '../cloudflare/worker.mjs';
import { verifyAccess } from '../cloudflare/access.mjs';

const env = {
 BACKEND_URL:'https://api.koanzone.net', CF_ACCESS_CLIENT_ID:'test-client',
 CF_ACCESS_CLIENT_SECRET:'test-secret', CF_ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com', CF_ACCESS_AUD:'website-aud',
 ASSETS:{fetch:async () => new Response('asset')},
};
const req = (path='/api/chat', headers={}) => new Request(`https://buddha.koanzone.net${path}`, {
 method:path === '/api/health' ? 'GET' : 'POST',
 headers:{'Content-Type':'application/json', Origin:'https://buddha.koanzone.net', ...headers},
 ...(path === '/api/health' ? {} : {body:JSON.stringify({messages:[{role:'user',content:'Hello'}]})}),
});
function worker(fetchBackend) { return createWorker({authenticate:async()=>{}, fetchBackend}); }

test('static assets bypass the model; APIs fail closed without configuration', async()=>{
 const w=createWorker({fetchBackend:()=>assert.fail('unexpected backend request')});
 assert.equal(await (await w.fetch(new Request('https://buddha.koanzone.net/'),env)).text(),'asset');
 assert.equal((await w.fetch(req(),{...env,CF_ACCESS_CLIENT_SECRET:''})).status,503);
 assert.equal((await w.fetch(req(),env)).status,401);
});
test('reject spoofed, expired, wrong-audience and wrong-issuer Access tokens', async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const sign=({aud='website-aud',iss='https://test.cloudflareaccess.com',exp='5m'}={})=>new SignJWT({})
  .setProtectedHeader({alg:'RS256'}).setIssuer(iss).setAudience(aud).setSubject('test-user')
  .setIssuedAt().setExpirationTime(exp).sign(privateKey);
 const valid=await sign();
 await verifyAccess(req('/api/chat',{'Cf-Access-Jwt-Assertion':valid}),env,publicKey);
 for (const token of ['forged',await sign({aud:'backend-aud'}),await sign({iss:'https://other.cloudflareaccess.com'}),await sign({exp:'-1m'})]) {
  await assert.rejects(()=>verifyAccess(req('/api/chat',{'Cf-Access-Jwt-Assertion':token}),env,publicKey));
 }
});
test('allow only explicit API paths/methods and same-origin JSON', async()=>{
 const w=worker(()=>assert.fail('unexpected backend request'));
 assert.equal((await w.fetch(req('/api/admin'),env)).status,404);
 assert.equal((await w.fetch(new Request('https://buddha.koanzone.net/api/chat'),env)).status,405);
 assert.equal((await w.fetch(req('/api/chat',{Origin:'https://evil.example'}),env)).status,403);
 assert.equal((await w.fetch(req('/api/chat',{'Content-Type':'text/plain'}),env)).status,415);
 assert.equal((await w.fetch(req(),{...env,BACKEND_URL:'http://insecure.example'})).status,503);
});
test('caps streamed request size even without Content-Length', async()=>{
 const request=new Request('https://buddha.koanzone.net/api/chat',{
  method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(512*1024+1),
 });
 assert.equal((await worker(()=>assert.fail('unexpected backend request')).fetch(request,env)).status,413);
});
test('inject server credentials, strip visitor headers and relay chunks immediately', async()=>{
 let upstreamController, options;
 const upstream=new ReadableStream({start(c){upstreamController=c; c.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"Hello"}\n\n'));}});
 const w=worker(async(url,init)=>{
  assert.equal(String(url),'https://api.koanzone.net/api/chat'); options=init;
  return new Response(upstream,{headers:{'Content-Type':'text/event-stream','Set-Cookie':'do-not-forward','X-Secret':'do-not-forward'}});
 });
 const response=await w.fetch(req('/api/chat',{
  Cookie:'visitor-cookie',Authorization:'visitor-secret','CF-Access-Client-Secret':'attacker-value',
  'Cf-Access-Jwt-Assertion':'visitor-jwt',
 }),env);
 assert.equal(options.redirect,'manual');
 assert.equal(options.headers.get('CF-Access-Client-Secret'),'test-secret');
 assert.equal(options.headers.get('CF-Access-Client-Id'),'test-client');
 for(const header of ['Cookie','Authorization','Cf-Access-Jwt-Assertion']) assert.equal(options.headers.get(header),null);
 assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('X-Secret'),null);
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 const reader=response.body.getReader();
 const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/Hello/);
 upstreamController.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n')); upstreamController.close();
 assert.match(new TextDecoder().decode((await reader.read()).value),/done/);
 assert.equal((await reader.read()).done,true);
});
test('canceling browser response cancels upstream stream', async()=>{
 let canceled=false;
 const w=worker(async()=>new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'Content-Type':'text/event-stream'}}));
 const response=await w.fetch(req(),env);await response.body.cancel();assert.equal(canceled,true);
});
test('backend login redirects and failures do not reach the browser as HTML', async()=>{
 for (const status of [302,401,403,500,502]) {
  const w=worker(async()=>new Response('private upstream detail',{status,headers:{Location:'https://login.example'}}));
  const response=await w.fetch(req(),env);assert.equal(response.status,502);assert.doesNotMatch(await response.text(),/private upstream detail/);
 }
 assert.equal((await worker(async()=>{throw Error('network');}).fetch(req(),env)).status,502);
 assert.equal((await worker(async()=>new Response('<html>Login</html>',{headers:{'Content-Type':'text/html'}})).fetch(req(),env)).status,502);
});
test('health JSON and busy responses retain their status', async()=>{
 const health=await worker(async()=>Response.json({status:'ok',backend:'demo'})).fetch(req('/api/health'),env);
 assert.deepEqual(await health.json(),{status:'ok',backend:'demo'});
 const busy=await worker(async()=>Response.json({detail:'busy'},{status:409})).fetch(req(),env);
 assert.equal(busy.status,409);
});


test('public mode accepts anonymous chat but preserves private backend credentials', async()=>{
 const publicEnv={...env,PUBLIC_SITE:'true',CF_ACCESS_TEAM_DOMAIN:undefined,CF_ACCESS_AUD:undefined};
 let calls=0;
 const w=createWorker({authenticate:()=>assert.fail('public site must not require visitor login'),fetchBackend:async(url,init)=>{
  calls++;
  assert.equal(init.headers.get('CF-Access-Client-Id'),'test-client');
  assert.equal(init.headers.get('CF-Access-Client-Secret'),'test-secret');
  assert.equal(init.headers.get('Cookie'),null);
  assert.equal(init.headers.get('Cf-Access-Jwt-Assertion'),null);
  return new Response('data: {"type":"done"}\n\n',{headers:{'Content-Type':'text/event-stream'}});
 }});
 assert.equal((await w.fetch(req('/api/chat',{'CF-Access-Client-Secret':'spoofed',Cookie:'visitor'}),publicEnv)).status,200);
 assert.equal((await w.fetch(req(),{...publicEnv,CF_ACCESS_CLIENT_SECRET:''})).status,503);
 assert.equal((await w.fetch(req('/api/chat',{Origin:'https://other.example'}),publicEnv)).status,403);
 assert.equal(calls,1);
});
test('public access requires explicit true configuration', async()=>{
 const w=createWorker({fetchBackend:()=>assert.fail('must require login')});
 for(const value of [undefined,'false','TRUE','']) {
  assert.equal((await w.fetch(req(),{...env,PUBLIC_SITE:value})).status,401);
 }
});
