import {z} from 'zod';
import type {Actor} from './access';
import {database,rpc} from './database';
import {AppError,parseInput,submitMessage,workspaceView,type WorkspaceView} from './domain';
import {alertEmail,type Env} from './env';
import {digest} from './orders';

export async function requireAdmin(actor:Actor,env:Env):Promise<void> {
 await rpc(database(env),'require_staging_admin',{p_actor_id:actor.id});
}
export async function readWorkspace(actor:Actor,id:string,admin:boolean,env:Env):Promise<WorkspaceView> {
 const result=workspaceView.parse(await rpc(database(env),'order_workspace',{p_actor_id:actor.id,p_order_id:id,p_admin:admin}));
 const {paymentIntent,...view}=result;
 // Never render an arbitrary URL supplied by a request, database row, or email.
 return {...view,paymentIntent:null,paymentUrl:admin && paymentIntent && /^pi_[A-Za-z0-9]+$/.test(paymentIntent)?`https://dashboard.stripe.com/test/payments/${paymentIntent}`:null};
}
export async function listOrders(actor:Actor,offset:number,env:Env):Promise<unknown> {
 return rpc(database(env),'admin_orders',{p_actor_id:actor.id,p_offset:offset});
}
export async function sendMessage(actor:Actor,id:string,admin:boolean,body:unknown,env:Env):Promise<unknown> {
 const input=parseInput(submitMessage,body);
 return rpc(database(env),'send_order_message',{p_actor_id:actor.id,p_order_id:id,p_admin:admin,p_request_id:input.requestId,p_body:input.body,p_alert_email:alertEmail(env)});
}
export function validateReport(name:string,type:string,bytes:Uint8Array):void {
 if(!name || name.length>180 || /[\x00-\x1f\x7f/\\]/.test(name)) throw new AppError(400,'Use a simple file name under 180 characters');
 if(bytes.length<1 || bytes.length>10485760) throw new AppError(413,'Files must be between 1 byte and 10 MiB');
 const zip=bytes[0]===0x50 && bytes[1]===0x4b && bytes[2]===3 && bytes[3]===4;
 if(/\.pdf$/i.test(name) && type==='application/pdf' && new TextDecoder().decode(bytes.slice(0,5))==='%PDF-') return;
 if(/\.zip$/i.test(name) && type==='application/zip' && zip) return;
 if(/\.xlsx$/i.test(name) && type==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && zip) return;
 if(/\.csv$/i.test(name) && type==='text/csv') {
  try {if(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes).includes('\0')) throw new Error(); return;}catch {throw new AppError(400,'Upload a UTF-8 CSV file');}
 }
 throw new AppError(400,'Upload a PDF, CSV, XLSX or ZIP file matching its type');
}
const storedReport=z.object({id:z.uuid(),object_path:z.string(),state:z.enum(['pending','uploaded'])});
export async function uploadReport(actor:Actor,id:string,uploadId:string,name:string,type:string,bytes:Uint8Array,env:Env):Promise<{id:string}> {
 await requireAdmin(actor,env);
 validateReport(name,type,bytes);
 const db=database(env),sha256=await digest(bytes);
 const report=storedReport.parse(await rpc(db,'reserve_report',{p_actor_id:actor.id,p_order_id:id,p_upload_id:uploadId,p_name:name,p_bytes:bytes.length,p_content_type:type,p_sha256:sha256}));
 if(report.state==='uploaded') return {id:report.id};
 const {error}=await db.storage.from('order-reports').upload(report.object_path,bytes,{contentType:type,upsert:false});
 if(error) {
  const existing=await db.storage.from('order-reports').download(report.object_path);
  if(existing.error || !existing.data || existing.data.size!==bytes.length || await digest(new Uint8Array(await existing.data.arrayBuffer()))!==sha256) throw new AppError(503,'Upload failed. Retry this same file.');
 }
 await rpc(db,'confirm_report',{p_actor_id:actor.id,p_order_id:id,p_file_id:report.id});
 return {id:report.id};
}
export async function downloadWorkspaceFile(actor:Actor,id:string,fileId:string,admin:boolean,report:boolean,env:Env):Promise<Response> {
 const db=database(env);
 await rpc(db,'require_order_access',{p_actor_id:actor.id,p_order_id:id,p_admin:admin});
 const {data,error}=await db.from(report?'order_reports':'order_files').select('object_path,original_name').eq('order_id',id).eq('id',fileId).eq('state','uploaded').maybeSingle();
 if(error) throw new AppError(503,'File is temporarily unavailable');
 if(!data) throw new AppError(404,'File not found');
 const file=z.object({object_path:z.string(),original_name:z.string()}).parse(data);
 const {data:blob,error:downloadError}=await db.storage.from(report?'order-reports':'order-inputs').download(file.object_path);
 if(downloadError || !blob) throw new AppError(503,'File is temporarily unavailable');
 return new Response(blob,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`}});
}
