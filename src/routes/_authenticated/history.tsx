import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatUsd, formatPct, formatDateTime, formatDuration, pnlClass } from "@/lib/format";
import { useActiveMode } from "@/hooks/use-active-mode";

export const Route = createFileRoute("/_authenticated/history")({
  component: HistoryPage,
});

function HistoryPage() {
  const { mode } = useActiveMode();
  const q = useQuery({
    queryKey: ["positions", "closed", mode],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("*")
        .eq("status", "closed")
        .eq("mode", mode)
        .order("closed_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });


  useEffect(() => {
    const channel = supabase
      .channel("positions-closed")
      .on("postgres_changes", { event: "*", schema: "public", table: "positions" }, () => q.refetch())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Storico trade</h1>
        <p className="text-sm text-muted-foreground">Ultimi 200 trade chiusi</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (q.data?.length ?? 0) === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Nessun trade chiuso ancora.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Chiuso</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead>Mod.</TableHead>
                    <TableHead className="text-right">Ingresso</TableHead>
                    <TableHead className="text-right">Uscita</TableHead>
                    <TableHead className="text-right">P/L</TableHead>
                    <TableHead>Durata</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data!.map((p) => {
                    const pnl = Number(p.pnl ?? 0);
                    const pnlPct = Number(p.pnl_pct ?? 0);
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm text-muted-foreground">{formatDateTime(p.closed_at)}</TableCell>
                        <TableCell className="font-medium">{p.asset}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{p.mode.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular">{formatUsd(Number(p.entry_price))}</TableCell>
                        <TableCell className="text-right tabular">{p.exit_price ? formatUsd(Number(p.exit_price)) : "—"}</TableCell>
                        <TableCell className={`text-right tabular ${pnlClass(pnl)}`}>
                          {formatUsd(pnl, { signed: true })} <span className="text-xs opacity-80">({formatPct(pnlPct, { signed: true })})</span>
                        </TableCell>
                        <TableCell className="text-sm">{formatDuration(p.opened_at, p.closed_at)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.exit_reason ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
