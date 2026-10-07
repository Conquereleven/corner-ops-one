"use client";

import { ArrowRight, ArrowUp, Bot, CircleAlert, Lightbulb, Loader2, Newspaper, ShieldAlert, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHeader, Panel } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { RelativeTime } from "@/components/shared/time";
import { Button } from "@/components/ui/button";
import type { AIAnswer, Insight, SuggestedAction } from "@/domain/ai/types";
import { useAsk, useBriefing } from "@/hooks/queries";
import { cn } from "@/lib/utils";

const SUGGESTED_PROMPTS = [
  "Why did revenue drop today?",
  "Which location is performing best?",
  "Which delivery platform is most profitable?",
  "What items are likely to run out tonight?",
  "Where are our operational bottlenecks?",
];

export function AIView() {
  const { data, isLoading, error, refetch } = useBriefing();

  const header = (
    <PageHeader
      title="AI Operations"
      description="An analyst that watches every channel, kitchen and stock level — and tells you what to do next."
      actions={
        data ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground">
            <Bot className="size-3.5" /> {data.provider}
          </span>
        ) : null
      }
    />
  );
  if (error) return (<>{header}<ErrorState error={error} onRetry={() => refetch()} /></>);
  if (isLoading || !data) return (<>{header}<PageSkeleton /></>);

  return (
    <div className="space-y-4">
      {header}

      <div className="flex items-start gap-3 rounded-xl bg-[#141417] px-5 py-4 text-white">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-[#eb6834]" />
        <div className="min-w-0">
          <div className="text-xs font-medium text-white/50">
            {data.scopeLabel} · generated <RelativeTime iso={data.generatedAt} />
          </div>
          <div className="mt-0.5 text-lg font-semibold leading-snug">{data.headline}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-3" title={<span className="inline-flex items-center gap-1.5"><Newspaper className="size-4" /> Daily briefing</span>}>
          <InsightList items={data.briefing} />
        </Panel>
        <Panel className="xl:col-span-2" title={<span className="inline-flex items-center gap-1.5"><Zap className="size-4" /> Suggested actions</span>} description="Ranked by impact" bodyClassName="p-3">
          {data.actions.length ? (
            <ul className="space-y-2">
              {data.actions.slice(0, 6).map((a) => (
                <ActionCard key={a.id} action={a} />
              ))}
            </ul>
          ) : (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">No actions needed right now.</p>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={<span className="inline-flex items-center gap-1.5"><ShieldAlert className="size-4 text-red-600" /> Risks</span>}>
          {data.risks.length ? <InsightList items={data.risks} /> : <p className="text-sm text-muted-foreground">No material risks detected.</p>}
        </Panel>
        <Panel title={<span className="inline-flex items-center gap-1.5"><Lightbulb className="size-4 text-amber-600" /> Opportunities</span>}>
          {data.opportunities.length ? <InsightList items={data.opportunities} /> : <p className="text-sm text-muted-foreground">Nothing new today.</p>}
        </Panel>
      </div>

      <AskCornerOps />
    </div>
  );
}

function InsightList({ items }: { items: Insight[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.id} className="flex gap-2.5 text-sm leading-relaxed">
          <span
            className={cn(
              "mt-2 size-1.5 shrink-0 rounded-full",
              i.tone === "positive" ? "bg-good" : i.tone === "negative" ? "bg-critical" : "bg-muted-foreground/50",
            )}
            aria-hidden
          />
          <span className="flex-1">
            {i.text}
            {i.href ? (
              <Link href={i.href} className="ml-1.5 inline-flex items-center text-xs font-medium text-muted-foreground hover:text-foreground">
                View <ArrowRight className="ml-0.5 size-3" />
              </Link>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ActionCard({ action }: { action: SuggestedAction }) {
  const impact = {
    high: "bg-red-50 text-red-700 ring-red-600/20",
    medium: "bg-amber-50 text-amber-800 ring-amber-500/30",
    low: "bg-zinc-100 text-zinc-600 ring-zinc-500/15",
  }[action.impact];
  return (
    <li className="rounded-lg border bg-background/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-semibold leading-snug">{action.title}</div>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset", impact)}>{action.impact}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{action.rationale}</p>
      <Link href={action.cta.href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium hover:underline">
        {action.cta.label} <ArrowRight className="size-3" />
      </Link>
    </li>
  );
}

function AskCornerOps() {
  const ask = useAsk();
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState<AIAnswer[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [thread.length, pending]);

  const submit = (q: string) => {
    const text = q.trim();
    if (text.length < 2 || ask.isPending) return;
    setPending(text);
    setQuestion("");
    ask.mutate(text, {
      onSuccess: (a) => setThread((t) => [...t, a]),
      onSettled: () => setPending(null),
    });
  };

  return (
    <Panel
      title={<span className="inline-flex items-center gap-1.5"><Bot className="size-4" /> Ask CornerOps</span>}
      description="Answers are computed from live CornerOps data. The provider layer is ready for an LLM; v0.1 uses a deterministic analyst."
    >
      {thread.length === 0 && !pending ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTED_PROMPTS.map((p) => (
            <button key={p} type="button" onClick={() => submit(p)} className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted">
              {p}
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-4">
        {thread.map((a, i) => (
          <div key={`${a.generatedAt}-${i}`} className="space-y-2">
            <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-sm bg-foreground px-3.5 py-2 text-sm text-background">{a.question}</div>
            <div className="max-w-3xl rounded-2xl rounded-bl-sm border bg-background/60 px-4 py-3">
              <p className="text-sm leading-relaxed">{a.answer}</p>
              {a.bullets.length ? (
                <ul className="mt-2 space-y-1 text-[13px] text-foreground/90">
                  {a.bullets.map((b) => (
                    <li key={b} className="flex gap-2">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" /> <span>{b}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
                <span>Sources: {a.sources.join(" · ")}</span>
              </div>
              {i === thread.length - 1 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {a.followUps.map((f) => (
                    <button key={f} type="button" onClick={() => submit(f)} className="rounded-full border bg-card px-2.5 py-1 text-[11px] font-medium hover:bg-muted">
                      {f}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {pending ? (
          <div className="space-y-2">
            <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-sm bg-foreground px-3.5 py-2 text-sm text-background">{pending}</div>
            <div className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Analysing orders, channels and stock…
            </div>
          </div>
        ) : null}
        {ask.isError ? (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <CircleAlert className="size-4" /> {(ask.error as Error).message}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        className="mt-4 flex items-center gap-2 rounded-xl border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring"
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
      >
        <Sparkles className="size-4 text-muted-foreground" />
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask CornerOps about your operation…"
          maxLength={500}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          aria-label="Ask CornerOps"
        />
        <Button type="submit" size="icon-sm" disabled={question.trim().length < 2 || ask.isPending} aria-label="Send">
          <ArrowUp />
        </Button>
      </form>
    </Panel>
  );
}
