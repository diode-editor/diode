import { Disposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";

import type { ViewsService } from "./viewsService.ts";
import { ViewsServiceDIToken } from "./viewsService.ts";

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string is only a debug label
export const ViewProgressContributionDIToken = token<ViewProgressContribution>("ViewProgressContribution");

/**
 * Tracks its own set of sections showing a spinner so it can remove it: the service has already
 * forgotten the finished operation, and the header would spin forever. A separate contribution so
 * `ViewsService` doesn't know about progress.
 */
export class ViewProgressContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [ProgressServiceDIToken, ViewsServiceDIToken] as const;

    private readonly shown = new Set<string>();

    public constructor(
        private readonly progress: ProgressService,
        private readonly views: ViewsService,
    ) {
        super();
        this.register(
            progress.onDidChange(() => {
                this.sync();
            }),
        );
    }

    private sync(): void {
        const active = this.progress.viewProgress();
        for (const [viewId, frame] of active) {
            this.shown.add(viewId);
            this.views.setViewSpinner(viewId, frame.spinner);
        }
        for (const viewId of [...this.shown]) {
            if (active.has(viewId)) continue;
            this.shown.delete(viewId);
            this.views.setViewSpinner(viewId, null);
        }
    }
}
