// POST /api/chat — streaming chat endpoint backed by Lovable AI Gateway.
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { verifyBearer } from "@/lib/assistant/auth.server";
import { createLovableAiGatewayProvider } from "@/lib/assistant/ai-gateway.server";
import { buildSystemPrompt } from "@/lib/assistant/system-prompt.server";
import { buildAssistantTools } from "@/lib/assistant/tools.server";

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
          onFinish: async ({ messages: finalMessages }) => {
            // Persist any new messages (idempotent on (user_id, message_id))
            try {
              const rows = finalMessages.map((m) => ({
                user_id: userId,
                message_id: m.id,
                role: m.role,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                parts: m.parts as any,
              }));
              if (rows.length) {
                await supabase.from("chat_messages").upsert(rows, {
                  onConflict: "user_id,message_id",
                });
              }
            } catch (err) {
              console.error("[chat persist]", err);
            }
          },
        });
      },
    },
  },
});
