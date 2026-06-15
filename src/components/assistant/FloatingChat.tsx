import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Bot, X } from "lucide-react";
import { AssistantChat } from "./AssistantChat";

export function FloatingChat() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          className="fixed bottom-6 right-6 z-50 size-14 rounded-full shadow-xl"
          aria-label="Apri assistente"
        >
          {open ? <X className="size-5" /> : <Bot className="size-6" />}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="p-0 w-full sm:max-w-md flex flex-col h-full">
        <AssistantChat />
      </SheetContent>
    </Sheet>
  );
}
