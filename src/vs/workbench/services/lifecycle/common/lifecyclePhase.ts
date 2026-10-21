/**
 * Counterpart of vscode `LifecyclePhase`, grows monotonically:
 * - `starting`: services are being built, the view is not mounted yet;
 * - `ready`: the view is mounted, lightweight services are ready (`WorkbenchComponent.mount`);
 * - `restored`: startup files are open or the session is restored;
 * - `eventually`: the first frame is drawn, deferred work may run.
 */
export type LifecyclePhase = "starting" | "ready" | "restored" | "eventually";

export const LIFECYCLE_PHASES: readonly LifecyclePhase[] = ["starting", "ready", "restored", "eventually"];
