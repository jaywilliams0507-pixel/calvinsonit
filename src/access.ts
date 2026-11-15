import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { AppError } from './domain';
import { configured, emailAllowlist, type Env } from './env';
import { database } from './database';
const keySets=new Map<string,JWTVerifyGetKey>();
export async function verifyAccess(request:Request,env:Env,keys?:JWTVerifyGetKey):Promise<string> {
  if(!configured(env.ACCESS_AUD) || !configured(env.ACCESS_TEAM_DOMAIN) || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN)) throw new AppError(503,'Preview protection is not configured');
  const token=request.headers.get('Cf-Access-Jwt-Assertion');
  if(!token || token.length>8192) throw new AppError(403,'This staging preview requires Cloudflare Access');
  const issuer=`https://${env.ACCESS_TEAM_DOMAIN}`;
  let keySet=keys ?? keySets.get(issuer);
  if(!keySet) { keySet=createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)); keySets.set(issuer,keySet); }
  try { const {payload}=await jwtVerify(token,keySet,{issuer,audience:env.ACCESS_AUD,algorithms:['RS256'],requiredClaims:['exp','iat','sub']}); return payload.sub!; }
  catch { throw new AppError(403,'This staging preview requires Cloudflare Access'); }
}
export type Actor={id:string;email:string};
export async function authenticatedActor(request:Request,env:Env):Promise<Actor> {
  const header=request.headers.get('Authorization')??'';
  if(!header.startsWith('Bearer ') || header.length>8192) throw new AppError(401,'Sign in to continue');
  const auth=createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await auth.auth.getUser(header.slice(7));
  if(error || !data.user?.email || !data.user.email_confirmed_at) throw new AppError(401,'Sign in to continue');
  const email=data.user.email.toLowerCase();
  if(!emailAllowlist(env).has(email)) throw new AppError(403,'This account is not admitted to staging');
  const db=database(env);
  const {data:tester,error:testerError}=await db.from('staging_testers').select('user_id').eq('user_id',data.user.id).maybeSingle();
  if(testerError) throw new AppError(503,'Account access is temporarily unavailable');
  if(!tester) throw new AppError(403,'This account is not admitted to staging');
  return {id:data.user.id,email};
}
