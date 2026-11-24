export interface EngineArtifact {
  name: string;
  integrity: string;
}
export const macEngines: Record<"0.1.0-staging.18" | "0.1.0-staging.20", EngineArtifact>;
export const linuxEngines: Record<"0.1.1", EngineArtifact>;
export function workflowTarget(os?: string, arch?: string): Record<string, EngineArtifact>;
