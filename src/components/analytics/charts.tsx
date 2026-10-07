"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { OrderChannel } from "@/domain/channels/types";
import { CHANNEL_HEX, CHANNEL_THEME } from "@/lib/channel-theme";
import { formatAED, formatCompactAED, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChannelMark } from "@/components/shared/channel-badge";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" } as const;
const PRIMARY = "#2a78d6";
const COMPARISON = "#a8a29e";

function ChartTooltip({
  active,
  payload,
  label,
  format,
}: Partial<TooltipContentProps<number, string>> & { format: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-foreground">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-medium tabular text-foreground">{format(Number(p.value ?? 0))}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items, className }: { items: { label: string; color: string; dashed?: boolean }[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded"
            style={i.dashed ? { backgroundImage: `linear-gradient(90deg, ${i.color} 50%, transparent 50%)`, backgroundSize: "6px 2px" } : { background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Current vs comparison period. Current is a filled area; comparison is a dashed line. */
export function TrendChart({
  data,
  currentLabel,
  previousLabel,
  valueKey = "revenue",
  previousKey = "previousRevenue",
  height = 240,
  format = formatAED,
  xKey = "key",
}: {
  data: Record<string, unknown>[];
  currentLabel: string;
  previousLabel?: string;
  valueKey?: string;
  previousKey?: string;
  height?: number;
  format?: (v: number) => string;
  xKey?: string;
}) {
  const hasPrev = !!previousLabel && data.some((d) => d[previousKey] !== undefined);
  return (
    <div>
      <Legend
        className="mb-2"
        items={[{ label: currentLabel, color: PRIMARY }, ...(hasPrev ? [{ label: previousLabel!, color: COMPARISON, dashed: true }] : [])]}
      />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.18} />
                <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
            <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => formatCompactAED(v).replace("AED ", "")} />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
              content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} format={format} />}
            />
            {hasPrev ? (
              <Line type="monotone" dataKey={previousKey} name={previousLabel} stroke={COMPARISON} strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            ) : null}
            <Area
              type="monotone"
              dataKey={valueKey}
              name={currentLabel}
              stroke={PRIMARY}
              strokeWidth={2}
              fill="url(#trendFill)"
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Horizontal bar list with direct labels — identity by monogram + name, value always printed. */
export function ChannelBarList({
  rows,
  format = formatAED,
  secondary,
}: {
  rows: { channel: OrderChannel; value: number; share?: number; note?: React.ReactNode }[];
  format?: (v: number) => string;
  secondary?: (row: { channel: OrderChannel; value: number; share?: number }) => React.ReactNode;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.channel} className="group">
          <div className="mb-1 flex items-center justify-between gap-2 text-[13px]">
            <span className="flex items-center gap-2 font-medium">
              <ChannelMark channel={r.channel} size="xs" />
              {CHANNEL_THEME[r.channel].label}
            </span>
            <span className="flex items-center gap-2">
              {secondary ? <span className="text-xs text-muted-foreground">{secondary(r)}</span> : null}
              <span className="font-semibold tabular">{format(r.value)}</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" title={`${CHANNEL_THEME[r.channel].label}: ${format(r.value)}`}>
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(r.value / max) * 100}%`, background: CHANNEL_HEX[r.channel] }} />
          </div>
          {r.note ? <div className="mt-0.5 text-[11px] text-muted-foreground">{r.note}</div> : null}
        </li>
      ))}
    </ul>
  );
}

/** 100% share bar with 2px surface gaps between segments + legend with values. */
export function ShareBar({ rows }: { rows: { channel: OrderChannel; share: number }[] }) {
  const visible = rows.filter((r) => r.share > 0);
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {visible.map((r) => (
          <div key={r.channel} title={`${CHANNEL_THEME[r.channel].label} ${r.share.toFixed(1)}%`} style={{ width: `${r.share}%`, background: CHANNEL_HEX[r.channel] }} />
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {visible.map((r) => (
          <div key={r.channel} className="flex items-center gap-1.5 text-xs">
            <ChannelMark channel={r.channel} size="xs" />
            <span className="text-muted-foreground">{CHANNEL_THEME[r.channel].short}</span>
            <span className="ml-auto font-semibold tabular">{r.share.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Single-series vertical bars (e.g. orders by hour). */
export function SimpleBars({
  data,
  xKey,
  yKey,
  name,
  height = 200,
  format = (v: number) => formatNumber(v),
  highlight,
  color = PRIMARY,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  name: string;
  height?: number;
  format?: (v: number) => string;
  highlight?: (d: Record<string, unknown>) => boolean;
  color?: string;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
        <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => format(v)} />
          <Tooltip cursor={{ fill: "var(--muted)" }} content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} format={format} />} />
          <Bar
            dataKey={yKey}
            name={name}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            shape={(props: unknown) => {
              const { x, y, width, height: h, payload } = props as { x: number; y: number; width: number; height: number; payload: Record<string, unknown> };
              const on = highlight ? highlight(payload) : true;
              const r = Math.min(4, width / 2, h);
              return (
                <path
                  d={`M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + h} Z`}
                  fill={color}
                  fillOpacity={on ? 1 : 0.35}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
