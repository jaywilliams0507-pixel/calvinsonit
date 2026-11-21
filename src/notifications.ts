import {z} from 'zod';
import {database,rpc} from './database';
import {configured,emailAllowlist,appOrigin,type Env} from './env';
const messageSchema=z.object({id:z.uuid(),claim_token:z.uuid(),kind:z.enum(['lead_alert','intake_alert','paid_client','paid_alert','payment_review_alert','report_ready','order_message_client','order_message_admin']),recipient:z.string(),payload:z.record(z.string(),z.unknown())});
type Message=z.infer<typeof messageSchema>;
export function notificationText(message:Message,origin:string):{subject:string;text:string} {
  const p=message.payload;
  const order=typeof p.orderId==='string'?`\nOrder ID: ${p.orderId}`:'';
  const clientOrder=typeof p.orderId==='string'?`\nYour order: ${origin}/order/?id=${p.orderId}`:'';
  switch(message.kind) {
    case 'report_ready':return {subject:'[TEST] CalvinsonIT report ready',text:`Your report is ready. Sign in to download it from your private order page.${clientOrder}`};
    case 'order_message_client':return {subject:'[TEST] CalvinsonIT order message',text:`CalvinsonIT sent you a message. Sign in to read and reply.${clientOrder}`};
    case 'order_message_admin':return {subject:'[TEST] CalvinsonIT client reply',text:`A client sent an order message. Sign in to read and reply.\nAdmin order: ${origin}/admin/?id=${p.orderId}`};
    case 'lead_alert':return {subject:'[TEST] CalvinsonIT contact lead',text:`Name: ${p.name}\nEmail: ${p.email}\nService: ${p.service??'General question'}\n\n${p.message}`};
    case 'intake_alert':return {subject:'[TEST] CalvinsonIT intake received',text:`A new ${p.service} intake was received from ${p.clientEmail}. Payment is not yet confirmed.${order}`};
    case 'paid_client':return {subject:'[TEST] CalvinsonIT payment confirmed',text:`Your test payment is confirmed. No real charge was made.${p.dueDate?`\nAI audit due: ${p.dueDate} (Eastern). 20 questions on each of ChatGPT, Google AI Overviews, Gemini, Perplexity and Copilot; 100 checks total.`:''}${clientOrder}\nThis is an order update, not a marketing message.`};
    case 'paid_alert':return {subject:'[TEST] CalvinsonIT paid order',text:`Test payment confirmed for ${p.service}. Amount: $${(Number(p.amountCents)/100).toFixed(2)}.${order}`};
    case 'payment_review_alert':return {subject:'[TEST] CalvinsonIT payment needs review',text:`Pause work on this order until payment has been reconciled. Reason: ${p.reason}.${order}`};
  }
}
export async function deliverNotifications(env:Env):Promise<void> {
  if(!configured(env.RESEND_API_KEY) || !configured(env.EMAIL_FROM)) return;
  const origin=appOrigin(env),allowed=emailAllowlist(env),db=database(env);
  const messages=z.array(messageSchema).parse(await rpc(db,'claim_notifications',{p_limit:10}));
  for(const message of messages) {
    const finish=(outcome:'sent'|'retry'|'manual_review',id:string|null=null)=>rpc(db,'finish_notification',{p_id:message.id,p_claim_token:message.claim_token,p_outcome:outcome,p_provider_id:id});
    if(!allowed.has(message.recipient.toLowerCase())) { await finish('manual_review'); continue; }
    if(message.kind==='paid_client' || message.kind==='paid_alert' || message.kind==='report_ready') {
      const {data,error}=await db.from('orders').select('status').eq('id',message.payload.orderId).maybeSingle();
      if(error) { await finish('retry'); continue; }
      if(data?.status!=='paid') { await finish('manual_review'); continue; }
    }
    const content=notificationText(message,origin);
    try {
      const response=await fetch('https://api.resend.com/emails',{
        method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`calvinsonit-staging/${message.id}`},
        body:JSON.stringify({from:env.EMAIL_FROM,to:[message.recipient],subject:content.subject,text:content.text}),signal:AbortSignal.timeout(20000),
      });
      if(response.ok) {
        const result=z.object({id:z.string()}).parse(await response.json());
        await finish('sent',result.id);
      } else await finish(response.status===429 || response.status>=500?'retry':'manual_review');
    } catch { await finish('retry'); }
  }
}
