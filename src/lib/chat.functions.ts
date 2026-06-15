import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { UIMessage } from "ai";

export const getChatHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("chat_messages")
      .select("message_id,role,parts,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    const messages: UIMessage[] = (data ?? []).map((row) => ({
      id: row.message_id,
      role: row.role as UIMessage["role"],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parts: (row.parts as any) ?? [],
    }));
    return { messages };
  });

export const clearChatHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("chat_messages").delete().eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
