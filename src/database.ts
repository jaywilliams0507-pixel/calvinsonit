import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {AppError} from './domain';
import {configured,type Env} from './env';
export function database(env:Env):SupabaseClient {
  if(!configured(env.SUPABASE_URL) || !configured(env.SUPABASE_SERVICE_ROLE_KEY)) throw new AppError(503,'Staging data is not configured');
  return createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function rpc(db:SupabaseClient,name:string,args:Record<string,unknown>):Promise<unknown> {
  const {data,error}=await db.rpc(name,args);
  if(error) {
    if(error.code==='42501') throw new AppError(403,'Administrator access required');
    if(error.code==='P0002') throw new AppError(404,'Order or file not found');
    if(error.code==='23505' || error.code==='P0001' || error.code==='23514') throw new AppError(409,'This request conflicts with the current order. Refresh and try again.');
    throw new AppError(503,'Staging data is temporarily unavailable');
  }
  return data;
}
