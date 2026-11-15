import {readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {decodeJwt} from 'jose';

type StagingConfig={name:string;main:string;assets:{run_worker_first:boolean};preview_urls:boolean;vars:Record<string,string>;routes?:unknown;route?:unknown;env?:unknown};
type Secrets={SUPABASE_SERVICE_ROLE_KEY:string;STRIPE_SECRET_KEY:string;STRIPE_WEBHOOK_SECRET:string;RESEND_API_KEY:string};
const variableNames=['APP_ORIGIN','ACCESS_TEAM_DOMAIN','ACCESS_AUD','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','STRIPE_PRICE_AI_AUDIT','STRIPE_PRICE_CATALOG_STARTER','STRIPE_PRICE_CATALOG_FULL','STRIPE_PRICE_CATALOG_HOSTED','ALERT_EMAIL','EMAIL_FROM','STAGING_EMAIL_ALLOWLIST'] as const;
export function prepareStaging(base:StagingConfig,variables:unknown,secrets:Secrets,ref:string):StagingConfig {
  if(ref!=='refs/heads/codex/phase1-protected-staging')throw new Error('Only the staging branch may deploy');
  if(base.name!=='calvinsonit-staging' || base.routes || base.route || base.env || base.assets?.run_worker_first!==true || base.preview_urls!==false)throw new Error('Only the protected staging Worker may deploy');
  if(!variables || typeof variables!=='object' || Array.isArray(variables))throw new Error('Invalid staging configuration');
  const vars:Record<string,string>={};
  for(const key of variableNames) {
    const value=Reflect.get(variables,key);
    if(typeof value!=='string' || !value || value.includes('REPLACE'))throw new Error(`Missing staging variable ${key}`);
    vars[key]=value;
  }
  if(Object.keys(variables).some(key=>!variableNames.includes(key as typeof variableNames[number])))throw new Error('Unexpected staging variable');
  if(!/^https:\/\/calvinsonit-staging\.[a-z0-9-]+\.workers\.dev$/.test(vars.APP_ORIGIN!))throw new Error('Use the staging workers.dev hostname');
  if(!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(vars.ACCESS_TEAM_DOMAIN!) || vars.ACCESS_AUD!.length<16)throw new Error('Cloudflare Access configuration is required');
  if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(vars.SUPABASE_URL!))throw new Error('Use the staging Supabase project');
  if(!vars.SUPABASE_PUBLISHABLE_KEY!.startsWith('sb_publishable_')) {
    try {if(decodeJwt(vars.SUPABASE_PUBLISHABLE_KEY!).role!=='anon')throw new Error();}catch{throw new Error('Supabase browser key must be public');}
  }
  for(const key of variableNames.filter(key=>key.startsWith('STRIPE_PRICE_')))if(!/^price_[A-Za-z0-9]+$/.test(vars[key]!))throw new Error('Configure four test price IDs');
  const allowed=vars.STAGING_EMAIL_ALLOWLIST!.split(',').map(value=>value.trim().toLowerCase());
  if(!allowed.length || allowed.some(value=>!/^\S+@[^\s@]+\.[^\s@]+$/.test(value)) || !allowed.includes(vars.ALERT_EMAIL!.toLowerCase()) || /[\r\n]/.test(vars.EMAIL_FROM!))throw new Error('Configure the staging sender and recipient allowlist');
  if(!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secrets.STRIPE_SECRET_KEY??''))throw new Error('Only a Stripe test key may enter staging');
  if(!/^whsec_[A-Za-z0-9]+$/.test(secrets.STRIPE_WEBHOOK_SECRET??'') || !/^re_[A-Za-z0-9_]+$/.test(secrets.RESEND_API_KEY??''))throw new Error('Configure staging webhook and email secrets');
  if(!secrets.SUPABASE_SERVICE_ROLE_KEY?.startsWith('sb_secret_')) {
    try {if(decodeJwt(secrets.SUPABASE_SERVICE_ROLE_KEY).role!=='service_role')throw new Error();}catch{throw new Error('Configure a staging Supabase server key');}
  }
  return {...base,vars};
}

async function deploy():Promise<void> {
  const configPath='.staging.wrangler.jsonc',secretPath='.staging.secrets.json',logPath='.staging.wrangler.log';
  let variables:unknown;
  try{variables=JSON.parse(process.env.STAGING_CONFIG_JSON??'');}catch{throw new Error('Invalid STAGING_CONFIG_JSON secret');}
  const secrets={SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY??'',STRIPE_SECRET_KEY:process.env.STRIPE_SECRET_KEY??'',STRIPE_WEBHOOK_SECRET:process.env.STRIPE_WEBHOOK_SECRET??'',RESEND_API_KEY:process.env.RESEND_API_KEY??''};
  const base=JSON.parse(await readFile('wrangler.jsonc','utf8')) as StagingConfig;
  const config=prepareStaging(base,variables,secrets,process.env.GITHUB_REF??'');
  if(!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)throw new Error('Cloudflare deployment credentials are required');
  try {
    await writeFile(configPath,JSON.stringify(config),{mode:0o600});await writeFile(secretPath,JSON.stringify(secrets),{mode:0o600});
    const run=(args:string[])=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{stdio:'pipe',env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:logPath}});
    run(['deploy','--config',configPath]);
    console.log('Protected staging Worker uploaded. Applying scoped runtime secrets.');
    run(['secret','bulk',secretPath,'--config',configPath]);
    console.log('Staging deployment completed. Provider verification is still required.');
  } catch {throw new Error('Staging deployment failed. Provider output was withheld to keep credentials and recipient details out of public logs. Inspect the staging provider dashboard.');}
  finally {await Promise.all([configPath,secretPath,logPath].map(path=>rm(path,{force:true})));}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await deploy();
