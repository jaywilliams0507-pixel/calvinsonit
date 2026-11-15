import {z} from 'zod';
import {database,rpc} from './database';
import {AppError,orderView,parseInput,submitOrder,type OrderView} from './domain';
import {alertEmail,type Env} from './env';
import type {Actor} from './access';

export async function createOrder(actor:Actor,body:unknown,env:Env):Promise<OrderView> {
  const input=parseInput(submitOrder,body);
  return orderView.parse(await rpc(database(env),'create_order',{p_user_id:actor.id,p_request_id:input.requestId,p_service_id:input.serviceId,p_intake:input.intake,p_email:actor.email,p_alert_email:alertEmail(env)}));
}
export async function readOrder(actor:Actor,id:string,env:Env):Promise<OrderView> {
  return orderView.parse(await rpc(database(env),'order_view',{p_user_id:actor.id,p_order_id:id}));
}
export async function completeIntake(actor:Actor,id:string,env:Env):Promise<OrderView> {
  return orderView.parse(await rpc(database(env),'complete_intake',{p_user_id:actor.id,p_order_id:id}));
}
export async function digest(bytes:Uint8Array):Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),value=>value.toString(16).padStart(2,'0')).join('');
}
const storedFile=z.object({id:z.uuid(),object_path:z.string(),state:z.enum(['pending','uploaded'])});
export async function uploadFile(actor:Actor,orderId:string,uploadId:string,name:string,contentType:string,bytes:Uint8Array,env:Env):Promise<{id:string}> {
  if(!name || name.length>180 || /[\x00-\x1f/\\]/.test(name)) throw new AppError(400,'Use a simple file name under 180 characters');
  if(bytes.length<1 || bytes.length>10485760) throw new AppError(413,'Files must be between 1 byte and 10 MiB');
  if(name.toLowerCase().endsWith('.csv') && contentType==='text/csv') {
    try { const csv=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes); if(csv.includes('\0')) throw new Error(); }
    catch { throw new AppError(400,'Upload a UTF-8 CSV file'); }
  } else if(name.toLowerCase().endsWith('.xlsx') && contentType==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    if(bytes[0]!==0x50 || bytes[1]!==0x4b || bytes[2]!==0x03 || bytes[3]!==0x04) throw new AppError(400,'Upload an XLSX spreadsheet');
  } else throw new AppError(400,'Upload a CSV or XLSX file');
  const db=database(env),sha256=await digest(bytes);
  const file=storedFile.parse(await rpc(db,'reserve_file',{p_user_id:actor.id,p_order_id:orderId,p_upload_id:uploadId,p_name:name,p_bytes:bytes.length,p_content_type:contentType,p_sha256:sha256}));
  if(file.state==='uploaded') return {id:file.id};
  const {error}=await db.storage.from('order-inputs').upload(file.object_path,bytes,{contentType,upsert:false});
  if(error) {
    const existing=await db.storage.from('order-inputs').download(file.object_path);
    if(existing.error || !existing.data || existing.data.size!==bytes.length || await digest(new Uint8Array(await existing.data.arrayBuffer()))!==sha256) throw new AppError(503,'Upload failed. Retry this same file.');
  }
  await rpc(db,'confirm_file',{p_user_id:actor.id,p_order_id:orderId,p_file_id:file.id});
  return {id:file.id};
}
export async function downloadFile(actor:Actor,orderId:string,fileId:string,env:Env):Promise<Response> {
  await readOrder(actor,orderId,env);
  const db=database(env);
  const {data,error}=await db.from('order_files').select('object_path,original_name,content_type').eq('id',fileId).eq('order_id',orderId).eq('state','uploaded').maybeSingle();
  if(error) throw new AppError(503,'File is temporarily unavailable');
  if(!data) throw new AppError(404,'File not found');
  const file=z.object({object_path:z.string(),original_name:z.string(),content_type:z.string()}).parse(data);
  const {data:blob,error:downloadError}=await db.storage.from('order-inputs').download(file.object_path);
  if(downloadError || !blob) throw new AppError(503,'File is temporarily unavailable');
  return new Response(blob,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`}});
}
