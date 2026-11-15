import {describe,it,expect} from 'vitest';
import {prepareStaging} from '../src/deployment';
const base={name:'calvinsonit-staging',main:'src/worker.ts',assets:{run_worker_first:true},preview_urls:false,vars:{}};
const variables={APP_ORIGIN:'https://calvinsonit-staging.example.workers.dev',ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com',ACCESS_AUD:'fixture-audience-0123456789',SUPABASE_URL:'https://abc.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',STRIPE_PRICE_AI_AUDIT:'price_a',STRIPE_PRICE_CATALOG_STARTER:'price_b',STRIPE_PRICE_CATALOG_FULL:'price_c',STRIPE_PRICE_CATALOG_HOSTED:'price_d',ALERT_EMAIL:'jay@example.test',EMAIL_FROM:'CalvinsonIT <test@example.test>',STAGING_EMAIL_ALLOWLIST:'jay@example.test,alice@example.test'};
const secrets={SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture',STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',RESEND_API_KEY:'re_fixture'};
const ref='refs/heads/codex/phase1-protected-staging';
describe('staging deployment guard',()=>{
 it('allows only a protected staging configuration',()=>{expect(prepareStaging(base,variables,secrets,ref).vars.APP_ORIGIN).toBe(variables.APP_ORIGIN);});
 it('rejects production branches, hostnames, routes, preview URLs and asset bypass',()=>{
  expect(()=>prepareStaging(base,variables,secrets,'refs/heads/main')).toThrow();
  expect(()=>prepareStaging(base,{...variables,APP_ORIGIN:'https://calvinsonit.org'},secrets,ref)).toThrow();
  for(const config of [{...base,routes:['calvinsonit.org/*']},{...base,preview_urls:true},{...base,assets:{run_worker_first:false}}])expect(()=>prepareStaging(config,variables,secrets,ref)).toThrow();
 });
 it('rejects live keys and misplaced public secrets before any provider command',()=>{
  expect(()=>prepareStaging(base,variables,{...secrets,STRIPE_SECRET_KEY:'sk_live_fixture'},ref)).toThrow('test key');
  expect(()=>prepareStaging(base,{...variables,SUPABASE_PUBLISHABLE_KEY:'sb_secret_fixture'},secrets,ref)).toThrow('public');
 });
 it('requires Access and explicit alert allowlisting without exposing values in errors',()=>{
  expect(()=>prepareStaging(base,{...variables,ACCESS_AUD:'REPLACE'},secrets,ref)).toThrow('Missing staging variable ACCESS_AUD');
  expect(()=>prepareStaging(base,{...variables,ALERT_EMAIL:'unapproved@example.test'},secrets,ref)).toThrow('recipient allowlist');
 });
});
