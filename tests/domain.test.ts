import {describe,it,expect} from 'vitest';
import {submitOrder,submitLead,services,audit} from '../src/domain';
import {publicSupabaseConfig,type Env} from '../src/env';
import {stripeClient,acceptWebhook} from '../src/payments';
import Stripe from 'stripe';
const base={requestId:crypto.randomUUID(),serviceId:'ai-audit',termsAccepted:true,intake:{businessName:'Plumber',website:'https://example.test',services:'Plumbing',markets:'United States'}};
describe('fixed service boundaries',()=>{
 it('uses exactly the four approved fixed prices and 100 AI checks',()=>{
  expect(services.map(s=>[s.id,s.amountCents])).toEqual([['ai-audit',29900],['catalog-starter',18900],['catalog-full',59000],['catalog-hosted',149000]]);
  expect(audit.engines.length*audit.questionsPerEngine).toBe(100);
 });
 it('rejects held services and caller-supplied prices',()=>{
  expect(submitOrder.safeParse({...base,serviceId:'automation'}).success).toBe(false);
  expect(submitOrder.safeParse({...base,amountCents:1}).success).toBe(false);
 });
 it('requires complete audit fields and package limits',()=>{
  expect(submitOrder.safeParse(base).success).toBe(true);
  expect(submitOrder.safeParse({...base,intake:{...base.intake,markets:''}}).success).toBe(false);
  expect(submitOrder.safeParse({...base,serviceId:'catalog-starter',intake:{...base.intake,productCount:2001}}).success).toBe(false);
  expect(submitOrder.safeParse({...base,serviceId:'catalog-hosted',intake:{...base.intake,productCount:9000}}).success).toBe(false);
  expect(submitOrder.safeParse({...base,serviceId:'catalog-hosted',intake:{...base.intake,productCount:9000,distributorCount:3}}).success).toBe(false);
 });
 it('has no marketing subscription input',()=>{
  expect(submitLead.safeParse({requestId:crypto.randomUUID(),name:'Test',email:'person@example.test',message:'An order question',subscribe:true}).success).toBe(false);
 });
});
describe('credential boundaries',()=>{
 it('never treats live Stripe keys as configured',()=>{
  for(const key of ['sk_live_fixture','rk_live_fixture','',undefined]) expect(()=>stripeClient({STRIPE_SECRET_KEY:key} as Env)).toThrow('Stripe test mode');
 });
 it('rejects misplaced Supabase secret and service-role keys',()=>{
  const roleKey=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url'),'signature'].join('.');
  for(const key of ['sb_secret_fixture',roleKey]) expect(()=>publicSupabaseConfig({SUPABASE_URL:'https://abc.supabase.co',SUPABASE_PUBLISHABLE_KEY:key} as Env)).toThrow('public Supabase key');
 });
 it('accepts only a public key for browser configuration',()=>{
  expect(publicSupabaseConfig({SUPABASE_URL:'https://abc.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'} as Env).supabasePublishableKey).toBe('sb_publishable_fixture');
 });
 it('rejects correctly signed live events before any database call',async()=>{
  const payload=JSON.stringify({id:'evt_fixture',object:'event',livemode:true,type:'checkout.session.completed',data:{object:{id:'cs_live_fixture'}}});
  const signature=Stripe.webhooks.generateTestHeaderString({payload,secret:'whsec_fixture'});
  await expect(acceptWebhook(payload,signature,{STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture'} as Env)).rejects.toThrow('Live payments');
 });
 it('rejects forged webhook signatures',async()=>{
  await expect(acceptWebhook('{}','t=1,v1=invalid',{STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture'} as Env)).rejects.toThrow('Invalid payment signature');
 });
});
