-- CornerOps One v0.2.1 — Demo Workspace isolation at the database
--
-- * Shared demo identities are registered by the server (system connection)
--   and can never hold a membership in, be invited to, or create a
--   non-demo organization.
-- * Client roles cannot add, change or remove memberships of a demo
--   organization, nor change any demo organization's identity.
-- * `organizations.is_demo` is system-controlled: client roles can only
--   update name / legal_name, and a trigger refuses is_demo changes.
-- * The demo simulation feed is read through a narrow function instead of a
--   privileged nested transaction.

begin;

create table public.demo_identities (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
comment on table public.demo_identities is 'Shared demo sign-in identities; maintained only by the server.';
alter table public.demo_identities enable row level security;
alter table public.demo_identities force row level security;
revoke all on public.demo_identities from authenticated, anon;

create or replace function private.is_demo_identity(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user is not null and exists (select 1 from public.demo_identities d where d.user_id = p_user)
$$;

create or replace function private.is_demo_email(p_email text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_email is not null and exists (
    select 1 from public.demo_identities d join auth.users u on u.id = d.user_id where lower(u.email) = lower(btrim(p_email)))
$$;

create or replace function private.is_demo_org(p_org text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select o.is_demo from public.organizations o where o.id = p_org), false)
$$;

-- Memberships ------------------------------------------------------------------
create or replace function private.guard_membership_isolation()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_row public.organization_memberships := case when tg_op = 'DELETE' then old else new end;
  v_demo boolean := private.is_demo_org(v_row.organization_id);
begin
  if v_demo and current_user in ('authenticated', 'anon') and pg_trigger_depth() <= 1 then
    raise exception 'Demo Workspace membership is managed by the system' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' or v_demo then
    return v_row;
  end if;
  if private.is_demo_identity(new.user_id) then
    raise exception 'demo identities cannot join production organizations' using errcode = '42501';
  end if;
  if new.user_id is null and private.is_demo_email(new.invited_email) then
    raise exception 'demo identities cannot be invited to production organizations' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger organization_memberships_demo_isolation
  before insert or update or delete on public.organization_memberships
  for each row execute function private.guard_membership_isolation();

create or replace function private.guard_membership_locations_demo()
returns trigger
language plpgsql set search_path = ''
as $$
declare v_org text := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
begin
  if current_user in ('authenticated', 'anon') and pg_trigger_depth() <= 1 and private.is_demo_org(v_org) then
    raise exception 'Demo Workspace membership is managed by the system' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger membership_locations_demo_isolation
  before insert or update or delete on public.membership_locations
  for each row execute function private.guard_membership_locations_demo();

-- Organizations ------------------------------------------------------------------
revoke insert, update, delete on public.organizations from authenticated, anon;
grant update (name, legal_name) on public.organizations to authenticated;

create or replace function private.guard_organization_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.is_demo is distinct from old.is_demo or new.id is distinct from old.id or new.slug is distinct from old.slug then
      raise exception 'organization identity is system-controlled' using errcode = '42501';
    end if;
    if old.is_demo then
      raise exception 'the Demo Workspace organization cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger organizations_guard_identity
  before update on public.organizations
  for each row execute function private.guard_organization_update();

-- Onboarding and invitations refuse demo identities ----------------------------
create or replace function public.create_organization(p_name text, p_slug text, p_timezone text, p_currency text, p_settings jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_org text := 'org_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if private.is_demo_identity(auth.uid()) then
    raise exception 'the shared demo identity cannot create organizations' using errcode = 'insufficient_privilege';
  end if;
  insert into public.organizations (id, name, slug, timezone, currency, is_demo) values (v_org, p_name, p_slug, p_timezone, p_currency, false);
  insert into public.restaurants (id, organization_id, name) values ('rst_' || substr(v_org, 5), v_org, p_name);
  insert into public.organization_memberships (organization_id, user_id, role, status) values (v_org, auth.uid(), 'OWNER', 'active');
  insert into public.organization_settings (organization_id, sla, economics, demo) values (v_org, p_settings -> 'sla', p_settings -> 'economics', p_settings -> 'demo');
  insert into public.organization_counters (organization_id) values (v_org);
  insert into public.audit_logs (organization_id, actor_user_id, actor_label, action, entity_type, entity_id, after_data)
  values (v_org, auth.uid(), 'user', 'organization.created', 'organization', v_org, jsonb_build_object('name', p_name));
  return v_org;
end;
$$;

create or replace function public.claim_pending_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if auth.uid() is null or private.is_demo_identity(auth.uid()) then
    return 0;
  end if;
  update public.organization_memberships m
     set user_id = auth.uid(), status = 'active', updated_at = now()
   where m.user_id is null
     and m.status = 'invited'
     and lower(m.invited_email) = (select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)
     and not exists (select 1 from public.organization_memberships x where x.organization_id = m.organization_id and x.user_id = auth.uid());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Demo simulation feed (read-only, members of the demo organization only) ---
create or replace function public.demo_feed(p_org text, p_limit integer default 25)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(e order by ord desc)
    from (
      select e, ord from jsonb_array_elements(d.events) with ordinality as x(e, ord)
      order by ord desc limit greatest(0, least(p_limit, 100))
    ) t
  ), '[]'::jsonb)
  from public.demo_workspace_state d
  join public.organizations o on o.id = d.organization_id and o.is_demo
  where d.organization_id = p_org
    and (private.is_system_caller() or p_org in (select private.member_org_ids()))
$$;

revoke all on function private.is_demo_identity(uuid), private.is_demo_email(text), private.is_demo_org(text),
  private.guard_membership_isolation(), private.guard_membership_locations_demo(), private.guard_organization_update(),
  public.create_organization(text, text, text, text, jsonb), public.claim_pending_invitations(), public.demo_feed(text, integer)
  from public, anon;
grant execute on function public.create_organization(text, text, text, text, jsonb), public.claim_pending_invitations(),
  public.demo_feed(text, integer) to authenticated;
-- Evaluated by the (invoker) guard triggers when a client writes memberships.
grant execute on function private.is_demo_identity(uuid), private.is_demo_email(text), private.is_demo_org(text) to authenticated;

commit;
