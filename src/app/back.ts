import { useEffect, useRef } from 'react';

// Android back button: the most recently opened sheet/dialog closes first.
const stack: Array<() => void> = [];

export function useBackHandler(active: boolean, handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const h = () => ref.current();
    stack.push(h);
    return () => {
      const i = stack.lastIndexOf(h);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}

/** Returns true when an open sheet/dialog consumed the back press. */
export function handleBack(): boolean {
  const h = stack[stack.length - 1];
  if (!h) return false;
  h();
  return true;
}
