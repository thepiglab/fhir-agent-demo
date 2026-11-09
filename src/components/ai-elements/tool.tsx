// AI Elements Tool, adapted: local state types (no `ai`), JSON shown in a <pre> (no code-block).
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

export type ToolState = "input-streaming" | "input-available" | "output-available" | "output-error" | "output-denied";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible className={cn("not-prose mb-4 w-full rounded-md border", className)} {...props} />
);

export type ToolHeaderProps = {
  title: string;
  state: ToolState;
  className?: string;
};

const LABELS: Record<ToolState, string> = {
  "input-streaming": "Pending",
  "input-available": "Running",
  "output-available": "Completed",
  "output-error": "Error",
  "output-denied": "Denied",
};

export const getStatusBadge = (status: ToolState) => (
  <Badge className="rounded-full px-2.5 py-1 font-normal text-xs" variant={status === "output-error" ? "destructive" : "secondary"}>
    {LABELS[status]}
  </Badge>
);

export const ToolHeader = ({ className, title, state, ...props }: ToolHeaderProps) => (
  <CollapsibleTrigger className={cn("group flex w-full items-center justify-between gap-4 p-3", className)} {...props}>
    <div className="flex items-center gap-2">
      <span className="font-medium text-sm">{title}</span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

const Code = ({ code }: { code: string }) => (
  <pre className="overflow-x-auto p-3 font-mono text-xs leading-5">{code}</pre>
);

export type ToolInputProps = ComponentProps<"div"> & { input: unknown };

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden p-4", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs">Parameters</h4>
    <div className="rounded-md bg-muted/50">
      <Code code={JSON.stringify(input, null, 2)} />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: unknown;
  errorText?: string;
};

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) return null;
  let Output: ReactNode = <div>{output as ReactNode}</div>;
  if (typeof output === "object" && !isValidElement(output)) Output = <Code code={JSON.stringify(output, null, 2)} />;
  else if (typeof output === "string") Output = <Code code={output} />;
  return (
    <div className={cn("space-y-2 p-4", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs">{errorText ? "Error" : "Result"}</h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText ? "bg-destructive/10 text-destructive" : "bg-muted/50 text-foreground"
        )}
      >
        {errorText && <div className="p-3">{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
