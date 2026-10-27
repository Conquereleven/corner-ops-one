-- CornerOps One v0.2.1 acceptance — legacy demo access
--
-- Finding (Codex audit 2): a database upgraded from v0.2.0 can contain a
-- production membership (e.g. OWNER via onboarding) held by the shared demo
-- identity. The v0.2.1 guards only fire on new writes, and the RLS helpers
-- trusted every 'active' membership row, so registering the identity did not
-- remove that access.
--
-- Fix, in depth:
-- 1. Effective membership: a registered demo identity's memberships count only
--    in demo organizations — regardless of what rows exist. Every RLS helper
--    and authorization function derives from this one definition.
-- 2. Quarantine: registering a demo identity (and this migration, for already
--    registered ones) disables its non-demo memberships and invitations and
--    records them in public.demo_identity_quarantine plus an audit entry, so
--    nothing is silently deleted and the founder can review ownerless orgs.
-- 3. Disabling such a membership is the only change the isolation guard allows.

begin;

-- 1. Effective memberships ------------------------------------------------------
create or replace function private.effective_memberships()
returns table (id uuid, organization_id text, role text)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.organization_id, m.role
  from public.organization_memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and (o.is_demo or not exists (select 1 from public.demo_identities d where d.user_id = m.user_id))
$$;

create or replace function private.member_org_ids()
returns setof text
language sql stable security definer set search_path = ''
as $$
  select e.organization_id from private.effective_memberships() e
$$;

create or replace function private.org_ids_with_role(p_roles text[])
returns setof text
language sql stable security definer set search_path = ''
as $$
  select e.organization_id from private.effective_memberships() e where e.role = any (p_roles)
$$;

create or replace function private.accessible_location_ids()
returns setof text
language sql stable security definer set search_path = ''
as $$
  select l.id
  from private.effective_memberships() e
  join public.locations l on l.organization_id = e.organization_id
  where e.role in ('OWNER', 'ADMIN', 'OPERATIONS_MANAGER')
     or exists (select 1 from public.membership_locations ml where ml.membership_id = e.id and ml.location_id = l.id)
$$;

create or replace function private.colleague_user_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select distinct other.user_id
  from private.effective_memberships() mine
  join public.organization_memberships other on other.organization_id = mine.organization_id
  where other.user_id is not null
$$;

create or replace function private.member_role(p_org text)
returns text
language sql stable security definer set search_path = ''
as $$
  select e.role from private.effective_memberships() e where e.organization_id = p_org
$$;

-- 2. Quarantine -------------------------------------------------------------------
create table public.demo_identity_quarantine (
  id               uuid primary key default gen_random_uuid(),
  membership_id    uuid not null references public.organization_memberships (id) on delete cascade,
  organization_id  text not null references public.organizations (id) on delete cascade,
  user_id          uuid references auth.users (id) on delete cascade,
  invited_email    text,
  role             text not null,
  previous_status  text not null,
  quarantined_at   timestamptz not null default now(),
  constraint demo_identity_quarantine_once unique (membership_id)
);
comment on table public.demo_identity_quarantine is
  'Production memberships/invitations of shared demo identities, disabled on registration. Review manually (an organization may have lost its only owner).';
alter table public.demo_identity_quarantine enable row level security;
alter table public.demo_identity_quarantine force row level security;
revoke all on public.demo_identity_quarantine from authenticated, anon;

create or replace function private.quarantine_demo_identity(p_user uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select m.* from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id and not o.is_demo
    where m.status <> 'disabled'
      and (m.user_id = p_user
           or (m.user_id is null and lower(m.invited_email) = (select lower(u.email) from auth.users u where u.id = p_user)))
    for update of m
  loop
    insert into public.demo_identity_quarantine (membership_id, organization_id, user_id, invited_email, role, previous_status)
    values (r.id, r.organization_id, r.user_id, r.invited_email, r.role, r.status)
    on conflict (membership_id) do nothing;
    update public.organization_memberships set status = 'disabled', updated_at = now() where id = r.id;
    insert into public.audit_logs (organization_id, actor_user_id, actor_label, action, entity_type, entity_id, before_data, after_data, metadata)
    values (r.organization_id, null, 'system', 'membership.quarantined', 'membership', r.id::text,
            jsonb_build_object('role', r.role, 'status', r.status), jsonb_build_object('role', r.role, 'status', 'disabled'),
            jsonb_build_object('reason', 'shared demo identity', 'userId', r.user_id, 'invitedEmail', r.invited_email));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function private.on_demo_identity_registered()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.quarantine_demo_identity(new.user_id);
  return new;
end;
$$;

create trigger demo_identities_quarantine
  after insert on public.demo_identities
  for each row execute function private.on_demo_identity_registered();

-- 3. The isolation guard lets a demo identity's production membership be disabled, nothing else.
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
  -- De-escalation only: disabling, with identity, organization and role unchanged.
  if tg_op = 'UPDATE' and new.status = 'disabled'
     and new.user_id is not distinct from old.user_id and new.invited_email is not distinct from old.invited_email
     and new.organization_id = old.organization_id and new.role = old.role then
    return new;
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

-- Identities registered before this migration.
select private.quarantine_demo_identity(d.user_id) from public.demo_identities d;

revoke all on function private.effective_memberships(), private.quarantine_demo_identity(uuid), private.on_demo_identity_registered()
  from public, anon, authenticated;
-- Helpers evaluated by RLS policies as the client role.
grant execute on function private.member_org_ids(), private.org_ids_with_role(text[]), private.accessible_location_ids(),
  private.colleague_user_ids(), private.can_access_location(text) to authenticated;

commit;
