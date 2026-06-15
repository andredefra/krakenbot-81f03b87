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

  const q = useQuery({
    queryKey: ["events_log", filterMode],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events_log")
        .select("id,ts,level,component,message,mode,payload")
        .eq("mode", filterMode)
        .order("ts", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("events-log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "events_log" }, () => q.refetch())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Log</h1>
          <p className="text-sm text-muted-foreground">
            Ultimi 200 eventi · modalità {filterMode.toUpperCase()}
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
          <CardTitle>{q.data?.length ?? 0} eventi</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (q.data?.length ?? 0) === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Nessun evento ancora.</div>
          ) : (
            <ul className="divide-y divide-border">
              {q.data!.map((e) => (
                <EventRowItem key={e.id} e={e} />
              ))}
            </ul>
          )}
        </CardContent>
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
