import type { IDisposable } from "@tuidom/all/common/disposable";
import type { Token } from "../../platform/instantiation/common/diContainer.ts";

/**
 * Workbench-contribution — самодостаточная единица фич-проводки поверх сервисов
 * и компонентов слоя Workbench (аналог `IWorkbenchContribution` в VS Code).
 *
 * Контракт — маркер: вся работа делается в конструкторе (подписки на события
 * сервисов, публикация UI, регистрация хэндлеров), а `dispose()` её сматывает.
 * Отдельного метода активации нет — инстанцирование класса И ЕСТЬ активация.
 * Прообраз в кодовой базе — `EditorStatusContribution`/`TerminalEnvStatusContribution`.
 *
 * Правило под наш DI (ленив по токену, без Delayed-прокси): тяжёлые сервисы НЕ
 * класть в `static dependencies` — иначе они сконструируются в момент прогона
 * фазы. Тяжёлое резолвить лениво через {@link ServiceAccessor} внутри колбэков.
 */
export interface IWorkbenchContribution extends IDisposable {}

/**
 * Фаза жизненного цикла, на которой инстанцируется contribution:
 * - `restored` — синхронно в `WorkbenchComponent.mount()` (view построена,
 *   лёгкие сервисы готовы);
 * - `eventually` — idle после первого кадра (из `main.ts`, `setImmediate`) — для
 *   отложенной/тяжёлой работы, не влияющей на старт.
 */
export type WorkbenchContributionPhase = "restored" | "eventually";

/** Запись в реестре: DI-токен contribution'а + его фаза. */
export interface IWorkbenchContributionRegistration {
    readonly token: Token<IWorkbenchContribution>;
    readonly phase: WorkbenchContributionPhase;
}
