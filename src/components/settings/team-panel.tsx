"use client";

import { UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Panel } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isLocationRestricted, ROLE_LABEL, type Role } from "@/domain/auth/permissions";
import { useInviteMember, useTeam, useUpdateMember } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import type { TeamData } from "@/server/services/team";

type Member = TeamData["members"][number];

export function TeamPanel() {
  const { data, isLoading } = useTeam();
  return (
    <Panel
      className="xl:col-span-2"
      title={
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-4 text-muted-foreground" /> Team & roles
        </span>
      }
      description="Members, roles and location access. Owners and admins manage the team."
      bodyClassName="p-0"
    >
      {isLoading || !data ? (
        <p className="p-4 text-sm text-muted-foreground">Loading team…</p>
      ) : (
        <>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Member</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Locations</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.members.map((m) => (
                  <MemberRow key={m.id} member={m} data={data} />
                ))}
              </tbody>
            </table>
          </div>
          {data.canManage ? <InviteForm data={data} /> : null}
        </>
      )}
    </Panel>
  );
}

function LocationPicker({ all, value, onChange }: { all: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {all.map((l) => {
        const on = value.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== l.id) : [...value, l.id])}
            className={cn("rounded-md border px-2 py-0.5 text-xs", on ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
          >
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

function MemberRow({ member: m, data }: { member: Member; data: TeamData }) {
  const update = useUpdateMember();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<Role>(m.role);
  const [locations, setLocations] = useState<string[]>(m.locationIds);
  const self = m.id === data.currentMembershipId;
  const editable = data.canManage && !self && (m.role !== "OWNER" || data.assignableRoles.includes("OWNER"));
  const locName = (id: string) => data.locations.find((l) => l.id === id)?.name ?? id;

  return (
    <tr className={cn(m.status === "disabled" && "opacity-60")}>
      <td className="px-4 py-2">
        <div className="font-medium">{m.fullName ?? m.email}</div>
        <div className="text-xs text-muted-foreground">
          {m.email}
          {self ? " · you" : ""}
        </div>
      </td>
      <td className="px-3 py-2">
        {editing ? (
          <select className="h-7 rounded-md border bg-card px-1.5 text-xs" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {data.assignableRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        ) : (
          ROLE_LABEL[m.role]
        )}
      </td>
      <td className="max-w-72 px-3 py-2 text-xs">
        {editing && isLocationRestricted(role) ? (
          <LocationPicker all={data.locations} value={locations} onChange={setLocations} />
        ) : isLocationRestricted(m.role) ? (
          m.locationIds.map(locName).join(", ") || <span className="text-red-600">No locations</span>
        ) : (
          <span className="text-muted-foreground">All locations</span>
        )}
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
            m.status === "active" ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : m.status === "invited" ? "bg-blue-50 text-blue-700 ring-blue-600/20" : "bg-zinc-100 text-zinc-600 ring-zinc-500/20",
          )}
        >
          {m.status === "invited" ? "Invited" : m.status === "active" ? "Active" : "Disabled"}
        </span>
      </td>
      <td className="px-4 py-2 text-right">
        {editable ? (
          editing ? (
            <div className="flex justify-end gap-1">
              <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                size="xs"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: m.id, patch: { role, locationIds: isLocationRestricted(role) ? locations : [] } }, { onSuccess: () => setEditing(false) })}
              >
                Save
              </Button>
            </div>
          ) : (
            <div className="flex justify-end gap-1">
              <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
              {m.status !== "invited" ? (
                <Button size="xs" variant="ghost" onClick={() => update.mutate({ id: m.id, patch: { status: m.status === "active" ? "disabled" : "active" } })}>
                  {m.status === "active" ? "Disable" : "Enable"}
                </Button>
              ) : null}
            </div>
          )
        ) : null}
      </td>
    </tr>
  );
}

function InviteForm({ data }: { data: TeamData }) {
  const invite = useInviteMember();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("BRANCH_MANAGER");
  const [locations, setLocations] = useState<string[]>([]);
  const submit = () =>
    invite.mutate(
      { email, role, locationIds: isLocationRestricted(role) ? locations : [] },
      {
        onSuccess: () => {
          setEmail("");
          setLocations([]);
        },
      },
    );
  return (
    <div className="space-y-2 border-t px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <UserPlus className="size-3.5" /> Invite a teammate
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="email" placeholder="name@restaurant.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-8 w-64" />
        <select className="h-8 rounded-lg border bg-card px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {data.assignableRoles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={submit} disabled={!email.includes("@") || invite.isPending || (isLocationRestricted(role) && !locations.length)}>
          Create invitation
        </Button>
      </div>
      {isLocationRestricted(role) ? (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Locations this person can access</div>
          <LocationPicker all={data.locations} value={locations} onChange={setLocations} />
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        The invitation activates when this person signs up or signs in with the same verified email. Invitation emails are not sent automatically yet — share the
        sign-up link with them.
      </p>
    </div>
  );
}
