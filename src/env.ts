import { AppError } from './domain';
import {decodeJwt} from 'jose';
export interface Env {
  ASSETS: Fetcher;
  APP_ORIGIN:string; ACCESS_TEAM_DOMAIN:string; ACCESS_AUD:string;
  SUPABASE_URL:string; SUPABASE_PUBLISHABLE_KEY:string; SUPABASE_SERVICE_ROLE_KEY:string;
  STRIPE_SECRET_KEY:string; STRIPE_WEBHOOK_SECRET:string;
  STRIPE_PRICE_AI_AUDIT:string; STRIPE_PRICE_CATALOG_STARTER:string; STRIPE_PRICE_CATALOG_FULL:string; STRIPE_PRICE_CATALOG_HOSTED?:string;
  ALERT_EMAIL:string; EMAIL_FROM:string; STAGING_EMAIL_ALLOWLIST:string; RESEND_API_KEY:string;
}
export function configured(value:string|undefined):value is string { return !!value && !value.includes('REPLACE'); }
export function appOrigin(env:Env):string {
  if(!configured(env.APP_ORIGIN)) throw new AppError(503,'Staging is not configured');
  const origin=new URL(env.APP_ORIGIN);
  if(origin.protocol!=='https:' || !origin.hostname.endsWith('.workers.dev') || origin.origin!==env.APP_ORIGIN) throw new AppError(503,'Invalid staging origin');
  return origin.origin;
}
export function emailAllowlist(env:Env):Set<string> {
  return new Set((env.STAGING_EMAIL_ALLOWLIST??'').split(',').map(s=>s.trim().toLowerCase()).filter(s=>s && !s.includes('replace')));
}
export function alertEmail(env:Env):string {
  const email=env.ALERT_EMAIL?.trim().toLowerCase();
  if(!email || !emailAllowlist(env).has(email)) throw new AppError(503,'Alert delivery is not configured');
  return email;
}

export function publicSupabaseConfig(env:Env):{supabaseUrl:string;supabasePublishableKey:string} {
  if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env.SUPABASE_URL??'') || !configured(env.SUPABASE_PUBLISHABLE_KEY)) throw new AppError(503,'Sign-in is not configured');
  const key=env.SUPABASE_PUBLISHABLE_KEY;
  if(!key.startsWith('sb_publishable_')) {
    try {if(decodeJwt(key).role!=='anon') throw new Error();} catch {throw new AppError(503,'A public Supabase key is required');}
  }
  return {supabaseUrl:env.SUPABASE_URL,supabasePublishableKey:key};
}
