import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import type { ProgressService } from "../../../platform/progress/common/progressService.ts";
import type { ViewsService } from "../../browser/parts/views/viewsService.ts";
import type { WireProgressLocation } from "../common/wireTypes.ts";

export type ViewProgressLocation = Exclude<WireProgressLocation, "window" | "notification">;

/**
 * `withProgress` in SourceControl or `{ viewId }`, as upstream `ProgressService` (`handleStringLocation`):
 * a container id is the container's progress, a view id the view's, only the indicator — `message`,
 * `increment` and Cancel are not shown. Here the indicator is the header spinner of the view, and a
 * container's is its first view's. Upstream throws "Bad progress location" into the log for an
 * unknown id and the extension's task runs on without UI; so does this.
 */
export class ExtensionViewProgressAdapter {
    private readonly running = new Map<number, () => void>();

    /** `sourceControlViewId`: upstream `ProgressLocation.Scm` is the main SCM view (`workbench.scm`). */
    public constructor(
        private readonly views: Pick<
            ViewsService,
            "getViewContainerByViewId" | "getViewContainerLocation" | "getContainerViews"
        >,
        private readonly progress: Pick<ProgressService, "withProgress">,
        private readonly logger: Pick<ILogger, "error">,
        private readonly sourceControlViewId: string,
    ) {}

    public start(handle: number, location: ViewProgressLocation, title: string): void {
        const id = location === "sourceControl" ? this.sourceControlViewId : location.viewId;
        const viewId = this.resolve(id);
        if (viewId === null) {
            this.logger.error(`Bad progress location: ${id}`);
            return;
        }
        void this.progress.withProgress(
            { location: "view", viewId, title, passive: true },
            () =>
                new Promise<void>((resolve) => {
                    this.running.set(handle, resolve);
                }),
        );
    }

    public end(handle: number): void {
        this.running.get(handle)?.();
        // Stryker disable next-line CallExpression: equivalent — a second resolve of a settled promise is a no-op, so a kept entry only costs memory
        this.running.delete(handle);
    }

    /** Upstream order: a container id first, then a view id. */
    private resolve(id: string): string | null {
        if (this.views.getViewContainerLocation(id) !== null) {
            return this.views.getContainerViews(id)[0]?.id ?? null;
        }
        return this.views.getViewContainerByViewId(id) === null ? null : id;
    }
}
