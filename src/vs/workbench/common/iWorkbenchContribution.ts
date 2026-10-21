import type { IDisposable } from "../../base/common/lifecycle.ts";
import type { Token } from "../../platform/instantiation/common/diContainer.ts";
import type { LifecyclePhase } from "../services/lifecycle/common/lifecyclePhase.ts";

/**
 * Как `IWorkbenchContribution` vscode: вся работа — в конструкторе, `dispose()` её
 * сматывает. У нашего DI нет Delayed-прокси: тяжёлый сервис в `static dependencies`
 * сконструируется в момент прогона фазы — резолвь его лениво через {@link ServiceAccessor}.
 */
export type IWorkbenchContribution = IDisposable;

/**
 * Аналог `WorkbenchPhase` vscode:
 * - `blockStartup` (≈ `BlockStartup`) — в конструкторе `WorkbenchComponent`, до
 *   открытия папки и старта extension host'а;
 * - `ready` (≈ `BlockRestore`) — в `WorkbenchComponent.mount()`, до открытия файлов;
 * - `afterRestored` (≈ `AfterRestored`) — после кадра с подсветкой, первым делом
 *   перехода в `eventually`. Не на фазе `restored`: она наступает до кадра с
 *   текстом, и всё, что висит на ней, откладывало бы кадр;
 * - `eventually` — idle после первого кадра.
 */
export type WorkbenchContributionPhase =
    | "blockStartup"
    | "afterRestored"
    | Extract<LifecyclePhase, "ready" | "eventually">;

export interface IWorkbenchContributionRegistration {
    readonly token: Token<IWorkbenchContribution>;
    readonly phase: WorkbenchContributionPhase;
}
