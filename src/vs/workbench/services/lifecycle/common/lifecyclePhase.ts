/**
 * Фаза старта окна (аналог vscode `LifecyclePhase`), монотонно растёт:
 * - `starting` — сервисы собираются, view ещё не смонтирована;
 * - `ready` — view смонтирована, лёгкие сервисы готовы (`WorkbenchComponent.mount`);
 * - `restored` — стартовые файлы открыты или сессия восстановлена;
 * - `eventually` — первый кадр нарисован, можно делать отложенное.
 *
 * Тип живёт в `common/`: по фазам инстанцируются workbench-contributions
 * (`workbench/common`), а двигает фазы `LifecycleService` (`browser/`).
 */
export type LifecyclePhase = "starting" | "ready" | "restored" | "eventually";

/** Фазы в порядке наступления. */
export const LIFECYCLE_PHASES: readonly LifecyclePhase[] = ["starting", "ready", "restored", "eventually"];
