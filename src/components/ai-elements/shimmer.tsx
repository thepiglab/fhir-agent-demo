// AI Elements Shimmer, adapted: a CSS gradient sweep (the `text-shimmer` keyframes in
// src/styles/app.css) instead of motion/react.
import { cn } from "@/lib/utils";
import { type CSSProperties, type ElementType, memo } from "react";

export type TextShimmerProps = {
  children: string;
  as?: ElementType;
  className?: string;
  /** Seconds per sweep. */
  duration?: number;
};

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
}: TextShimmerProps) => (
  <Component
    className={cn(
      "inline-block bg-clip-text text-transparent [background-size:200%_100%] motion-reduce:animate-none motion-reduce:text-muted-foreground",
      className
    )}
    style={
      {
        backgroundImage:
          "linear-gradient(90deg, var(--color-muted-foreground) 0%, var(--color-muted-foreground) 35%, var(--color-foreground) 50%, var(--color-muted-foreground) 65%, var(--color-muted-foreground) 100%)",
        animation: `text-shimmer ${duration}s linear infinite`,
      } as CSSProperties
    }
  >
    {children}
  </Component>
);

export const Shimmer = memo(ShimmerComponent);
