"use client";

import { MapPin } from "lucide-react";
import { useState } from "react";
import { Panel } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateLocation, useLocations, useUpdateLocation } from "@/hooks/queries";
import { useCan } from "@/hooks/use-session";

export function LocationsPanel() {
  const { data } = useLocations();
  const canManage = useCan("locations.manage");
  const canManageOrg = useCan("organization.manage");
  const canManageTeam = useCan("team.manage");
  const canCreate = canManageOrg || canManageTeam;
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-4 text-muted-foreground" /> Locations
        </span>
      }
      description="Branches in this organization (operating hours and manager)."
      bodyClassName="p-0"
    >
      <ul className="divide-y">
        {data?.map((l) => (
          <LocationRow key={l.id} id={l.id} name={l.name} code={l.code} open={l.operatingHours.open} close={l.operatingHours.close} manager={l.managerName} canManage={canManage} />
        ))}
      </ul>
      {canManage && canCreate ? <AddLocation /> : null}
    </Panel>
  );
}

function LocationRow({ id, name, code, open, close, manager, canManage }: { id: string; name: string; code: string; open: string; close: string; manager: string; canManage: boolean }) {
  const update = useUpdateLocation();
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState({ open, close });
  const [mgr, setMgr] = useState(manager);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
      <span className="w-10 font-mono text-[11px] text-muted-foreground">{code}</span>
      <span className="min-w-28 flex-1 font-medium">{name}</span>
      {editing ? (
        <>
          <Input className="h-7 w-20" value={hours.open} onChange={(e) => setHours({ ...hours, open: e.target.value })} aria-label="Opens" />
          <Input className="h-7 w-20" value={hours.close} onChange={(e) => setHours({ ...hours, close: e.target.value })} aria-label="Closes" />
          <Input className="h-7 w-36" value={mgr} onChange={(e) => setMgr(e.target.value)} aria-label="Manager" />
          <Button size="xs" onClick={() => update.mutate({ id, patch: { operatingHours: hours, managerName: mgr } }, { onSuccess: () => setEditing(false) })}>
            Save
          </Button>
        </>
      ) : (
        <>
          <span className="text-xs text-muted-foreground">
            {open}–{close} · {manager || "No manager"}
          </span>
          {canManage ? (
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
        </>
      )}
    </li>
  );
}

function AddLocation() {
  const create = useCreateLocation();
  const [form, setForm] = useState({ name: "", code: "", area: "" });
  return (
    <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
      <Input className="h-8 w-40" placeholder="Location name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <Input className="h-8 w-20" placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
      <Input className="h-8 w-36" placeholder="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
      <Button size="sm" disabled={form.name.length < 2 || form.code.length < 2 || create.isPending} onClick={() => create.mutate(form)}>
        Add location
      </Button>
    </div>
  );
}
