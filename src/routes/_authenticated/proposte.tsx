import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProposals, decideProposal, applyValidatedProposal } from "@/lib/ai-supervisor.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, Check, X, ArrowRight, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/proposte")({
  component: ProposteePage,
});

const STATUS_LABEL: Record<string, string> = {
  pending: "In attesa",
  approved: "Approvata (validazione in corso)",
  validated: "PASS — pronta da applicare",
  validation_failed: "FAIL — non applicabile",
  applied: "Applicata",
  rejected: "Rifiutata",
};

function ProposteePage() {
  const qc = useQueryClient();
  const fetchProposals = useServerFn(listProposals);
  const decide = useServerFn(decideProposal);
  const apply = useServerFn(applyValidatedProposal);
  const [filter, setFilter] = useState<string>("all");

  const q = useQuery({
    queryKey: ["ai-proposals", filter],
    queryFn: () => fetchProposals({ data: filter === "all" ? {} : { status: filter } }),
    refetchInterval: 30_000,
  });

  const mDecide = useMutation({
    mutationFn: (vars: { id: string; decision: "approve" | "reject" }) => decide({ data: vars }),
    onSuccess: (res) => {
      toast.success(res.status === "validated" ? "Proposta validata: PASS" : res.status === "validation_failed" ? "Proposta validata: FAIL" : res.status === "rejected" ? "Rifiutata" : "Approvata");
      qc.invalidateQueries({ queryKey: ["ai-proposals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mApply = useMutation({
    mutationFn: (id: string) => apply({ data: { id } }),
    onSuccess: () => {
      toast.success("Proposta applicata ai parametri");
      qc.invalidateQueries({ queryKey: ["ai-proposals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ClipboardList className="size-6 text-primary" /> Proposte AI
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Le proposte di modifica generate dall'AI. Approva o rifiuta. Solo le proposte che superano la validazione out-of-sample possono essere applicate.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all", "pending", "validated", "validation_failed", "applied", "rejected"].map((s) => (
          <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>
            {s === "all" ? "Tutte" : STATUS_LABEL[s] ?? s}
          </Button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}</div>
      ) : (q.data ?? []).length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Nessuna proposta in questo stato.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {(q.data ?? []).map((p) => {
            const diff = (p.param_diff as Array<{ field: string; from?: unknown; to: unknown }>) ?? [];
            const validation = p.validation_result as {
              checks?: Record<string, boolean>;
              kpis?: { strategy: Record<string, number>; btcBuyHold: Record<string, number>; btcDca: Record<string, number> };
              reason?: string;
            } | null;
            return (
              <Card key={p.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base">{p.title}</CardTitle>
                      <CardDescription className="text-xs">
                        {new Date(p.created_at).toLocaleString("it-IT")}
                      </CardDescription>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm leading-relaxed">{p.rationale}</p>

                  <div className="bg-muted/30 rounded-md p-3 border border-border">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Modifiche proposte</div>
                    <div className="space-y-1.5">
                      {diff.map((d, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm font-mono">
                          <code className="text-xs bg-background px-1.5 py-0.5 rounded">{d.field}</code>
                          <span className="text-muted-foreground">{String(d.from ?? "—")}</span>
                          <ArrowRight className="size-3 text-primary" />
                          <span className="font-semibold text-primary">{String(d.to)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {validation && (
                    <div className="rounded-md p-3 border border-border bg-muted/20 space-y-2">
                      <div className="text-xs font-medium">Validazione OOS (12 mesi, escluso ultimo mese)</div>
                      {validation.reason && <div className="text-xs text-destructive">{validation.reason}</div>}
                      {validation.checks && (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-xs">
                          <CheckPill ok={validation.checks.profitFactorOk} label="PF > 1.3" />
                          <CheckPill ok={validation.checks.sharpeOk} label="Sharpe > 0.8" />
                          <CheckPill ok={validation.checks.beatsBtcSharpe} label="Sharpe ≥ BTC B&H" />
                          <CheckPill ok={validation.checks.beatsBtcDrawdown} label="DD ≤ BTC B&H" />
                          <CheckPill ok={validation.checks.beatsDcaSharpe} label="Sharpe ≥ DCA" />
                          <CheckPill ok={validation.checks.beatsDcaDrawdown} label="DD ≤ DCA" />
                        </div>
                      )}
                      {validation.kpis && (
                        <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                          <KpiCol title="Strategia" k={validation.kpis.strategy} />
                          <KpiCol title="BTC B&H" k={validation.kpis.btcBuyHold} />
                          <KpiCol title="BTC DCA" k={validation.kpis.btcDca} />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    {p.status === "pending" && (
                      <>
                        <Button size="sm" onClick={() => mDecide.mutate({ id: p.id, decision: "approve" })} disabled={mDecide.isPending}>
                          <Check className="size-4" /> Approva e valida
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => mDecide.mutate({ id: p.id, decision: "reject" })} disabled={mDecide.isPending}>
                          <X className="size-4" /> Rifiuta
                        </Button>
                      </>
                    )}
                    {p.status === "validated" && (
                      <Button size="sm" onClick={() => mApply.mutate(p.id)} disabled={mApply.isPending}>
                        <Check className="size-4" /> Applica al sistema
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; Icon: typeof Shield }> = {
    pending: { cls: "bg-muted text-muted-foreground", Icon: Shield },
    approved: { cls: "bg-blue-500/15 text-blue-400 border-blue-500/30", Icon: Shield },
    validated: { cls: "bg-green-500/15 text-green-500 border-green-500/30", Icon: ShieldCheck },
    validation_failed: { cls: "bg-destructive/15 text-destructive border-destructive/30", Icon: ShieldAlert },
    applied: { cls: "bg-primary/15 text-primary border-primary/30", Icon: Check },
    rejected: { cls: "bg-muted text-muted-foreground", Icon: X },
  };
  const m = map[status] ?? map.pending;
  const I = m.Icon;
  return <Badge variant="outline" className={m.cls}><I className="size-3 mr-1" /> {STATUS_LABEL[status] ?? status}</Badge>;
}

function CheckPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1 px-2 py-1 rounded ${ok ? "bg-green-500/10 text-green-500" : "bg-destructive/10 text-destructive"}`}>
      {ok ? <Check className="size-3" /> : <X className="size-3" />} {label}
    </div>
  );
}

function KpiCol({ title, k }: { title: string; k: Record<string, number> }) {
  return (
    <div className="space-y-0.5">
      <div className="font-medium">{title}</div>
      <div>Ret: {k.totalReturnPct?.toFixed(1)}%</div>
      <div>Sharpe: {k.sharpe?.toFixed(2)}</div>
      <div>MaxDD: {k.maxDrawdownPct?.toFixed(1)}%</div>
    </div>
  );
}
