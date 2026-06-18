// POST /api/chat — streaming chat endpoint backed by Lovable AI Gateway.
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { verifyBearer } from "@/lib/assistant/auth.server";
import { createLovableAiGatewayProvider } from "@/lib/assistant/ai-gateway.server";
import { buildSystemPrompt } from "@/lib/assistant/system-prompt.server";
import { buildAssistantTools } from "@/lib/assistant/tools.server";

// Best-effort waitUntil: keeps async work alive after the response is returned
// on Cloudflare Workers. In dev (Node) the promise simply runs to completion.
function keepAlive(p: Promise<unknown>) {
  try {
    // Dynamic require so the dev bundle doesn't try to resolve cloudflare:workers
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require("cloudflare:workers") as {
      getRequestContext?: () => { ctx: { waitUntil: (p: Promise<unknown>) => void } };
    };
    mod.getRequestContext?.().ctx.waitUntil(p);
    return;
  } catch {
    // fall through
  }
  // In Node the event loop keeps the promise alive; swallow rejections so
  // an unhandled rejection doesn't crash the dev server.
  p.catch((err) => console.error("[chat persist]", err));
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let auth;
        try {
          auth = await verifyBearer(request);
        } catch (resp) {
          if (resp instanceof Response) return resp;
          throw resp;
        }
        const { supabase, userId } = auth;

        const body = (await request.json()) as { messages?: UIMessage[] };
        const messages = Array.isArray(body.messages) ? body.messages : [];

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("LOVABLE_API_KEY missing", { status: 500 });

        // 1) Persist the latest user message SYNCHRONOUSLY before starting the
        // stream. Otherwise, in serverless runtimes the worker can be torn
        // down before onFinish completes and the message is lost.
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          const { error } = await supabase.from("chat_messages").upsert(
            {
              user_id: userId,
              message_id: lastUser.id,
              role: lastUser.role,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              parts: lastUser.parts as any,
            },
            { onConflict: "user_id,message_id" },
          );
          if (error) console.error("[chat persist user]", error);
        }

        const knownIds = new Set(messages.map((m) => m.id));

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        const tools = buildAssistantTools(supabase, userId);

        const result = streamText({
          model,
          system: buildSystemPrompt(),
          tools,
          messages: await convertToModelMessages(messages),
          stopWhen: ({ steps }) => steps.length >= 12,
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: ({ messages: finalMessages }) => {
            // 2) Persist any NEW messages (assistant + tool parts) and keep the
            // promise alive past the response with waitUntil.
            const newRows = finalMessages
              .filter((m) => !knownIds.has(m.id))
              .map((m) => ({
                user_id: userId,
                message_id: m.id,
                role: m.role,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                parts: m.parts as any,
              }));
            if (!newRows.length) return;
            keepAlive(
              (async () => {
                const { error } = await supabase
                  .from("chat_messages")
                  .upsert(newRows, { onConflict: "user_id,message_id" });
                if (error) console.error("[chat persist assistant]", error);
              })(),
            );
          },
        });
      },
    },
  },
});
