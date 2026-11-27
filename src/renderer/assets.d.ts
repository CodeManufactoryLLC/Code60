/// <reference types="vite/client" />
declare module "*.css";
declare module "*?worker" {
  const WorkerConstructor: { new (): Worker };
  export default WorkerConstructor;
}
declare module "@carbon/icons/es/*" {
  const icon: Record<string, unknown>;
  export default icon;
}
