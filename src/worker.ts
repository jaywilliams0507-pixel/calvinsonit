import {requireAdmin,readWorkspace,listOrders,sendMessage,uploadReport,downloadWorkspaceFile} from './workspace';
import {z} from 'zod';
import {verifyAccess,authenticatedActor} from './access';
import {AppError,audit,parseInput,requireUuid,services,submitLead,purchasable} from './domain';
import {alertEmail,appOrigin,publicSupabaseConfig,type Env} from './env';
import {database,rpc} from './database';
import {createOrder,readOrder,completeIntake,uploadFile,downloadFile,digest} from './orders';
import {checkout,acceptWebhook} from './payments';
import {deliverNotifications} from './notifications';

function json(value:unknown,status=200):Response { return Response.json(value,{status}); }
export async function readBytes(request:Request,limit:number):Promise<Uint8Array> {
  const claimed=Number(request.headers.get('Content-Length'));
  if(claimed>limit) throw new AppError(413,'Request is too large');
  if(!request.body) return new Uint8Array();
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];
  let total=0;
  while(true) {
    const {value,done}=await reader.read();
    if(done) break;
    total+=value.length;
    if(total>limit) { await reader.cancel(); throw new AppError(413,'Request is too large'); }
    chunks.push(value);
  }
  const result=new Uint8Array(total);let offset=0;
  for(const chunk of chunks) { result.set(chunk,offset);offset+=chunk.length; }
  return result;
}
async function readJson(request:Request):Promise<unknown> {
  if(request.headers.get('Content-Type')?.split(';')[0]?.trim()!=='application/json') throw new AppError(415,'Send JSON');
  try { return JSON.parse(new TextDecoder().decode(await readBytes(request,16384))) as unknown; }
  catch(error) { if(error instanceof AppError) throw error; throw new AppError(400,'Invalid JSON'); }
}
function secure(response:Response,env:Env):Response {
  const headers=new Headers(response.headers);
  headers.set('Cache-Control','private, no-store');headers.set('X-Robots-Tag','noindex, nofollow');
  headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('X-Frame-Options','DENY');
  const supabase=/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(env.SUPABASE_URL??'')?env.SUPABASE_URL:'';
  headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ${supabase}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export async function handleRequest(request:Request,env:Env):Promise<Response> {
  try {
    const url=new URL(request.url);
    if(url.origin!==appOrigin(env)) throw new AppError(403,'Use the configured staging preview');
    if(url.pathname==='/api/stripe/webhook' && request.method==='POST') {
      const raw=new TextDecoder().decode(await readBytes(request,524288));
      await acceptWebhook(raw,request.headers.get('Stripe-Signature')??'',env);
      return secure(json({received:true}),env);
    }
    const accessSubject=await verifyAccess(request,env);
    if(request.method!=='GET' && request.method!=='HEAD' && request.headers.get('Origin')!==appOrigin(env)) throw new AppError(403,'Invalid request origin');
    let result:Response;
    if(url.pathname==='/api/config' && request.method==='GET') {
      result=json({...publicSupabaseConfig(env),testMode:true,services:services.map(({priceVariable,...service})=>({...service,purchasable:purchasable(service.id)})),audit});
    } else if(url.pathname==='/api/leads' && request.method==='POST') {
      const input=parseInput(submitLead,await readJson(request));
      await rpc(database(env),'create_lead',{p_request_id:input.requestId,p_actor_hash:await digest(new TextEncoder().encode(accessSubject)),p_name:input.name,p_email:input.email,p_message:input.message,p_service_id:input.serviceId??null,p_alert_email:alertEmail(env)});
      result=json({received:true},201);
    } else if(url.pathname==='/api/orders' && request.method==='POST') {
      result=json(await createOrder(await authenticatedActor(request,env),await readJson(request),env),201);
    } else if(url.pathname==='/api/admin/orders' && request.method==='GET') {
      const actor=await authenticatedActor(request,env);
      await requireAdmin(actor,env);
      const offset=Number(url.searchParams.get('offset')??'0');
      if(!Number.isSafeInteger(offset) || offset<0) throw new AppError(400,'Invalid offset');
      result=json(await listOrders(actor,offset,env));
    } else if(/^\/api\/(admin\/)?orders\/[^/]+\/(workspace|reports|messages)(?:\/[^/]+)?$/.test(url.pathname) || /^\/api\/admin\/orders\//.test(url.pathname)) {
      const route=/^\/api\/(admin\/)?orders\/([^/]+)(?:\/(workspace|reports|messages|files)(?:\/([^/]+))?)?$/.exec(url.pathname);
      if(!route) throw new AppError(404,'Not found');
      const admin=!!route[1],id=requireUuid(route[2]!),actor=await authenticatedActor(request,env);
      if(admin) await requireAdmin(actor,env);
      if(request.method==='GET' && (!route[3] || route[3]==='workspace') && !route[4]) result=json(await readWorkspace(actor,id,admin,env));
      else if(request.method==='POST' && route[3]==='messages' && !route[4]) result=json(await sendMessage(actor,id,admin,await readJson(request),env),201);
      else if(request.method==='GET' && (route[3]==='reports' || (admin && route[3]==='files')) && route[4]) result=await downloadWorkspaceFile(actor,id,requireUuid(route[4]),admin,route[3]==='reports',env);
      else if(request.method==='POST' && admin && route[3]==='reports' && !route[4]) {
        let name:string;
        try {name=decodeURIComponent(request.headers.get('X-File-Name')??'');}catch{throw new AppError(400,'Invalid file name');}
        result=json(await uploadReport(actor,id,requireUuid(request.headers.get('X-Upload-Id')??''),name,request.headers.get('Content-Type')??'',await readBytes(request,10485760),env),201);
      } else throw new AppError(405,'Method not allowed');
    } else {
      const route=/^\/api\/orders\/([^/]+)(?:\/(checkout|complete-intake|files)(?:\/([^/]+))?)?$/.exec(url.pathname);
      if(route) {
        const id=requireUuid(route[1]!),actor=await authenticatedActor(request,env);
        if(request.method==='GET' && !route[2]) result=json(await readOrder(actor,id,env));
        else if(request.method==='POST' && route[2]==='complete-intake' && !route[3]) {parseInput(z.object({}).strict(),await readJson(request));result=json(await completeIntake(actor,id,env));}
        else if(request.method==='POST' && route[2]==='checkout' && !route[3]) {parseInput(z.object({}).strict(),await readJson(request));result=json(await checkout(actor,id,env));}
        else if(request.method==='POST' && route[2]==='files' && !route[3]) {
          let name:string;
          try {name=decodeURIComponent(request.headers.get('X-File-Name')??'');}catch{throw new AppError(400,'Invalid file name');}
          result=json(await uploadFile(actor,id,requireUuid(request.headers.get('X-Upload-Id')??''),name,request.headers.get('Content-Type')??'',await readBytes(request,10485760),env),201);
        } else if(request.method==='GET' && route[2]==='files' && route[3]) result=await downloadFile(actor,id,requireUuid(route[3]),env);
        else throw new AppError(405,'Method not allowed');
      } else if(url.pathname.startsWith('/api/')) throw new AppError(404,'Not found');
      else if(request.method==='GET' || request.method==='HEAD') result=await env.ASSETS.fetch(request);
      else throw new AppError(405,'Method not allowed');
    }
    return secure(result,env);
  } catch(error) {
    if(error instanceof AppError) return secure(json({error:error.message},error.status),env);
    return secure(json({error:'Staging is temporarily unavailable. Please try again.'},503),env);
  }
}
export default {
  fetch:handleRequest,
  async scheduled(_controller:ScheduledController,env:Env):Promise<void> { await deliverNotifications(env); },
} satisfies ExportedHandler<Env>;
