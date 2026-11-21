import {afterEach,describe,it,expect,vi} from 'vitest';
import {handleRequest} from '../src/worker';
import * as access from '../src/access';
import {downloadWorkspaceFile,readWorkspace,uploadReport,validateReport} from '../src/workspace';
import {deliverNotifications,notificationText} from '../src/notifications';
import {checkout} from '../src/payments';
import type {Env} from '../src/env';
const actor={id:'00000000-0000-4000-8000-000000000001',email:'alice@example.test'};
const id='00000000-0000-4000-8000-000000000002',fileId='00000000-0000-4000-8000-000000000003';
const origin='https://calvinsonit-staging.example.workers.dev';
const env={APP_ORIGIN:origin,ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com',ACCESS_AUD:'fixture',SUPABASE_URL:'https://abc.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture',STRIPE_SECRET_KEY:'sk_test_fixture',ALERT_EMAIL:'operator@example.test',STAGING_EMAIL_ALLOWLIST:'alice@example.test,operator@example.test',EMAIL_FROM:'sender@example.test',RESEND_API_KEY:'re_fixture'} as Env;
const response=(value:unknown,status=200)=>Response.json(value,{status});
const denied=()=>response({code:'42501',message:'admin required'},403);
const notFound=()=>response({code:'P0002',message:'not found'},404);
const view={order:{id,serviceId:'ai-audit',status:'paid',amountCents:29900,currency:'usd',intakeCompletedAt:'2026-11-21T12:00:00Z',paidAt:'2026-11-21T12:01:00Z',dueDate:'2026-11-27',files:[]},fulfilmentStatus:'ready',intake:null,clientEmail:null,paymentIntent:'pi_fixture',reports:[],messages:[]};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function authenticate(){vi.spyOn(access,'verifyAccess').mockResolvedValue('access-subject');vi.spyOn(access,'authenticatedActor').mockResolvedValue(actor);}
describe('fulfilment HTTP boundaries',()=>{
 it('protects admin, messages and reports behind Access',async()=>{
  for(const path of ['/admin/','/api/admin/orders',`/api/admin/orders/${id}`,`/api/orders/${id}/workspace`,`/api/orders/${id}/reports/${fileId}`]) {
   expect((await handleRequest(new Request(origin+path),env)).status).toBe(403);
  }
 });
 it('requires a managed session on all new API routes',async()=>{
  vi.spyOn(access,'verifyAccess').mockResolvedValue('access-subject');
  for(const path of ['/api/admin/orders',`/api/admin/orders/${id}/workspace`,`/api/orders/${id}/workspace`,`/api/orders/${id}/reports/${fileId}`]) expect((await handleRequest(new Request(origin+path),env)).status).toBe(401);
 });
 it('checks admin membership before listing, uploads and messages even with admitted login',async()=>{
  authenticate();const fetched:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{fetched.push(String(input));return denied();}));
  for(const [path,method] of [['/api/admin/orders','GET'],[`/api/admin/orders/${id}/workspace`,'GET'],[`/api/admin/orders/${id}/reports`,'POST'],[`/api/admin/orders/${id}/messages`,'POST']]) {
   const result=await handleRequest(new Request(origin+path,{method,headers:{Origin:origin}}),env);expect(result.status).toBe(403);
  }
  expect(fetched).toHaveLength(4);expect(fetched.every(url=>url.endsWith('/rpc/require_staging_admin'))).toBe(true);
 });
 it('rejects another client before touching any Storage object',async()=>{
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{calls.push(String(input));return notFound();}));
  await expect(downloadWorkspaceFile(actor,id,fileId,false,true,env)).rejects.toMatchObject({status:404});
  expect(calls).toHaveLength(1);expect(calls[0]).toContain('/rpc/require_order_access');
 });
 it('scopes report lookup to order plus file ID and streams an attachment without a public URL',async()=>{
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
   const url=String(input);calls.push(url);
   if(url.endsWith('/rpc/require_order_access')) return response(null);
   if(url.includes('/rest/v1/order_reports?')) return response({object_path:`${id}/${fileId}`,original_name:'A report.pdf'});
   if(url.includes('/storage/v1/object/')) return new Response('%PDF-fixture');
   throw new Error('Unexpected request');
  }));
  const result=await downloadWorkspaceFile(actor,id,fileId,false,true,env);
  expect(calls[1]).toContain(`order_id=eq.${id}`);expect(calls[1]).toContain(`id=eq.${fileId}`);expect(calls[1]).toContain('state=eq.uploaded');
  expect(result.headers.get('Content-Type')).toBe('application/octet-stream');expect(result.headers.get('Content-Disposition')).toContain('A%20report.pdf');expect(await result.text()).toBe('%PDF-fixture');
 });
 it('blocks forged or oversize messages and cross-origin admin writes before recording anything',async()=>{
  authenticate();vi.stubGlobal('fetch',vi.fn(async()=>response(null)));
  const post=(path:string,body:unknown,requestOrigin=origin)=>handleRequest(new Request(origin+path,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
  expect((await post(`/api/orders/${id}/messages`,{requestId:crypto.randomUUID(),body:'Hi',senderRole:'admin'})).status).toBe(400);
  expect((await post(`/api/orders/${id}/messages`,{requestId:crypto.randomUUID(),body:'x'.repeat(3001)})).status).toBe(400);
  expect((await post(`/api/admin/orders/${id}/messages`,{},'https://evil.example.test')).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('only constructs a Stripe test dashboard URL from a valid saved payment ID',async()=>{
  for(const pi of ['pi_fixture','https://evil.example.test','pi_bad/../../live']) {
   vi.stubGlobal('fetch',vi.fn(async()=>response({...view,paymentIntent:pi})));
   const result=await readWorkspace(actor,id,true,env);
   expect(result.paymentIntent).toBe(null);expect(result.paymentUrl).toBe(pi==='pi_fixture'?'https://dashboard.stripe.com/test/payments/pi_fixture':null);
  }
 });
 it('rejects legacy Hosted checkout before any Stripe provider request',async()=>{
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{calls.push(String(input));return response({id:fileId,order_id:id,state:'open',stripe_price_id:'price_fixture',stripe_session_id:'cs_test_fixture',checkout_url:null,expires_at:null,created_at:new Date().toISOString(),service_id:'catalog-hosted',amount_cents:149000,client_email:actor.email});}));
  await expect(checkout(actor,id,env)).rejects.toThrow('not available for purchase');expect(calls).toHaveLength(1);expect(calls[0]).toContain('/rpc/reserve_checkout');
 });
});
describe('report recovery',()=>{
 it('validates names, bounded bytes and format before reservation',()=>{
  expect(()=>validateReport('report.pdf','application/pdf',new TextEncoder().encode('%PDF-1.7 fixture'))).not.toThrow();
  for(const [name,type,text] of [['report.html','text/html','<html>'],['../report.pdf','application/pdf','%PDF-'],['fake.pdf','application/pdf','hello']]) expect(()=>validateReport(name!,type!,new TextEncoder().encode(text))).toThrow();
  expect(()=>validateReport('report.pdf','application/pdf',new Uint8Array())).toThrow('between');
 });
 it('recovers a duplicate upload by hashing stored bytes and confirming only matching content',async()=>{
  for(const matches of [true,false]) {
   let confirms=0;
   vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    if(url.endsWith('/rpc/require_staging_admin')) return response(null);
    if(url.endsWith('/rpc/reserve_report')) return response({id:fileId,object_path:`${id}/${fileId}`,state:'pending'});
    if(url.includes('/storage/v1/object/') && init?.method==='POST') return response({statusCode:'400',error:'Duplicate',message:'Already exists'},400);
    if(url.includes('/storage/v1/object/')) return new Response(matches?'%PDF-fixture':'%PDF-changed');
    if(url.endsWith('/rpc/confirm_report')) {confirms++;return response(null);}
    throw new Error('Unexpected request');
   }));
   const upload=uploadReport(actor,id,crypto.randomUUID(),'report.pdf','application/pdf',new TextEncoder().encode('%PDF-fixture'),env);
   if(matches) await expect(upload).resolves.toEqual({id:fileId});else await expect(upload).rejects.toThrow('Upload failed');
   expect(confirms).toBe(matches?1:0);
  }
 });
});
describe('fulfilment emails',()=>{
 const claim={id:fileId,claim_token:actor.id,recipient:actor.email,payload:{orderId:id}};
 it('provides protected links without private file URLs or message bodies',()=>{
  for(const kind of ['report_ready','order_message_client','order_message_admin'] as const) {
   const text=notificationText({...claim,kind},origin);
   expect(text.subject).toContain('[TEST]');expect(text.text).toContain(`${origin}/${kind==='order_message_admin'?'admin':'order'}/?id=${id}`);
   expect(text.text).not.toContain('/storage/');
  }
 });
 it('retains the same Resend key across retries for both ready and two-way message notices',async()=>{
  for(const kind of ['report_ready','order_message_client','order_message_admin']) {
   const sends:string[]=[],outcomes:string[]=[];
   vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    if(url.endsWith('/rpc/claim_notifications')) return response([{...claim,kind}]);
    if(url.includes('/rest/v1/orders?')) return response({status:'paid'});
    if(url.endsWith('/rpc/finish_notification')) {outcomes.push(JSON.parse(String(init?.body)).p_outcome as string);return response(null);}
    if(url==='https://api.resend.com/emails') {sends.push(new Headers(init?.headers).get('Idempotency-Key')!);return sends.length===1?response({},500):response({id:'email_fixture'});}
    throw new Error('Unexpected request');
   }));
   await deliverNotifications(env);await deliverNotifications(env);
   expect(sends).toEqual([`calvinsonit-staging/${fileId}`,`calvinsonit-staging/${fileId}`]);expect(outcomes).toEqual(['retry','sent']);
  }
 });
 it('holds disallowed recipients and refunded ready notices without sending',async()=>{
  for(const [recipient,status] of [['outsider@example.test','paid'],[actor.email,'refunded']]) {
   let outcome='';
   vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    if(url.endsWith('/rpc/claim_notifications')) return response([{...claim,kind:'report_ready',recipient}]);
    if(url.includes('/rest/v1/orders?')) return response({status});
    if(url.endsWith('/rpc/finish_notification')) {outcome=JSON.parse(String(init?.body)).p_outcome as string;return response(null);}
    throw new Error('No email may be sent');
   }));
   await deliverNotifications(env);expect(outcome).toBe('manual_review');
  }
 });
});
