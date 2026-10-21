import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

// Stryker disable next-line StringLiteral: token() returns a unique Token matched by reference; the string is a label
export const ScmBusyContextContributionDIToken = token<ScmBusyContextContribution>("ScmBusyContextContribution");

/**
 * Counterpart of `operationInProgress` in the VS Code git extension. The source is SCM section busyness,
 * not "the extension is doing something": a background refresh from the watcher does not (and must not)
 * disable commands.
 */
export class ScmBusyContextContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [ProgressServiceDIToken, ContextKeyServiceDIToken] as const;

    public constructor(
        private readonly progress: ProgressService,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        this.register(
            progress.onDidChange(() => {
                this.update();
            }),
        );
        this.update();
    }

    private update(): void {
        const busy = this.progress.isBusy(SCM_CHANGES_VIEW_ID) || this.progress.isBusy(SCM_GRAPH_VIEW_ID);
        this.contextKeys.set("gitOperationInProgress", busy);
    }
}
