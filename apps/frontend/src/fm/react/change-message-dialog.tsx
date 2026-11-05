import type { SubmitEvent } from "react";
import type { FmChangeMessageAsk } from "./change-message";
import type { FmLabels } from "./labels";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** "Describe the change" prompt shown before a change when `changeMessage.mode` is set. */
export function ChangeMessageDialog({ asking, labels }: { asking: FmChangeMessageAsk; labels: FmLabels }) {
  const [text, setText] = useState("");
  const blocked = asking.required && !text.trim();
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!blocked)
      asking.settle(text.trim() || undefined);
  };
  return (
    <Dialog open onOpenChange={open => !open && asking.settle(null)}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{labels.changeMessageTitle}</DialogTitle>
            <DialogDescription>
              {asking.required
                ? labels.changeMessageRequired
                : labels.changeMessageOptional}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={labels.changeMessageTitle}
            placeholder={asking.placeholder || labels.changeMessagePlaceholder}
            maxLength={1000}
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => asking.settle(null)}>{labels.cancel}</Button>
            <Button type="submit" disabled={blocked}>{labels.continue}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
