import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/logs")({
  component: LogsPage,
});

function LogsPage() {
  const q = useQuery({
    queryKey: ["events_log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events_log")
        .select("*")
        .order("ts", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Log</h1>
        <p className="text-sm text-muted-foreground">Ultimi 200 eventi del motore</p>
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
                <li key={e.id} className="px-4 md:px-6 py-3 flex items-start gap-3 text-sm">
                  <LevelBadge level={e.level} />
                  <div className="text-xs text-muted-foreground tabular shrink-0 w-36">{formatDateTime(e.ts)}</div>
                  <div className="text-xs text-muted-foreground shrink-0 w-32 truncate">{e.component}</div>
                  <div className="min-w-0 break-words">{e.message}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
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
