begin;

create table public.service_catalog (
  id text primary key,
  name text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'usd'),
  max_files integer not null,
  max_products integer not null
);
insert into public.service_catalog values
  ('ai-audit','AI Answer Visibility Audit',29900,'usd',0,0),
  ('catalog-starter','Catalog Starter',18900,'usd',1,2000),
  ('catalog-full','Full Catalog Cleanup',59000,'usd',3,6000),
  ('catalog-hosted','Hosted Feed Build',149000,'usd',3,10000);

create table public.staging_testers (user_id uuid primary key references auth.users(id) on delete cascade);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  service_id text not null references public.service_catalog(id),
  amount_cents integer not null check(amount_cents>0),
  currency text not null default 'usd' check(currency='usd'),
  intake jsonb not null,
  client_email text not null,
  terms_version text not null default 'staging-2026-11-15',
  status text not null check(status in ('draft','awaiting_payment','paid','refunded','payment_review')),
  intake_completed_at timestamptz,
  paid_at timestamptz,
  due_date date,
  created_at timestamptz not null default now(),
  unique(user_id,request_id)
);
create index orders_owner on public.orders(user_id,created_at);
create table public.order_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  upload_id uuid not null,
  object_path text not null unique,
  original_name text not null,
  byte_count integer not null check(byte_count between 1 and 10485760),
  content_type text not null check(content_type in ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  sha256 text not null check(length(sha256)=64),
  state text not null default 'pending' check(state in ('pending','uploaded')),
  created_at timestamptz not null default now(),
  unique(order_id,upload_id)
);
create table public.checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  state text not null default 'reserved' check(state in ('reserved','open','expired','paid','review')),
  stripe_price_id text not null check(stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  stripe_session_id text unique,
  stripe_payment_intent text unique,
  checkout_url text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_active_checkout on public.checkout_attempts(order_id) where state in ('reserved','open','review');
create table public.stripe_events (
  id text primary key,
  event_type text not null,
  attempt_id uuid not null references public.checkout_attempts(id),
  processed_at timestamptz not null default now()
);
create table public.leads (
  id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
  actor_hash text not null, name text not null,email text not null,message text not null,
  service_id text references public.service_catalog(id),created_at timestamptz not null default now()
);
create index leads_actor on public.leads(actor_hash,created_at);
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),dedupe_key text not null unique,
  kind text not null check(kind in ('lead_alert','intake_alert','paid_client','paid_alert','payment_review_alert')),
  recipient text not null,payload jsonb not null,
  state text not null default 'pending' check(state in ('pending','processing','sent','manual_review')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  claim_token uuid,claimed_until timestamptz,first_attempt_at timestamptz,
  provider_id text,created_at timestamptz not null default now(),sent_at timestamptz
);
create index outbox_due on public.notification_outbox(state,next_attempt_at);

create function public.is_staging_tester() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.staging_testers where user_id=auth.uid());
$$;

alter table public.service_catalog enable row level security;
alter table public.staging_testers enable row level security;
alter table public.orders enable row level security;
alter table public.order_files enable row level security;
alter table public.checkout_attempts enable row level security;
alter table public.stripe_events enable row level security;
alter table public.leads enable row level security;
alter table public.notification_outbox enable row level security;
create policy owned_order_read on public.orders for select to authenticated using(user_id=auth.uid() and public.is_staging_tester());
create policy owned_file_read on public.order_files for select to authenticated using(public.is_staging_tester() and exists(select 1 from public.orders where orders.id=order_id and orders.user_id=auth.uid()));
revoke all on public.orders,public.order_files from anon,authenticated;
grant select on public.orders,public.order_files to authenticated;
revoke all on public.service_catalog,public.staging_testers,public.checkout_attempts,public.stripe_events,public.leads,public.notification_outbox from anon,authenticated;
revoke insert,update,delete on public.orders,public.order_files from anon,authenticated;
grant all on public.service_catalog,public.staging_testers,public.orders,public.order_files,public.checkout_attempts,public.stripe_events,public.leads,public.notification_outbox to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('order-inputs','order-inputs',false,10485760,array['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
create policy owned_input_read on storage.objects for select to authenticated using(
 bucket_id='order-inputs' and public.is_staging_tester() and exists(
 select 1 from public.order_files f join public.orders o on o.id=f.order_id
 where f.object_path=name and f.state='uploaded' and o.user_id=auth.uid()));

create function public.order_view(p_user_id uuid,p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order_id and user_id=p_user_id;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 return jsonb_build_object('id',o.id,'serviceId',o.service_id,'status',o.status,'amountCents',o.amount_cents,'currency',o.currency,
 'intakeCompletedAt',o.intake_completed_at,'paidAt',o.paid_at,'dueDate',o.due_date,
 'pendingFiles',coalesce((select jsonb_agg(jsonb_build_object('name',f.original_name,'bytes',f.byte_count) order by f.created_at) from public.order_files f where f.order_id=o.id and f.state='pending'),'[]'::jsonb),
 'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'bytes',f.byte_count) order by f.created_at)
 from public.order_files f where f.order_id=o.id and f.state='uploaded'),'[]'::jsonb));
end; $$;

create function public.create_order(p_user_id uuid,p_request_id uuid,p_service_id text,p_intake jsonb,p_email text,p_alert_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; s public.service_catalog; completed timestamptz;
begin
 if not exists(select 1 from public.staging_testers where user_id=p_user_id) then raise exception 'tester required'; end if;
 select * into s from public.service_catalog where id=p_service_id;
 if not found then raise exception 'service unavailable'; end if;
 if length(coalesce(p_intake->>'businessName','')) not between 1 and 160 or coalesce(p_intake->>'website','') not like 'https://%' then raise exception 'invalid intake'; end if;
 if s.id='ai-audit' then
  if length(coalesce(p_intake->>'services',''))<2 or length(coalesce(p_intake->>'markets',''))<2 then raise exception 'incomplete intake'; end if;
  completed:=now();
 else
  if coalesce((p_intake->>'productCount')::integer,0) not between 1 and s.max_products then raise exception 'product limit'; end if;
  if s.id='catalog-hosted' and coalesce((p_intake->>'distributorCount')::integer,0) not between 1 and 3 then raise exception 'distributor limit'; end if;
 end if;
 insert into public.orders(user_id,request_id,service_id,amount_cents,intake,client_email,status,intake_completed_at)
 values(p_user_id,p_request_id,s.id,s.amount_cents,p_intake,p_email,case when completed is null then 'draft' else 'awaiting_payment' end,completed)
 on conflict(user_id,request_id) do nothing returning * into o;
 if not found then
  select * into o from public.orders where user_id=p_user_id and request_id=p_request_id;
  if o.service_id<>p_service_id or o.intake<>p_intake or o.client_email<>p_email then raise exception 'idempotency mismatch'; end if;
 else
  insert into public.notification_outbox(dedupe_key,kind,recipient,payload) values('intake:'||o.id,'intake_alert',p_alert_email,jsonb_build_object('orderId',o.id,'service',s.name,'clientEmail',p_email));
 end if;
 return public.order_view(p_user_id,o.id);
end; $$;

create function public.reserve_file(p_user_id uuid,p_order_id uuid,p_upload_id uuid,p_name text,p_bytes integer,p_content_type text,p_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; f public.order_files; max_files integer; file_id uuid:=gen_random_uuid();
begin
 select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 select * into f from public.order_files where order_id=o.id and upload_id=p_upload_id;
 if found then
  if f.original_name<>p_name or f.byte_count<>p_bytes or f.content_type<>p_content_type or f.sha256<>p_sha256 then raise exception 'upload mismatch'; end if;
  return to_jsonb(f);
 end if;
 select * into f from public.order_files where order_id=o.id and original_name=p_name and byte_count=p_bytes and content_type=p_content_type and sha256=p_sha256;
 if found then return to_jsonb(f); end if;
 if o.status<>'draft' then raise exception 'intake immutable'; end if;
 select s.max_files into max_files from public.service_catalog s where s.id=o.service_id;
 if (select count(*) from public.order_files where order_id=o.id)>=max_files then raise exception 'file limit'; end if;
 insert into public.order_files(id,order_id,upload_id,object_path,original_name,byte_count,content_type,sha256)
 values(file_id,o.id,p_upload_id,p_user_id||'/'||o.id||'/'||file_id,p_name,p_bytes,p_content_type,p_sha256) returning * into f;
 return to_jsonb(f);
end; $$;
create function public.confirm_file(p_user_id uuid,p_order_id uuid,p_file_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.orders where id=p_order_id and user_id=p_user_id for update;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 update public.order_files set state='uploaded' where id=p_file_id and order_id=p_order_id;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
end; $$;
create function public.complete_intake(p_user_id uuid,p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 if o.intake_completed_at is not null then return public.order_view(p_user_id,o.id); end if;
 if o.status<>'draft' or not exists(select 1 from public.order_files where order_id=o.id and state='uploaded') or exists(select 1 from public.order_files where order_id=o.id and state='pending') then raise exception 'files incomplete'; end if;
 update public.orders set intake_completed_at=now(),status='awaiting_payment' where id=o.id;
 return public.order_view(p_user_id,o.id);
end; $$;

create function public.reserve_checkout(p_user_id uuid,p_order_id uuid,p_price_ids jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; a public.checkout_attempts;
begin
 select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 if o.status<>'awaiting_payment' or o.intake_completed_at is null then raise exception 'not payable'; end if;
 select * into a from public.checkout_attempts where order_id=o.id and state in ('reserved','open','review') for update;
 if not found then insert into public.checkout_attempts(order_id,stripe_price_id) values(o.id,p_price_ids->>o.service_id) returning * into a;
 elsif a.stripe_session_id is null and a.created_at<now()-interval '23 hours' then
  update public.checkout_attempts set state='review' where id=a.id returning * into a;
 end if;
 return to_jsonb(a)||jsonb_build_object('service_id',o.service_id,'amount_cents',o.amount_cents,'client_email',o.client_email);
end; $$;
create function public.attach_checkout(p_attempt_id uuid,p_session_id text,p_url text,p_expires_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare a public.checkout_attempts;
begin
 select * into a from public.checkout_attempts where id=p_attempt_id for update;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 if a.stripe_session_id is not null and a.stripe_session_id<>p_session_id then raise exception 'session mismatch'; end if;
 if a.state in ('expired','review') then raise exception 'attempt closed'; end if;
 update public.checkout_attempts set stripe_session_id=p_session_id,checkout_url=p_url,expires_at=p_expires_at,state=case when state='paid' then 'paid' else 'open' end where id=a.id;
end; $$;
create function public.expire_checkout(p_attempt_id uuid,p_session_id text) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.checkout_attempts set state='expired' where id=p_attempt_id and stripe_session_id=p_session_id and state='open';
end; $$;

create function public.audit_due_date(p_start timestamptz) returns date
language plpgsql immutable set search_path='' as $$
declare d date:=(p_start at time zone 'America/New_York')::date; n integer:=0;
begin
 while n<5 loop
  d:=d+1;
  if extract(isodow from d)<6 then n:=n+1; end if;
 end loop;
 return d;
end; $$;

create function public.record_payment(p_event_id text,p_event_type text,p_attempt_id uuid,p_order_id uuid,p_session_id text,p_payment_intent text,p_price_id text,p_amount integer,p_currency text,p_paid_at timestamptz,p_alert_email text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.checkout_attempts; o public.orders; first_payment boolean;
begin
 select * into o from public.orders where id=p_order_id for update;
 if not found then raise exception 'order missing'; end if;
 select * into a from public.checkout_attempts where id=p_attempt_id and order_id=o.id for update;
 if not found or (a.stripe_session_id is not null and a.stripe_session_id<>p_session_id) or (a.stripe_payment_intent is not null and a.stripe_payment_intent<>p_payment_intent) then raise exception 'payment binding mismatch'; end if;
 if a.stripe_price_id<>p_price_id then raise exception 'payment price mismatch'; end if;
 if o.amount_cents<>p_amount or o.currency<>p_currency or o.intake_completed_at is null then raise exception 'payment amount mismatch'; end if;
 insert into public.stripe_events(id,event_type,attempt_id) values(p_event_id,p_event_type,a.id) on conflict do nothing;
 if not found then return; end if;
 first_payment:=o.paid_at is null;
 update public.checkout_attempts set state='paid',stripe_session_id=p_session_id,stripe_payment_intent=p_payment_intent where id=a.id;
 if exists(select 1 from public.checkout_attempts where order_id=o.id and state='paid' and id<>a.id) then
  update public.orders set status='payment_review' where id=o.id;
  insert into public.notification_outbox(dedupe_key,kind,recipient,payload) values('duplicate-payment:'||o.id,'payment_review_alert',p_alert_email,jsonb_build_object('orderId',o.id,'reason','Multiple paid checkout attempts')) on conflict do nothing;
  return;
 end if;
 update public.orders set paid_at=coalesce(paid_at,p_paid_at),status=case when status in ('refunded','payment_review') then status else 'paid' end,
 due_date=case when service_id='ai-audit' and status not in ('refunded','payment_review') then public.audit_due_date(greatest(coalesce(paid_at,p_paid_at),intake_completed_at)) else due_date end where id=o.id;
 if first_payment and o.status not in ('refunded','payment_review') then
  insert into public.notification_outbox(dedupe_key,kind,recipient,payload)
  select 'paid-client:'||id,'paid_client',client_email,jsonb_build_object('orderId',id,'service',service_id,'dueDate',due_date) from public.orders where id=o.id on conflict do nothing;
  insert into public.notification_outbox(dedupe_key,kind,recipient,payload) values('paid-alert:'||o.id,'paid_alert',p_alert_email,jsonb_build_object('orderId',o.id,'service',o.service_id,'amountCents',o.amount_cents)) on conflict do nothing;
 end if;
end; $$;

create function public.record_payment_issue(p_event_id text,p_event_type text,p_attempt_id uuid,p_order_id uuid,p_payment_intent text,p_fully_refunded boolean,p_alert_email text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.checkout_attempts;
begin
 perform 1 from public.orders where id=p_order_id for update;
 if not found then raise exception 'order missing'; end if;
 select * into a from public.checkout_attempts where id=p_attempt_id and order_id=p_order_id for update;
 if not found or (a.stripe_payment_intent is not null and a.stripe_payment_intent<>p_payment_intent) then raise exception 'payment binding mismatch'; end if;
 insert into public.stripe_events(id,event_type,attempt_id) values(p_event_id,p_event_type,a.id) on conflict do nothing;
 if not found then return; end if;
 update public.checkout_attempts set stripe_payment_intent=p_payment_intent where id=a.id;
 update public.orders set status=case when p_fully_refunded then 'refunded' else 'payment_review' end,due_date=null where id=p_order_id;
 update public.notification_outbox set state='manual_review' where dedupe_key in ('paid-client:'||p_order_id,'paid-alert:'||p_order_id) and state='pending';
 insert into public.notification_outbox(dedupe_key,kind,recipient,payload) values('payment-issue:'||p_event_id,'payment_review_alert',p_alert_email,jsonb_build_object('orderId',p_order_id,'reason',p_event_type)) on conflict do nothing;
end; $$;

create function public.create_lead(p_request_id uuid,p_actor_hash text,p_name text,p_email text,p_message text,p_service_id text,p_alert_email text) returns void
language plpgsql security definer set search_path='' as $$
declare l public.leads;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_actor_hash,0));
 select * into l from public.leads where request_id=p_request_id;
 if found then
  if l.actor_hash<>p_actor_hash or l.name<>p_name or l.email<>p_email or l.message<>p_message or l.service_id is distinct from p_service_id then raise exception 'lead mismatch'; end if;
  return;
 end if;
 if (select count(*) from public.leads where actor_hash=p_actor_hash and created_at>now()-interval '1 hour')>=5 then raise exception 'lead limit'; end if;
 insert into public.leads(request_id,actor_hash,name,email,message,service_id) values(p_request_id,p_actor_hash,p_name,p_email,p_message,p_service_id) returning * into l;
 insert into public.notification_outbox(dedupe_key,kind,recipient,payload) values('lead:'||l.id,'lead_alert',p_alert_email,jsonb_build_object('name',p_name,'email',p_email,'message',p_message,'service',p_service_id));
end; $$;

create function public.claim_notifications(p_limit integer) returns setof public.notification_outbox
language plpgsql security definer set search_path='' as $$
begin
 update public.notification_outbox set state='manual_review',claim_token=null,claimed_until=null
 where state in ('pending','processing') and first_attempt_at<now()-interval '23 hours' and (claimed_until is null or claimed_until<now());
 return query with candidates as (
  select id from public.notification_outbox where (state='pending' and next_attempt_at<=now()) or (state='processing' and claimed_until<now()) order by created_at for update skip locked limit least(greatest(p_limit,1),25)
 ) update public.notification_outbox n set state='processing',attempts=attempts+1,claim_token=gen_random_uuid(),claimed_until=now()+interval '5 minutes',first_attempt_at=coalesce(first_attempt_at,now())
 from candidates c where n.id=c.id returning n.*;
end; $$;
create function public.finish_notification(p_id uuid,p_claim_token uuid,p_outcome text,p_provider_id text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_outcome not in ('sent','retry','manual_review') then raise exception 'invalid outcome'; end if;
 update public.notification_outbox set state=case when p_outcome='retry' then 'pending' else p_outcome end,
 provider_id=coalesce(p_provider_id,provider_id),sent_at=case when p_outcome='sent' then now() else null end,
 next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,least(attempts,6)))::double precision),claim_token=null,claimed_until=null
 where id=p_id and claim_token=p_claim_token and state='processing' and claimed_until>now();
end; $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('order_view','create_order','reserve_file','confirm_file','complete_intake','reserve_checkout','attach_checkout','expire_checkout','record_payment','record_payment_issue','create_lead','claim_notifications','finish_notification','audit_due_date') loop
 execute format('revoke all on function %s from public, anon, authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
revoke all on function public.is_staging_tester() from public,anon;
grant execute on function public.is_staging_tester() to authenticated,service_role;

commit;
