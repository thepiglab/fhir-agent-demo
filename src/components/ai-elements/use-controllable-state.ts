// A small stand-in for @radix-ui/react-use-controllable-state: state that a parent may control
// (`prop` defined) or leave to the component (`defaultProp`), reporting changes via `onChange`.
import { useCallback, useRef, useState } from "react";

export function useControllableState<T>({
  prop,
  defaultProp,
  onChange,
}: {
  prop?: T;
  defaultProp: T;
  onChange?: (value: T) => void;
}): [T, (value: T) => void] {
  const [own, setOwn] = useState<T>(defaultProp);
  const controlled = prop !== undefined;
  const value = controlled ? (prop as T) : own;
  const changed = useRef(onChange);
  changed.current = onChange;
  const set = useCallback(
    (next: T) => {
      if (!controlled) setOwn(next);
      changed.current?.(next);
    },
    [controlled]
  );
  return [value, set];
}
