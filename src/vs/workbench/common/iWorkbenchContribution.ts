import type { IDisposable } from "../../base/common/lifecycle.ts";
import type { Token } from "../../platform/instantiation/common/diContainer.ts";
import type { LifecyclePhase } from "../services/lifecycle/common/lifecyclePhase.ts";

/**
 * Like vscode's `IWorkbenchContribution`: all work happens in the constructor, `dispose()` undoes it.
 * Our DI has no Delayed proxy: a heavy service in `static dependencies` is constructed when
 * the phase runs, so resolve it lazily through {@link ServiceAccessor}.
 */
export type IWorkbenchContribution = IDisposable;

/**
 * Counterpart of vscode's `WorkbenchPhase`:
 * - `blockStartup` (≈ `BlockStartup`) — in the `WorkbenchComponent` constructor, before
 *   the folder is opened and the extension host starts;
 * - `ready` (≈ `BlockRestore`) — in `WorkbenchComponent.mount()`, before files are opened;
 * - `afterRestored` (≈ `AfterRestored`) — after the frame with syntax highlighting, first thing in the
 *   transition to `eventually`. Not on the `restored` phase: it comes before the frame with
 *   text, and anything hooked to it would delay that frame;
 * - `eventually` — idle after the first frame.
 */
export type WorkbenchContributionPhase =
    | "blockStartup"
    | "afterRestored"
    | Extract<LifecyclePhase, "ready" | "eventually">;

export interface IWorkbenchContributionRegistration {
    readonly token: Token<IWorkbenchContribution>;
    readonly phase: WorkbenchContributionPhase;
}
