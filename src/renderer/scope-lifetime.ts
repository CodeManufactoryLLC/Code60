import { useLayoutEffect, useMemo } from "react";

/** A scope's identity can recur; a disposed instance's work must never recur with it. */
export class ScopeLifetime {
  private generation = Symbol();
  private disposed = false;
  constructor(readonly identity: string) {}
  capture() {
    const generation = this.generation;
    return () => !this.disposed && generation === this.generation;
  }
  dispose() {
    this.disposed = true;
    this.generation = Symbol();
  }
  /** React effect replay can reactivate an owner, never its earlier operations. */
  activate() {
    this.disposed = false;
  }
}

export function useScopeLifetime(identity: string) {
  const scope = useMemo(() => new ScopeLifetime(identity), [identity]);
  useLayoutEffect(() => {
    scope.activate();
    return () => scope.dispose();
  }, [scope]);
  return scope;
}
