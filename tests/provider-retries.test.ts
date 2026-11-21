import {afterEach,describe,it,expect,vi} from 'vitest';
import {checkout,acceptWebhook} from '../src/payments';
import Stripe from 'stripe';
import {uploadFile} from '../src/orders';
import type {Env} from '../src/env';
const actor={id:'00000000-0000-4000-8000-000000000001',email:'alice@example.test'};
const orderId='00000000-0000-4000-8000-000000000002',attemptId='00000000-0000-4000-8000-000000000003',fileId='00000000-0000-4000-8000-000000000004';
const env={APP_ORIGIN:'https://calvinsonit-staging.example.workers.dev',SUPABASE_URL:'https://abc.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture',STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_PRICE_AI_AUDIT:'price_fixture'} as Env;
function response(value:unknown,status=200){return Response.json(value,{status});}
afterEach(()=>vi.unstubAllGlobals());
describe('provider crash recovery',()=>{
 it('reuses the same Stripe idempotency key when database attachment fails',async()=>{
  const keys:string[]=[],bodies:string[]=[];let attachments=0;
  const attempt={id:attemptId,order_id:orderId,state:'reserved',stripe_price_id:'price_fixture',stripe_session_id:null,checkout_url:null,expires_at:null,created_at:new Date().toISOString(),service_id:'ai-audit',amount_cents:29900,client_email:actor.email};
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith('/rpc/reserve_checkout'))return response(attempt);
   if(url.endsWith('/prices/price_fixture'))return response({id:'price_fixture',object:'price',livemode:false,active:true,type:'one_time',currency:'usd',unit_amount:29900,billing_scheme:'per_unit'});
   if(url.endsWith('/checkout/sessions')) {
    keys.push(new Headers(init?.headers).get('Idempotency-Key')??'');bodies.push(String(init?.body));
    return response({id:'cs_test_fixture',object:'checkout.session',livemode:false,mode:'payment',currency:'usd',amount_total:29900,url:'https://checkout.stripe.com/c/pay/test_fixture',expires_at:Math.floor(Date.now()/1000)+86400});
   }
   if(url.endsWith('/rpc/attach_checkout')) {attachments++;return attachments===1?response({code:'57P01',message:'database restart'},503):response(null);}
   throw new Error(`Unexpected request ${url}`);
  }));
  await expect(checkout(actor,orderId,env)).rejects.toThrow('temporarily unavailable');
  await expect(checkout(actor,orderId,{...env,STRIPE_PRICE_AI_AUDIT:'price_replacement'})).resolves.toEqual({url:'https://checkout.stripe.com/c/pay/test_fixture'});
  expect(keys).toEqual([`checkout:${attemptId}`,`checkout:${attemptId}`]);expect(bodies[0]).toBe(bodies[1]);
  const params=new URLSearchParams(bodies[0]);
  expect(params.get('line_items[0][price]')).toBe('price_fixture');expect(params.get('payment_intent_data[metadata][order_id]')).toBe(orderId);
 });
 it('rejects a live or incorrectly priced Stripe Price before session creation',async()=>{
  for(const price of [{livemode:true,unit_amount:29900},{livemode:false,unit_amount:1}]) {
   let checkoutCalls=0;
   vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
    const url=String(input);
    if(url.endsWith('/rpc/reserve_checkout'))return response({id:attemptId,order_id:orderId,state:'reserved',stripe_price_id:'price_fixture',stripe_session_id:null,checkout_url:null,expires_at:null,created_at:new Date().toISOString(),service_id:'ai-audit',amount_cents:29900,client_email:actor.email});
    if(url.endsWith('/prices/price_fixture'))return response({id:'price_fixture',object:'price',active:true,type:'one_time',currency:'usd',billing_scheme:'per_unit',...price});
    checkoutCalls++;throw new Error('Checkout must not run');
   }));
   await expect(checkout(actor,orderId,env)).rejects.toThrow('listed service');expect(checkoutCalls).toBe(0);
  }
 });
 it('reconciles a paid session against its saved price after configuration changes',async()=>{
  const payload=JSON.stringify({id:'evt_price_rotation',object:'event',created:Math.floor(Date.now()/1000),livemode:false,type:'checkout.session.completed',data:{object:{id:'cs_test_old'}}});
  const signature=Stripe.webhooks.generateTestHeaderString({payload,secret:'whsec_fixture'});
  let recorded:Record<string,unknown>|undefined;
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.endsWith('/checkout/sessions/cs_test_old'))return response({id:'cs_test_old',object:'checkout.session',livemode:false,mode:'payment',currency:'usd',payment_status:'paid',amount_total:29900,client_reference_id:orderId,payment_intent:'pi_test_old',metadata:{order_id:orderId,attempt_id:attemptId}});
   if(url.includes('/rest/v1/orders?'))return response({service_id:'ai-audit',amount_cents:29900});
   if(url.includes('/rest/v1/checkout_attempts?'))return response({stripe_price_id:'price_original'});
   if(url.includes('/checkout/sessions/cs_test_old/line_items'))return response({object:'list',has_more:false,data:[{id:'li_fixture',object:'item',quantity:1,price:{id:'price_original',object:'price',livemode:false,unit_amount:29900}}]});
   if(url.endsWith('/rpc/record_payment')){recorded=JSON.parse(String(init?.body)) as Record<string,unknown>;return response(null);}
   throw new Error(`Unexpected request ${url}`);
  }));
  await acceptWebhook(payload,signature,{...env,STRIPE_PRICE_AI_AUDIT:'price_replacement',STRIPE_WEBHOOK_SECRET:'whsec_fixture',ALERT_EMAIL:'jay@example.test',STAGING_EMAIL_ALLOWLIST:'jay@example.test'});
  expect(recorded?.p_price_id).toBe('price_original');expect(recorded?.p_amount).toBe(29900);
 });
 it('verifies existing bytes after Storage returns documented 400 duplicate',async()=>{
  const bytes=new TextEncoder().encode('sku,price\nA,1\n');let confirms=0;
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input),method=init?.method??'GET';
   if(url.endsWith('/rpc/reserve_file'))return response({id:fileId,object_path:`${actor.id}/${orderId}/${fileId}`,state:'pending'});
   if(url.includes('/storage/v1/object/') && method==='POST')return response({statusCode:'400',error:'Duplicate',message:'The resource already exists'},400);
   if(url.includes('/storage/v1/object/'))return new Response(bytes,{headers:{'Content-Type':'text/csv'}});
   if(url.endsWith('/rpc/confirm_file')){confirms++;return response(null);}
   throw new Error(`Unexpected request ${url}`);
  }));
  await expect(uploadFile(actor,orderId,crypto.randomUUID(),'products.csv','text/csv',bytes,env)).resolves.toEqual({id:fileId});expect(confirms).toBe(1);
 });
 it('never confirms an upload when error recovery finds different bytes',async()=>{
  const bytes=new TextEncoder().encode('sku,price\nA,1\n');let confirms=0;
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input),method=init?.method??'GET';
   if(url.endsWith('/rpc/reserve_file'))return response({id:fileId,object_path:`${actor.id}/${orderId}/${fileId}`,state:'pending'});
   if(url.includes('/storage/v1/object/') && method==='POST')return response({statusCode:'400',error:'InvalidRequest',message:'Bad upload'},400);
   if(url.includes('/storage/v1/object/'))return new Response(new TextEncoder().encode('sku,price\nB,2\n'));
   if(url.endsWith('/rpc/confirm_file')){confirms++;return response(null);}
   throw new Error(`Unexpected request ${url}`);
  }));
  await expect(uploadFile(actor,orderId,crypto.randomUUID(),'products.csv','text/csv',bytes,env)).rejects.toThrow('Upload failed');expect(confirms).toBe(0);
 });
});
