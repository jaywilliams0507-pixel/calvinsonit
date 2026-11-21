begin;

-- Only an owner/operator using the staging service connection may provision admins.
create table public.staging_admins (user_id uuid primary key references public.staging_testers(user_id) on delete cascade);
alter table public.staging_admins enable row level security;
revoke all on public.staging_admins from public,anon,authenticated;
grant all on public.staging_admins to service_role;
alter table public.orders add column fulfilment_status text not null default 'pending' check(fulfilment_status in ('pending','ready'));
create table public.order_reports (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),
 upload_id uuid not null,uploaded_by uuid not null references auth.users(id),
 object_path text not null unique,original_name text not null check(length(original_name) between 1 and 180),
 byte_count integer not null check(byte_count between 1 and 10485760),
 content_type text not null check(content_type in ('application/pdf','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip')),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),state text not null default 'pending' check(state in ('pending','uploaded')),
 created_at timestamptz not null default now(),unique(order_id,upload_id)
);
create table public.order_messages (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),
 sender_id uuid not null references public.staging_testers(user_id),sender_role text not null check(sender_role in ('client','admin')),
 request_id uuid not null,body text not null check(length(btrim(body)) between 1 and 3000),
 created_at timestamptz not null default now(),unique(order_id,sender_id,request_id)
);
create index messages_order on public.order_messages(order_id,created_at);
create index messages_sender on public.order_messages(sender_id,created_at);
alter table public.order_reports enable row level security;
alter table public.order_messages enable row level security;
-- All fulfilment access goes through the authenticated Worker. No direct browser grants or Storage policies.
revoke all on public.order_reports,public.order_messages from public,anon,authenticated;
grant all on public.order_reports,public.order_messages to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('order-reports','order-reports',false,10485760,array['application/pdf','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip']);
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check(kind in
 ('lead_alert','intake_alert','paid_client','paid_alert','payment_review_alert','report_ready','order_message_client','order_message_admin'));

create function public.require_staging_admin(p_actor_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.staging_admins a join public.staging_testers t on t.user_id=a.user_id where a.user_id=p_actor_id)
 then raise exception 'admin required' using errcode='42501'; end if;
end; $$;
create function public.require_order_access(p_actor_id uuid,p_order_id uuid,p_admin boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_admin then perform public.require_staging_admin(p_actor_id); end if;
 if not exists(select 1 from public.staging_testers where user_id=p_actor_id) or
 not exists(select 1 from public.orders where id=p_order_id and (p_admin or user_id=p_actor_id))
 then raise exception 'not found' using errcode='P0002'; end if;
end; $$;

create function public.order_workspace(p_actor_id uuid,p_order_id uuid,p_admin boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; payment text;
begin
 perform public.require_order_access(p_actor_id,p_order_id,p_admin);
 select * into o from public.orders where id=p_order_id;
 if p_admin then select stripe_payment_intent into payment from public.checkout_attempts where order_id=o.id and stripe_payment_intent is not null order by created_at desc limit 1; end if;
 return jsonb_build_object('order',public.order_view(o.user_id,o.id),'fulfilmentStatus',o.fulfilment_status,
 'intake',case when p_admin then o.intake else null end,'clientEmail',case when p_admin then o.client_email else null end,
 'paymentIntent',payment,
 'reports',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',original_name,'bytes',byte_count) order by created_at,id) from public.order_reports where order_id=o.id and state='uploaded'),'[]'::jsonb),
 'messages',coalesce((select jsonb_agg(jsonb_build_object('id',id,'senderRole',sender_role,'body',body,'createdAt',created_at) order by created_at,id) from public.order_messages where order_id=o.id),'[]'::jsonb));
end; $$;
create function public.admin_orders(p_actor_id uuid,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.require_staging_admin(p_actor_id);
 if p_offset<0 then raise exception 'invalid offset'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by r."createdAt" desc,r.id) from
 (select id,service_id as "serviceId",status,fulfilment_status as "fulfilmentStatus",due_date as "dueDate",client_email as "clientEmail",created_at as "createdAt"
 from public.orders order by created_at desc,id limit 50 offset p_offset) r),'[]'::jsonb);
end; $$;
create function public.reserve_report(p_actor_id uuid,p_order_id uuid,p_upload_id uuid,p_name text,p_bytes integer,p_content_type text,p_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; f public.order_reports; file_id uuid:=gen_random_uuid();
begin
 perform public.require_staging_admin(p_actor_id);
 select * into o from public.orders where id=p_order_id for update;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 if o.status<>'paid' then raise exception 'verified payment required'; end if;
 if p_name ~ '[[:cntrl:]/\\]' then raise exception 'invalid file name'; end if;
 select * into f from public.order_reports where order_id=o.id and upload_id=p_upload_id;
 if found then
  if f.original_name<>p_name or f.byte_count<>p_bytes or f.content_type<>p_content_type or f.sha256<>p_sha256 or f.uploaded_by<>p_actor_id then raise exception 'upload mismatch'; end if;
  return to_jsonb(f);
 end if;
 select * into f from public.order_reports where order_id=o.id and uploaded_by=p_actor_id and original_name=p_name and byte_count=p_bytes and content_type=p_content_type and sha256=p_sha256;
 if found then return to_jsonb(f); end if;
 if (select count(*) from public.order_reports where order_id=o.id)>=20 then raise exception 'report limit'; end if;
 insert into public.order_reports(id,order_id,upload_id,uploaded_by,object_path,original_name,byte_count,content_type,sha256)
 values(file_id,o.id,p_upload_id,p_actor_id,o.id||'/'||file_id,p_name,p_bytes,p_content_type,p_sha256) returning * into f;
 return to_jsonb(f);
end; $$;
create function public.confirm_report(p_actor_id uuid,p_order_id uuid,p_file_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; f public.order_reports;
begin
 perform public.require_staging_admin(p_actor_id);
 select * into o from public.orders where id=p_order_id for update;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 if o.status<>'paid' then raise exception 'verified payment required'; end if;
 update public.order_reports set state='uploaded' where id=p_file_id and order_id=o.id and uploaded_by=p_actor_id returning * into f;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 update public.orders set fulfilment_status='ready' where id=o.id;
 insert into public.notification_outbox(dedupe_key,kind,recipient,payload)
 values('report-ready:'||f.id,'report_ready',o.client_email,jsonb_build_object('orderId',o.id,'reportId',f.id)) on conflict do nothing;
end; $$;
create function public.send_order_message(p_actor_id uuid,p_order_id uuid,p_admin boolean,p_request_id uuid,p_body text,p_alert_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; m public.order_messages;
begin
 perform public.require_order_access(p_actor_id,p_order_id,p_admin);
 -- Serializes the per-sender limit across different orders, as well as retries.
 perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text,1));
 select * into o from public.orders where id=p_order_id for update;
 select * into m from public.order_messages where order_id=o.id and sender_id=p_actor_id and request_id=p_request_id;
 if found then
  if m.body<>p_body or m.sender_role<>(case when p_admin then 'admin' else 'client' end) then raise exception 'message mismatch'; end if;
 else
  if (select count(*) from public.order_messages where sender_id=p_actor_id and created_at>now()-interval '1 hour')>=20 then raise exception 'message limit'; end if;
  insert into public.order_messages(order_id,sender_id,sender_role,request_id,body)
  values(o.id,p_actor_id,case when p_admin then 'admin' else 'client' end,p_request_id,p_body) returning * into m;
  insert into public.notification_outbox(dedupe_key,kind,recipient,payload)
  values('order-message:'||m.id,case when p_admin then 'order_message_client' else 'order_message_admin' end,
  case when p_admin then o.client_email else p_alert_email end,jsonb_build_object('orderId',o.id,'messageId',m.id));
 end if;
 return jsonb_build_object('id',m.id);
end; $$;

create or replace function public.reserve_checkout(p_user_id uuid,p_order_id uuid,p_price_ids jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; a public.checkout_attempts;
begin
 select * into o from public.orders where id=p_order_id and user_id=p_user_id for update;
 if not found then raise exception 'not found' using errcode='P0002'; end if;
 if o.service_id='catalog-hosted' then raise exception 'Hosted is not available for purchase'; end if;
 if o.status<>'awaiting_payment' or o.intake_completed_at is null then raise exception 'not payable'; end if;
 select * into a from public.checkout_attempts where order_id=o.id and state in ('reserved','open','review') for update;
 if not found then insert into public.checkout_attempts(order_id,stripe_price_id) values(o.id,p_price_ids->>o.service_id) returning * into a;
 elsif a.stripe_session_id is null and a.created_at<now()-interval '23 hours' then
  update public.checkout_attempts set state='review' where id=a.id returning * into a;
 end if;
 return to_jsonb(a)||jsonb_build_object('service_id',o.service_id,'amount_cents',o.amount_cents,'client_email',o.client_email);
end; $$;

-- Hosted is displayed but unavailable even to crafted or legacy checkout attempts.
create function public.block_hosted_order() returns trigger language plpgsql set search_path='' as $$
begin
 if new.service_id='catalog-hosted' then raise exception 'Hosted is not available for purchase'; end if;
 return new;
end; $$;
create trigger block_hosted_order before insert on public.orders for each row execute function public.block_hosted_order();
create function public.block_hosted_checkout() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.orders where id=new.order_id and service_id='catalog-hosted') then raise exception 'Hosted is not available for purchase'; end if;
 return new;
end; $$;
create trigger block_hosted_checkout before insert or update on public.checkout_attempts for each row execute function public.block_hosted_checkout();

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('require_staging_admin','require_order_access','order_workspace','admin_orders','reserve_report','confirm_report','send_order_message','block_hosted_order','block_hosted_checkout') loop
 execute format('revoke all on function %s from public, anon, authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
