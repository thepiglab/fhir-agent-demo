// AI Elements Message, adapted: no `ai` types (a local role type), no streamdown (answers are
// JSON rendered as generative UI, so MessageResponse is plain text), no branches or attachments.
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";

export type MessageRole = "user" | "assistant" | "system";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: MessageRole;
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full flex-col gap-2",
      from === "user" ? "is-user ml-auto max-w-[85%] items-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = ComponentProps<"div">;

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex min-w-0 max-w-full flex-col gap-2 text-[15px] leading-7",
      "group-[.is-user]:w-fit group-[.is-user]:rounded-3xl group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:w-full group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({ className, children, ...props }: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

/** An icon button under a message; needs a TooltipProvider above it when `tooltip` is set. */
export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
};

export type MessageResponseProps = HTMLAttributes<HTMLDivElement> & { children: string };

/** Plain-text response: paragraphs split on blank lines. */
export const MessageResponse = memo(({ className, children, ...props }: MessageResponseProps) => (
  <div className={cn("space-y-4 text-[15px] leading-7", className)} {...props}>
    {children
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p, i) => (
        <p className="whitespace-pre-wrap" key={i}>
          {p}
        </p>
      ))}
  </div>
));
MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({ className, children, ...props }: MessageToolbarProps) => (
  <div className={cn("mt-2 flex w-full items-center justify-between gap-4", className)} {...props}>
    {children}
  </div>
);
