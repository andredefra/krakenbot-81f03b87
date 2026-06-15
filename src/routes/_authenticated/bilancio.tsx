import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import Papa from "papaparse";
import {
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useActiveMode } from "@/hooks/use-active-mode";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Calculator, Plus, Trash2, Upload, Download, RefreshCcw, AlertCircle, CalendarClock } from "lucide-react";
import {
  listInfraCosts,
  upsertInfraCost,
  deleteInfraCost,
  bulkImportInfraCosts,
  getIncomeStatement,
  getTaxSummary,
  syncKrakenFees,
} from "@/lib/bilancio.functions";

export const Route = createFileRoute("/_authenticated/bilancio")({
  component: BilancioPage,
});

const eur = (cents: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(cents / 100);

function BilancioPage() {
  const { mode } = useActiveMode();
  const year = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Calculator className="size-6" /> Bilancio
          </h1>
          <p className="text-sm text-muted-foreground">
            Costi, ricavi, tasse — vista {mode === "live" ? "LIVE" : "PAPER"} · anno {year}
          </p>
        </div>
        <Badge variant="outline" className="uppercase">{mode}</Badge>
      </div>

      <InfraCostsSection />
      <TradingCostsSection mode={mode} />
      <IncomeStatementSection year={year} mode={mode} />
      <TaxSection year={year} />
    </div>
  );
}

// ============= A) Infra Costs =============

function InfraCostsSection() {
  const qc = useQueryClient();
  const list = useServerFn(listInfraCosts);
  const upsert = useServerFn(upsertInfraCost);
  const del = useServerFn(deleteInfraCost);
  const bulk = useServerFn(bulkImportInfraCosts);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const q = useQuery({ queryKey: ["infra_costs"], queryFn: () => list() });
  const items = q.data ?? [];

  const kpi = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let month = 0;
    let ytd = 0;
    for (const c of items) {
      const monthlyEquiv =
        c.recurrence === "monthly" ? c.amount_cents : c.recurrence === "yearly" ? Math.round(c.amount_cents / 12) : 0;
      const start = new Date(c.start_date);
      const end = c.end_date ? new Date(c.end_date) : null;
      const isActive = start <= now && (!end || end >= now);
      if (isActive) month += monthlyEquiv;
      // YTD: months from max(start, jan) to current
      const yStart = new Date(now.getFullYear(), 0, 1);
      const from = start > yStart ? start : yStart;
      const to = end && end < now ? end : now;
      if (from <= to) {
        const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1;
        if (c.recurrence === "monthly") ytd += monthlyEquiv * months;
        else if (c.recurrence === "yearly") ytd += monthlyEquiv * months;
        else if (c.recurrence === "one_off" && start.getFullYear() === now.getFullYear()) ytd += c.amount_cents;
      }
    }
    return { month, ytd, runRate: month * 12 };
  }, [items]);

  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Voce eliminata");
      qc.invalidateQueries({ queryKey: ["infra_costs"] });
    },
  });

  const handleImport = async (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (res) => {
        try {
          const rows = (res.data as Record<string, string>[]).map((r) => ({
            name: r.name?.trim(),
            category: (r.category?.trim() || "infra") as "infra" | "api" | "altro",
            amount_cents: Math.round(Number(r.amount_eur || r.amount || 0) * 100),
            currency: (r.currency || "EUR").toUpperCase(),
            recurrence: (r.recurrence?.trim() || "monthly") as "one_off" | "monthly" | "yearly",
            start_date: r.start_date,
            end_date: r.end_date || null,
            notes: r.notes || null,
          })).filter((r) => r.name && r.start_date && r.amount_cents > 0);
          if (rows.length === 0) {
            toast.error("Nessuna riga valida nel CSV");
            return;
          }
          const out = await bulk({ data: { rows } });
          toast.success(`Importate ${out.inserted} voci`);
          qc.invalidateQueries({ queryKey: ["infra_costs"] });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Errore import");
        }
      },
    });
  };

  const exportCsv = () => {
    const csv = Papa.unparse(
      items.map((c) => ({
        name: c.name,
        category: c.category,
        amount_eur: (c.amount_cents / 100).toFixed(2),
        currency: c.currency,
        recurrence: c.recurrence,
        start_date: c.start_date,
        end_date: c.end_date ?? "",
        notes: c.notes ?? "",
      })),
    );
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `infra_costs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Costi infrastruttura</CardTitle>
            <CardDescription>Lovable, Supabase, API. Inserimento manuale + import CSV.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> Import CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={items.length === 0}>
              <Download className="size-4" /> Export CSV
            </Button>
            <Dialog
              open={dialogOpen}
              onOpenChange={(o) => {
                setDialogOpen(o);
                if (!o) setEditing(null);
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => setEditing(null)}>
                  <Plus className="size-4" /> Aggiungi
                </Button>
              </DialogTrigger>
              <InfraCostDialog
                initial={editing}
                onSave={async (data) => {
                  await upsert({ data });
                  toast.success("Salvato");
                  qc.invalidateQueries({ queryKey: ["infra_costs"] });
                  setDialogOpen(false);
                }}
              />
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Kpi label="Mese corrente" value={eur(kpi.month)} />
          <Kpi label="YTD" value={eur(kpi.ytd)} />
          <Kpi label="Run-rate annuo" value={eur(kpi.runRate)} />
        </div>

        {q.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg">
            Nessun costo registrato. Aggiungi le tue subscription per iniziare a tracciare il bilancio.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voce</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Importo</TableHead>
                  <TableHead>Ricorrenza</TableHead>
                  <TableHead>Periodo</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => {
                      setEditing(c);
                      setDialogOpen(true);
                    }}
                  >
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{c.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{eur(c.amount_cents)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.recurrence}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.start_date}{c.end_date ? ` → ${c.end_date}` : " → in corso"}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Eliminare "${c.name}"?`)) remove.mutate(c.id);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Formato CSV: <code>name,category,amount_eur,currency,recurrence,start_date,end_date,notes</code>
        </p>
      </CardContent>
    </Card>
  );
}

function InfraCostDialog({
  initial,
  onSave,
}: {
  initial: any | null;
  onSave: (data: any) => Promise<void>;
}) {
  const [form, setForm] = useState(() => ({
    id: initial?.id,
    name: initial?.name ?? "",
    category: initial?.category ?? "infra",
    amount_eur: initial ? (initial.amount_cents / 100).toString() : "",
    currency: initial?.currency ?? "EUR",
    recurrence: initial?.recurrence ?? "monthly",
    start_date: initial?.start_date ?? new Date().toISOString().slice(0, 10),
    end_date: initial?.end_date ?? "",
    notes: initial?.notes ?? "",
  }));
  const [saving, setSaving] = useState(false);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{initial ? "Modifica costo" : "Nuovo costo"}</DialogTitle>
        <DialogDescription>Subscription, API, hosting...</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Nome</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="es. Lovable Pro" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Categoria</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="infra">Infrastruttura</SelectItem>
                <SelectItem value="api">API</SelectItem>
                <SelectItem value="altro">Altro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Ricorrenza</Label>
            <Select value={form.recurrence} onValueChange={(v) => setForm({ ...form, recurrence: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Mensile</SelectItem>
                <SelectItem value="yearly">Annuale</SelectItem>
                <SelectItem value="one_off">Una tantum</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Importo (EUR)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.amount_eur}
              onChange={(e) => setForm({ ...form, amount_eur: e.target.value })}
            />
          </div>
          <div>
            <Label>Valuta</Label>
            <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} maxLength={3} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Data inizio</Label>
            <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div>
            <Label>Data fine (opzionale)</Label>
            <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </div>
        </div>
        <div>
          <Label>Note</Label>
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={saving || !form.name || !form.amount_eur || !form.start_date}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({
                ...(form.id ? { id: form.id } : {}),
                name: form.name,
                category: form.category,
                amount_cents: Math.round(Number(form.amount_eur) * 100),
                currency: form.currency,
                recurrence: form.recurrence,
                start_date: form.start_date,
                end_date: form.end_date || null,
                notes: form.notes || null,
              });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Errore");
            } finally {
              setSaving(false);
            }
          }}
        >
          Salva
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ============= B) Trading Costs =============

function TradingCostsSection({ mode }: { mode: "paper" | "live" }) {
  const sync = useServerFn(syncKrakenFees);
  const m = useMutation({
    mutationFn: () => sync(),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(
          r.synced > 0
            ? `Sincronizzate ${r.synced} fee`
            : (r as any).note ?? "Nessuna nuova fee da sincronizzare",
        );
      } else {
        toast.error(r.error ?? "Errore sync");
      }
    },
  });

  const feesQ = useQuery({
    queryKey: ["trade_fees", mode],
    queryFn: async () => {
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      if (mode === "live") {
        const { data, error } = await supabase
          .from("trade_fees")
          .select("fee_cents,traded_at,cost")
          .gte("traded_at", yearStart);
        if (error) throw error;
        const monthCents = (data ?? [])
          .filter((d) => d.traded_at >= monthStart)
          .reduce((s, d) => s + d.fee_cents, 0);
        const ytdCents = (data ?? []).reduce((s, d) => s + d.fee_cents, 0);
        const totalCost = (data ?? []).reduce((s, d) => s + Number(d.cost ?? 0), 0);
        const avgBps = totalCost > 0 ? Math.round((ytdCents / (totalCost * 100)) * 10000) : 0;
        return { monthCents, ytdCents, avgBps, source: "kraken" as const };
      }

      // paper mode: estimate from closed positions
      const [settingsR, positionsR] = await Promise.all([
        supabase.from("settings").select("paper_fee_bps").maybeSingle(),
        supabase
          .from("positions")
          .select("exit_value,closed_at")
          .eq("mode", "paper")
          .eq("status", "closed")
          .gte("closed_at", yearStart),
      ]);
      const feeBps = settingsR.data?.paper_fee_bps ?? 26;
      const positions = positionsR.data ?? [];
      let monthCents = 0;
      let ytdCents = 0;
      let totalVol = 0;
      for (const p of positions) {
        if (!p.exit_value || !p.closed_at) continue;
        const fee = Math.round((Number(p.exit_value) * feeBps) / 10000 * 100);
        ytdCents += fee;
        totalVol += Number(p.exit_value);
        if (p.closed_at >= monthStart) monthCents += fee;
      }
      return { monthCents, ytdCents, avgBps: feeBps, source: "paper-estimate" as const };
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Costi di trading</CardTitle>
            <CardDescription>
              {mode === "live"
                ? "Fees reali dai trade Kraken."
                : "Stima basata sulla % configurata (default 0.26% — modificabile in Rischio)."}
            </CardDescription>
          </div>
          {mode === "live" && (
            <Button variant="outline" size="sm" disabled={m.isPending} onClick={() => m.mutate()}>
              <RefreshCcw className={`size-4 ${m.isPending ? "animate-spin" : ""}`} /> Sincronizza
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {feesQ.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Kpi label="Fees mese" value={eur(feesQ.data?.monthCents ?? 0)} />
            <Kpi label="Fees YTD" value={eur(feesQ.data?.ytdCents ?? 0)} />
            <Kpi label="Fee media" value={`${((feesQ.data?.avgBps ?? 0) / 100).toFixed(2)}%`} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============= C) Income statement =============

function IncomeStatementSection({ year, mode }: { year: number; mode: "paper" | "live" }) {
  const get = useServerFn(getIncomeStatement);
  const q = useQuery({
    queryKey: ["income_statement", year, mode],
    queryFn: () => get({ data: { year, mode } }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conto economico</CardTitle>
        <CardDescription>Ricavi, fees, infrastruttura, tasse stimate → utile netto.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {q.isLoading || !q.data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label="Ricavi YTD" value={eur(q.data.ytd.revenueCents)} positive={q.data.ytd.revenueCents >= 0} />
              <Kpi label="Costi totali YTD" value={eur(q.data.ytd.feeCents + q.data.ytd.infraCostCents)} />
              <Kpi label="Tasse stimate YTD" value={eur(q.data.ytd.taxCents)} />
              <Kpi label="Utile netto YTD" value={eur(q.data.ytd.netCents)} positive={q.data.ytd.netCents >= 0} />
            </div>

            <div className="h-64">
              <ResponsiveContainer>
                <RLineChart data={q.data.monthly.map((m) => ({
                  month: m.month.slice(5),
                  Lordo: m.revenueCents / 100,
                  Netto: m.netCents / 100,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" stroke="currentColor" className="text-xs text-muted-foreground" />
                  <YAxis stroke="currentColor" className="text-xs text-muted-foreground" />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    formatter={(v: number) => `€${v.toFixed(2)}`}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="Lordo" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Netto" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </RLineChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mese</TableHead>
                    <TableHead className="text-right">Ricavi</TableHead>
                    <TableHead className="text-right">Fees</TableHead>
                    <TableHead className="text-right">Infra</TableHead>
                    <TableHead className="text-right">Tasse</TableHead>
                    <TableHead className="text-right">Netto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data.monthly.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="font-mono text-xs">{m.month}</TableCell>
                      <TableCell className="text-right tabular-nums">{eur(m.revenueCents)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">−{eur(m.feeCents)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">−{eur(m.infraCostCents)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">−{eur(m.taxCents)}</TableCell>
                      <TableCell className={`text-right tabular-nums font-medium ${m.netCents >= 0 ? "text-[color:var(--bull,#22c55e)]" : "text-[color:var(--bear,#ef4444)]"}`}>
                        {eur(m.netCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell>YTD</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(q.data.ytd.revenueCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">−{eur(q.data.ytd.feeCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">−{eur(q.data.ytd.infraCostCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">−{eur(q.data.ytd.taxCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(q.data.ytd.netCents)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <Separator />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">Run-rate ricavi</div>
                <div className="font-medium">{eur(q.data.runRateAnnual.revenueCents)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Run-rate infra</div>
                <div className="font-medium">{eur(q.data.runRateAnnual.infraCostCents)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Run-rate netto</div>
                <div className="font-medium">{eur(q.data.runRateAnnual.netCents)}</div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============= D) Tax section (read-only, fully automatic) =============

function TaxSection({ year }: { year: number }) {
  const get = useServerFn(getTaxSummary);
  const summaryQ = useQuery({
    queryKey: ["tax_summary", year],
    queryFn: () => get({ data: { year } }),
  });

  const isItaly =
    summaryQ.data &&
    "country" in summaryQ.data &&
    summaryQ.data.country === "IT" &&
    !("unsupported" in summaryQ.data);
  const summary = isItaly ? (summaryQ.data as any) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasse · Automatico</CardTitle>
        <CardDescription>
          Italia — imposta sostitutiva 26% sulle plusvalenze crypto. Riserva accantonata
          automaticamente ad ogni trade Live in profitto. Promemoria scadenze inviati su Telegram a
          T-30, T-7, T-1 giorni.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {summaryQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !isItaly ? (
          <div className="text-sm text-muted-foreground p-4 border border-dashed rounded">
            Regole fiscali per <strong>{(summaryQ.data as any)?.country}</strong> non ancora
            implementate. Quando ti trasferirai, le aggiungeremo qui.
          </div>
        ) : summary && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label="Plusvalenze YTD (Live)" value={eur(summary.realizedGainCents)} />
              <Kpi label="Minusvalenze riportate" value={eur(summary.lossCarryforwardCents)} />
              <Kpi label="Base imponibile" value={eur(summary.taxableBaseCents)} />
              <Kpi label="Imposta 26%" value={eur(summary.taxDueCents)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Kpi label="Riserva accantonata (auto)" value={eur(summary.reservedCents)} />
              <div className="p-3 rounded-lg border border-border bg-card/50">
                <div className="text-xs text-muted-foreground">Copertura riserva</div>
                <div className="flex items-center gap-3 mt-1">
                  <Progress value={summary.reserveCoverageBps / 100} className="flex-1" />
                  <span className="tabular-nums text-sm font-medium">
                    {(summary.reserveCoverageBps / 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>

            {summary.realizedGainCents === 0 && summary.lossCarryforwardCents === 0 && (
              <div className="text-xs text-muted-foreground p-3 rounded border border-border/50 bg-muted/20">
                Nessun trade Live ancora chiuso. Parti da zero — il sistema accantonerà
                automaticamente il 26% di ogni futura plusvalenza realizzata.
              </div>
            )}

            <div>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <CalendarClock className="size-4" /> Scadenze fiscali Italia
              </h3>
              {summary.nextDeadline && (
                <div
                  className={`mb-3 p-3 rounded-lg border ${
                    summary.nextDeadline.daysLeft <= 30
                      ? "border-[color:var(--live,#ef4444)]/40 bg-[color:var(--live,#ef4444)]/5"
                      : "border-border bg-muted/30"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="size-4 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div className="font-medium text-sm">
                        Prossima: {summary.nextDeadline.label}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {summary.nextDeadline.description}
                      </div>
                      <div className="text-xs mt-1">
                        <Badge variant="outline">{summary.nextDeadline.date}</Badge>
                        <span className="ml-2 tabular-nums">
                          {summary.nextDeadline.daysLeft} giorni
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                {summary.deadlines.slice(0, 6).map((d: any) => (
                  <div
                    key={d.id}
                    className="flex items-start justify-between gap-3 text-sm py-2 border-b border-border/50 last:border-0"
                  >
                    <div>
                      <div className="font-medium">{d.label}</div>
                      <div className="text-xs text-muted-foreground">{d.description}</div>
                    </div>
                    <Badge variant="outline" className="font-mono text-xs shrink-0">
                      {d.date}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border/50">
              {summary.notes.map((n: string, i: number) => (
                <div key={i}>• {n}</div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============= Helpers =============

function Kpi({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="p-3 rounded-lg border border-border bg-card/50">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${positive === true ? "text-[color:var(--bull,#22c55e)]" : positive === false ? "text-[color:var(--bear,#ef4444)]" : ""}`}>
        {value}
      </div>
    </div>
  );
}
