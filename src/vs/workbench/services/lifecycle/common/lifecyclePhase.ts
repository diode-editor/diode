/**
 * Аналог vscode `LifecyclePhase`, монотонно растёт:
 * - `starting` — сервисы собираются, view ещё не смонтирована;
 * - `ready` — view смонтирована, лёгкие сервисы готовы (`WorkbenchComponent.mount`);
 * - `restored` — стартовые файлы открыты или сессия восстановлена;
 * - `eventually` — первый кадр нарисован, можно делать отложенное.
 */
export type LifecyclePhase = "starting" | "ready" | "restored" | "eventually";

export const LIFECYCLE_PHASES: readonly LifecyclePhase[] = ["starting", "ready", "restored", "eventually"];
