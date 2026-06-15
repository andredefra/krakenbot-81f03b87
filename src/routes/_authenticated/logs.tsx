import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { useActiveMode } from "@/hooks/use-active-mode";
import { downloadPaperReport } from "@/lib/reports.functions";
import { FileText, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/logs")({
  component: LogsPage,
});

type EventRow = {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  component: string;
  message: string;
  mode: "paper" | "live";
  payload: { kind?: string } | null;
};

function LogsPage() {
  const { mode: activeMode } = useActiveMode();
  const [viewMode, setViewMode] = useState<"current" | "paper-archive">("current");
  const filterMode = viewMode === "current" ? activeMode : "paper";
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [filterMode]);

  const q = useQuery({
    queryKey: ["events_log", filterMode, page],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error, count } = await supabase
        .from("events_log")
        .select("id,ts,level,component,message,mode,payload", { count: "exact" })
        .eq("mode", filterMode)
        .order("ts", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as EventRow[], total: count ?? 0 };
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("events-log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "events_log" }, () => {
        if (page === 0) q.refetch();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const total = q.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = q.data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Log</h1>
          <p className="text-sm text-muted-foreground">
            {total} eventi totali · modalità {filterMode.toUpperCase()}
          </p>
        </div>
        {activeMode === "live" && (
          <div className="inline-flex rounded-md border border-border p-1 bg-card/50">
            <Button
              size="sm"
              variant={viewMode === "current" ? "default" : "ghost"}
              onClick={() => setViewMode("current")}
            >
              Live
            </Button>
            <Button
              size="sm"
              variant={viewMode === "paper-archive" ? "default" : "ghost"}
              onClick={() => setViewMode("paper-archive")}
            >
              Archivio Paper
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {rows.length} eventi · pagina {page + 1} di {totalPages}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Nessun evento ancora.</div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((e) => (
                <EventRowItem key={e.id} e={e} />
              ))}
            </ul>
          )}
        </CardContent>
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-t border-border text-sm">
            <div className="text-xs text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} di {total}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || q.isFetching}
              >
                Precedente
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1 || q.isFetching}
              >
                Successiva
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function EventRowItem({ e }: { e: EventRow }) {
  const hasReport = e.payload?.kind === "paper_report";
  return (
    <li className="px-4 md:px-6 py-3 flex items-start gap-3 text-sm">
      <LevelBadge level={e.level} />
      <div className="text-xs text-muted-foreground tabular shrink-0 w-36">{formatDateTime(e.ts)}</div>
      <div className="text-xs text-muted-foreground shrink-0 w-32 truncate">{e.component}</div>
      <div className="min-w-0 break-words flex-1">{e.message}</div>
      {hasReport && <ReportDownloadButton eventId={e.id} />}
    </li>
  );
}

function ReportDownloadButton({ eventId }: { eventId: string }) {
  const download = useServerFn(downloadPaperReport);
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    try {
      setLoading(true);
      const { base64, filename } = await download({ data: { eventId } });
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore download");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={loading} className="shrink-0 gap-1.5">
      {loading ? <span className="text-xs">…</span> : <FileText className="size-3.5" />}
      <span className="hidden sm:inline">PDF</span>
      <Download className="size-3.5" />
    </Button>
  );
}

function LevelBadge({ level }: { level: "info" | "warn" | "error" }) {
  if (level === "error") {
    return <Badge className="bg-[color:var(--loss)]/15 text-[color:var(--loss)] border border-[color:var(--loss)]/30 hover:bg-[color:var(--loss)]/15 shrink-0">ERR</Badge>;
  }
  if (level === "warn") {
    return <Badge className="bg-[color:var(--paper)]/15 text-[color:var(--paper)] border border-[color:var(--paper)]/30 hover:bg-[color:var(--paper)]/15 shrink-0">WARN</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground shrink-0">INFO</Badge>;
}
