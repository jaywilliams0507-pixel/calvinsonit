import {beforeAll,afterEach,describe,it,expect,vi} from 'vitest';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT,type JWTVerifyGetKey} from 'jose';
import {verifyAccess} from '../src/access';
import * as access from '../src/access';
import {handleRequest,readBytes} from '../src/worker';
import type {Env} from '../src/env';
const origin='https://calvinsonit-staging.example.workers.dev';
const env={APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com',ACCESS_AUD:'staging-audience',SUPABASE_URL:'https://abc.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',ASSETS:{fetch:vi.fn(async()=>new Response('private asset'))}} as unknown as Env;
let keys:JWTVerifyGetKey,privateKey:CryptoKey;
beforeAll(async()=>{
 const pair=await generateKeyPair('RS256');privateKey=pair.privateKey;
 keys=createLocalJWKSet({keys:[await exportJWK(pair.publicKey)]});
});
afterEach(()=>vi.restoreAllMocks());
async function token(audience='staging-audience',expiry:number|undefined=Math.floor(Date.now()/1000)+300):Promise<string> {
 let jwt=new SignJWT({}).setProtectedHeader({alg:'RS256'}).setIssuer('https://example.cloudflareaccess.com').setAudience(audience).setSubject('tester').setIssuedAt();
 if(expiry!==undefined)jwt=jwt.setExpirationTime(expiry);
 return jwt.sign(privateKey);
}
describe('Cloudflare Access boundary',()=>{
 it('accepts a signed audience-bound token',async()=>{
  await expect(verifyAccess(new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':await token()}}),env,keys)).resolves.toBe('tester');
 });
 it('rejects wrong audience, expired tokens, and tokens without expiry',async()=>{
  const noExpiry=await new SignJWT({}).setProtectedHeader({alg:'RS256'}).setIssuer('https://example.cloudflareaccess.com').setAudience('staging-audience').setSubject('tester').setIssuedAt().sign(privateKey);
  for(const jwt of [await token('other'),await token('staging-audience',1),noExpiry]) await expect(verifyAccess(new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':jwt}}),env,keys)).rejects.toThrow('requires Cloudflare Access');
 });
 it('denies every static/app surface without Access before asset fetch',async()=>{
  for(const path of ['/','/assets/app.js','/assets/logo/calvinsonit-logo-dark.svg','/auth/callback/','/api/config','/docs/staging-operations.md']) {
   const response=await handleRequest(new Request(origin+path),env);
   expect(response.status).toBe(403);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  }
  expect(env.ASSETS.fetch).not.toHaveBeenCalled();
 });
 it('fails closed when Access is unconfigured or hostname differs',async()=>{
  expect((await handleRequest(new Request(origin),{...env,ACCESS_AUD:'REPLACE'})).status).toBe(503);
  expect((await handleRequest(new Request('https://calvinsonit.org/'),env)).status).toBe(403);
 });
 it('requires exact Origin even after Access verification',async()=>{
  vi.spyOn(access,'verifyAccess').mockResolvedValue('tester');
  for(const allowedOrigin of [undefined,'https://evil.example']) {
   const response=await handleRequest(new Request(origin+'/api/leads',{method:'POST',headers:allowedOrigin?{Origin:allowedOrigin}:{},body:'{}'}),env);
   expect(response.status).toBe(403);
  }
 });
 it('does not disclose a misplaced service-role key in config',async()=>{
  vi.spyOn(access,'verifyAccess').mockResolvedValue('tester');
  const secret='sb_secret_never_expose_fixture';
  const response=await handleRequest(new Request(origin+'/api/config'),{...env,SUPABASE_PUBLISHABLE_KEY:secret});
  expect(response.status).toBe(503);expect(await response.text()).not.toContain(secret);
 });
 it('does not bypass Access for a webhook lookalike or wrong method',async()=>{
  for(const [path,method] of [['/api/stripe/webhook','GET'],['/api/stripe/webhook/','POST']]) expect((await handleRequest(new Request(origin+path,{method}),env)).status).toBe(403);
 });
});
describe('bounded input',()=>{
 it('limits chunked bodies with no Content-Length',async()=>{
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(5));controller.enqueue(new Uint8Array(6));controller.close();}});
  const request=new Request(origin,{method:'POST',body:stream,duplex:'half'} as RequestInit);
  await expect(readBytes(request,10)).rejects.toThrow('too large');
 });
});
