import { Send, Square } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  CLAUDE_MODELS,
  PERMISSION_MODES,
  type ClaudeModel,
  type PermissionMode,
} from "@/types/chatSettings";

interface ChatInputProps {
  isRunning: boolean;
  onSend: (prompt: string) => void;
  onStop: () => void;
  model: ClaudeModel;
  onModelChange: (model: ClaudeModel) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
}

export function ChatInput({
  isRunning,
  onSend,
  onStop,
  model,
  onModelChange,
  permissionMode,
  onPermissionModeChange,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || isRunning) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  return (
    <div className="border-t border-border px-3 py-2 shrink-0">
      <div
        className={cn(
          "rounded-xl border border-input bg-background px-3 py-2 transition-colors focus-within:border-ring",
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Message Claude…"
          rows={1}
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground min-h-[24px]"
        />
        <div className="flex items-center justify-end gap-1.5 pt-1">
          <Select
            value={model}
            onValueChange={(v) => onModelChange(v as ClaudeModel)}
          >
            <SelectTrigger size="sm" className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {CLAUDE_MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={permissionMode}
            onValueChange={(v) => onPermissionModeChange(v as PermissionMode)}
          >
            <SelectTrigger size="sm" className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {PERMISSION_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>{" "}
          {isRunning ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 shrink-0 text-destructive hover:text-destructive"
              onClick={onStop}
              aria-label="Stop"
            >
              <Square className="size-4 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              onClick={submit}
              disabled={!value.trim()}
              aria-label="Send"
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
