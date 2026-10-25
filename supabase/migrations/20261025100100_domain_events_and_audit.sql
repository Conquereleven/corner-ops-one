-- CornerOps One v0.2 — domain event outbox and audit log
--
-- Both tables are written in the SAME transaction as the business change that
-- produced them (transactional outbox), so an event or audit entry exists if
-- and only if the change committed.

begin;

create table public.domain_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  text not null references public.organizations (id) on delete cascade,
  location_id      text references public.locations (id) on delete set null,
  type             text not null check (type ~ '^[a-z_]+\.[a-z_]+$'),
  aggregate_type   text not null,
  aggregate_id     text not null,
  payload          jsonb not null default '{}'::jsonb,
  actor_user_id    uuid references auth.users (id) on delete set null,
  actor_label      text,                         -- 'user', 'simulator', 'system', 'channel:<id>'
  created_at       timestamptz not null default now(),
  -- outbox processing (webhooks, notifications, automation) — consumers set these
  processed_at     timestamptz,
  attempts         integer not null default 0,
  last_error       text
);

create index domain_events_org_created_idx on public.domain_events (organization_id, created_at desc);
create index domain_events_unprocessed_idx on public.domain_events (created_at) where processed_at is null;
create index domain_events_aggregate_idx on public.domain_events (aggregate_type, aggregate_id, created_at);

comment on table public.domain_events is
  'Transactional outbox of domain events (order.accepted, inventory.low, ...). Rows are immutable except outbox processing columns.';

create table public.audit_logs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  text not null references public.organizations (id) on delete cascade,
  location_id      text references public.locations (id) on delete set null,
  actor_user_id    uuid references auth.users (id) on delete set null,
  actor_label      text,
  action           text not null,                -- e.g. order.status_changed, inventory.adjusted, membership.role_changed
  entity_type      text not null,
  entity_id        text not null,
  before_data      jsonb,
  after_data       jsonb,
  metadata         jsonb not null default '{}'::jsonb,   -- never secrets
  created_at       timestamptz not null default now()
);

create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

comment on table public.audit_logs is 'Append-only record of who changed what, when, where, from what, to what.';

-- Audit rows are append-only. Deletion is only possible inside an explicit
-- demo-workspace purge (session flag set by the reset routine) or when the
-- whole organization is deleted.
create or replace function public.protect_audit_logs()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'audit_logs are append-only' using errcode = 'insufficient_privilege';
  end if;
  -- pg_trigger_depth() > 1: invoked by an ON DELETE CASCADE from organizations.
  if coalesce(current_setting('cornerops.allow_audit_purge', true), '') <> 'on' and pg_trigger_depth() <= 1 then
    raise exception 'audit_logs cannot be deleted' using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.protect_audit_logs();

-- Events: payload/type are immutable; only outbox processing columns may change.
create or replace function public.protect_domain_events()
returns trigger
language plpgsql
as $$
begin
  if new.type is distinct from old.type
     or new.payload is distinct from old.payload
     or new.organization_id is distinct from old.organization_id
     or new.aggregate_id is distinct from old.aggregate_id
     or new.created_at is distinct from old.created_at then
    raise exception 'domain_events are immutable (only processing columns may change)' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger domain_events_immutable
  before update on public.domain_events
  for each row execute function public.protect_domain_events();

commit;
