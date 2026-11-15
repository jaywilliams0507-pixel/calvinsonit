import Stripe from 'stripe';
import {z} from 'zod';
import type {Actor} from './access';
import {database,rpc} from './database';
import {AppError,getService,services,serviceId,uuid} from './domain';
import {alertEmail,appOrigin,configured,type Env} from './env';

export function stripeClient(env:Env):Stripe {
  if(!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY??'')) throw new AppError(503,'Stripe test mode is not configured');
  return new Stripe(env.STRIPE_SECRET_KEY,{httpClient:Stripe.createFetchHttpClient(),maxNetworkRetries:2,timeout:15000});
}
const attemptSchema=z.object({id:uuid,order_id:uuid,state:z.enum(['reserved','open','expired','paid','review']),stripe_price_id:z.string(),stripe_session_id:z.string().nullable(),checkout_url:z.string().nullable(),created_at:z.string(),expires_at:z.string().nullable(),service_id:serviceId,amount_cents:z.number().int(),client_email:z.string()});
function sessionMetadata(session:Stripe.Checkout.Session):{orderId:string;attemptId:string} {
  const parsed=z.object({order_id:uuid,attempt_id:uuid}).safeParse(session.metadata);
  if(!parsed.success) throw new AppError(400,'Unrecognized payment');
  return {orderId:parsed.data.order_id,attemptId:parsed.data.attempt_id};
}
function testSession(session:Stripe.Checkout.Session):void {
  if(session.livemode || session.mode!=='payment' || session.currency!=='usd') throw new AppError(400,'Only configured test payments are accepted');
}
export async function checkout(actor:Actor,orderId:string,env:Env):Promise<{url:string}> {
  const stripe=stripeClient(env),db=database(env);
  let attempt=attemptSchema.parse(await rpc(db,'reserve_checkout',{p_user_id:actor.id,p_order_id:orderId,p_price_ids:Object.fromEntries(services.map(service=>[service.id,env[service.priceVariable]]))}));
  if(attempt.state==='review') throw new AppError(409,'Checkout needs an operator review before retrying');
  if(attempt.stripe_session_id) {
    const existing=await stripe.checkout.sessions.retrieve(attempt.stripe_session_id);
    testSession(existing);
    const binding=sessionMetadata(existing);
    if(binding.orderId!==orderId || binding.attemptId!==attempt.id || existing.amount_total!==attempt.amount_cents) throw new AppError(409,'Checkout binding needs an operator review');
    if(existing.status==='open' && existing.url) return {url:checkoutUrl(existing.url)};
    if(existing.status==='complete') throw new AppError(409,'Payment is being confirmed. Refresh the order shortly.');
    if(existing.status!=='expired') throw new AppError(409,'Checkout needs an operator review');
    await rpc(db,'expire_checkout',{p_attempt_id:attempt.id,p_session_id:existing.id});
    attempt=attemptSchema.parse(await rpc(db,'reserve_checkout',{p_user_id:actor.id,p_order_id:orderId,p_price_ids:Object.fromEntries(services.map(service=>[service.id,env[service.priceVariable]]))}));
  }
  const service=getService(attempt.service_id),priceId=attempt.stripe_price_id;
  if(!configured(priceId) || !priceId.startsWith('price_')) throw new AppError(503,'Test prices are not configured');
  const price=await stripe.prices.retrieve(priceId);
  if(price.livemode || price.type!=='one_time' || price.currency!=='usd' || price.unit_amount!==service.amountCents || price.billing_scheme!=='per_unit' || price.transform_quantity || attempt.amount_cents!==service.amountCents) throw new AppError(503,'Test price does not match the listed service');
  const origin=appOrigin(env);
  const session=await stripe.checkout.sessions.create({
    mode:'payment',line_items:[{price:price.id,quantity:1}],payment_method_types:['card'],
    client_reference_id:orderId,customer_email:attempt.client_email,
    metadata:{order_id:orderId,attempt_id:attempt.id},payment_intent_data:{metadata:{order_id:orderId,attempt_id:attempt.id}},
    success_url:`${origin}/order/?id=${orderId}`,cancel_url:`${origin}/order/?id=${orderId}`,
    allow_promotion_codes:false,automatic_tax:{enabled:false},expires_at:Math.floor(new Date(attempt.created_at).getTime()/1000)+86400,
  },{idempotencyKey:`checkout:${attempt.id}`});
  testSession(session);
  if(!session.url || session.amount_total!==service.amountCents) throw new AppError(503,'Test checkout could not be verified');
  const url=checkoutUrl(session.url);
  await rpc(db,'attach_checkout',{p_attempt_id:attempt.id,p_session_id:session.id,p_url:url,p_expires_at:new Date(session.expires_at*1000).toISOString()});
  return {url};
}
function checkoutUrl(value:string):string {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.hostname!=='checkout.stripe.com') throw new AppError(503,'Invalid payment destination');
  return url.href;
}

export async function acceptWebhook(body:string,signature:string,env:Env):Promise<void> {
  const stripe=stripeClient(env);
  if(!configured(env.STRIPE_WEBHOOK_SECRET)) throw new AppError(503,'Webhook is not configured');
  let event:Stripe.Event;
  try { event=await stripe.webhooks.constructEventAsync(body,signature,env.STRIPE_WEBHOOK_SECRET,undefined,Stripe.createSubtleCryptoProvider()); }
  catch { throw new AppError(400,'Invalid payment signature'); }
  if(event.livemode) throw new AppError(400,'Live payments are not accepted');
  const db=database(env);
  if(event.type==='checkout.session.completed' || event.type==='checkout.session.async_payment_succeeded') {
    const session=await stripe.checkout.sessions.retrieve(event.data.object.id);
    testSession(session);
    if(session.payment_status!=='paid') return;
    const binding=sessionMetadata(session);
    const {data:order,error}=await db.from('orders').select('service_id,amount_cents').eq('id',binding.orderId).maybeSingle();
    if(error || !order) throw new AppError(503,'Payment order is unavailable');
    const row=z.object({service_id:serviceId,amount_cents:z.number().int()}).parse(order),service=getService(row.service_id);
    const {data:storedAttempt,error:attemptError}=await db.from('checkout_attempts').select('stripe_price_id').eq('id',binding.attemptId).eq('order_id',binding.orderId).maybeSingle();
    if(attemptError || !storedAttempt) throw new AppError(503,'Payment attempt is unavailable');
    const expectedPrice=z.object({stripe_price_id:z.string()}).parse(storedAttempt).stripe_price_id;
    const items=await stripe.checkout.sessions.listLineItems(session.id,{limit:2});
    const item=items.data[0],price=item?.price;
    if(items.has_more || items.data.length!==1 || item?.quantity!==1 || !price || price.livemode || price.id!==expectedPrice || price.unit_amount!==service.amountCents || session.amount_total!==service.amountCents || row.amount_cents!==service.amountCents || session.client_reference_id!==binding.orderId) throw new AppError(400,'Payment does not match the order');
    const paymentIntent=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
    if(!paymentIntent) throw new AppError(400,'Payment intent is missing');
    await rpc(db,'record_payment',{p_event_id:event.id,p_event_type:event.type,p_attempt_id:binding.attemptId,p_order_id:binding.orderId,p_session_id:session.id,p_payment_intent:paymentIntent,p_price_id:expectedPrice,p_amount:session.amount_total,p_currency:session.currency,p_paid_at:new Date(event.created*1000).toISOString(),p_alert_email:alertEmail(env)});
  } else if(event.type==='charge.refunded' || event.type==='charge.dispute.created') {
    const chargeId=event.type==='charge.refunded'?event.data.object.id:typeof event.data.object.charge==='string'?event.data.object.charge:event.data.object.charge.id;
    const charge=await stripe.charges.retrieve(chargeId);
    if(charge.livemode) throw new AppError(400,'Live payments are not accepted');
    const piId=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id;
    if(!piId) throw new AppError(400,'Payment intent is missing');
    const pi=await stripe.paymentIntents.retrieve(piId);
    if(pi.livemode) throw new AppError(400,'Live payments are not accepted');
    const binding=z.object({order_id:uuid,attempt_id:uuid}).safeParse(pi.metadata);
    if(!binding.success) return;
    await rpc(db,'record_payment_issue',{p_event_id:event.id,p_event_type:event.type,p_attempt_id:binding.data.attempt_id,p_order_id:binding.data.order_id,p_payment_intent:piId,p_fully_refunded:event.type==='charge.refunded' && charge.amount_refunded>=charge.amount,p_alert_email:alertEmail(env)});
  }
}
