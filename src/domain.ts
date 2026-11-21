import { z } from 'zod';

export const services = [
  {id:'ai-audit', name:'AI Answer Visibility Audit', amountCents:29900, currency:'usd', requiresFiles:false, maxFiles:0, maxProducts:0, priceVariable:'STRIPE_PRICE_AI_AUDIT'},
  {id:'catalog-starter', name:'Catalog Starter', amountCents:18900, currency:'usd', requiresFiles:true, maxFiles:1, maxProducts:2000, priceVariable:'STRIPE_PRICE_CATALOG_STARTER'},
  {id:'catalog-full', name:'Full Catalog Cleanup', amountCents:59000, currency:'usd', requiresFiles:true, maxFiles:3, maxProducts:6000, priceVariable:'STRIPE_PRICE_CATALOG_FULL'},
  {id:'catalog-hosted', name:'Hosted Feed Build', amountCents:149000, currency:'usd', requiresFiles:true, maxFiles:3, maxProducts:10000, priceVariable:'STRIPE_PRICE_CATALOG_HOSTED'},
] as const;
export type Service = (typeof services)[number];
export type ServiceId = Service['id'];
export const audit = {questionsPerEngine:20, engines:['ChatGPT','Google AI Overviews','Gemini','Perplexity','Copilot']} as const;
export const serviceId = z.enum(['ai-audit','catalog-starter','catalog-full','catalog-hosted']);
export const uuid = z.uuid();
const website = z.url().refine(value => new URL(value).protocol === 'https:', 'Use an https website URL');
const intake = z.object({
  businessName:z.string().trim().min(1).max(160), website,
  services:z.string().trim().max(2000).optional(), markets:z.string().trim().max(1000).optional(),
  competitors:z.string().trim().max(2000).optional(), notes:z.string().trim().max(3000).optional(),
  productCount:z.number().int().positive().optional(), distributorCount:z.number().int().min(1).max(3).optional(),
}).strict();
export const submitOrder = z.object({requestId:uuid,serviceId,intake,termsAccepted:z.literal(true)}).strict().superRefine((value, ctx) => {
  const service = getService(value.serviceId);
  if(service.id==='catalog-hosted') ctx.addIssue({code:'custom',path:['serviceId'],message:'Hosted Feed Build is not available for purchase'});
  if (service.id === 'ai-audit') {
    for (const field of ['services','markets'] as const) if ((value.intake[field]?.length ?? 0) < 2) ctx.addIssue({code:'custom',path:['intake',field],message:`Enter your ${field}`});
  } else {
    if (!value.intake.productCount || value.intake.productCount > service.maxProducts) ctx.addIssue({code:'custom',path:['intake','productCount'],message:`Enter 1–${service.maxProducts} products`});
    if (service.id === 'catalog-hosted' && !value.intake.distributorCount) ctx.addIssue({code:'custom',path:['intake','distributorCount'],message:'Enter 1–3 distributors'});
  }
});
export const submitLead = z.object({requestId:uuid,name:z.string().trim().min(1).max(160),email:z.email().max(254).transform(v=>v.toLowerCase()),message:z.string().trim().min(10).max(3000),serviceId:serviceId.optional()}).strict();
export const orderView = z.object({id:uuid,serviceId,status:z.enum(['draft','awaiting_payment','paid','refunded','payment_review']),amountCents:z.number().int().positive(),currency:z.literal('usd'),intakeCompletedAt:z.string().nullable(),paidAt:z.string().nullable(),dueDate:z.string().nullable(),pendingFiles:z.array(z.object({name:z.string(),bytes:z.number().int()})).default([]),files:z.array(z.object({id:uuid,name:z.string(),bytes:z.number().int()}))});
export type OrderView = z.infer<typeof orderView>;
export function getService(id: ServiceId): Service { return services.find(s=>s.id === id)!; }
export class AppError extends Error { constructor(public status:number, message:string) { super(message); } }
export function requireUuid(value:string):string { const result=uuid.safeParse(value); if(!result.success) throw new AppError(400,'Invalid identifier'); return result.data; }
export function parseInput<T>(schema:z.ZodType<T>, value:unknown):T { const parsed=schema.safeParse(value); if(!parsed.success) throw new AppError(400,parsed.error.issues[0]?.message ?? 'Invalid input'); return parsed.data; }

export const submitMessage=z.object({requestId:uuid,body:z.string().trim().min(1).max(3000)}).strict();
export function purchasable(id:ServiceId):boolean {return id!=='catalog-hosted';}

const fileView=z.object({id:z.uuid(),name:z.string(),bytes:z.number().int()});
export const workspaceView=z.object({
 order:orderView,fulfilmentStatus:z.enum(['pending','ready']),intake:z.record(z.string(),z.unknown()).nullable(),
 clientEmail:z.string().nullable(),paymentIntent:z.string().nullable(),reports:z.array(fileView),
 messages:z.array(z.object({id:z.uuid(),senderRole:z.enum(['client','admin']),body:z.string(),createdAt:z.string()})),
});
export type WorkspaceView=z.infer<typeof workspaceView> & {paymentUrl?:string|null};
