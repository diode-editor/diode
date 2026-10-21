import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";

import type { ViewsService } from "./viewsService.ts";
import { ViewsServiceDIToken } from "./viewsService.ts";

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string is only a debug label
export const ViewTitleActionsContributionDIToken = token<ViewTitleActionsContribution>("ViewTitleActionsContribution");

/**
 * `when` and `enablement` of title items depend on context keys, while the title itself is only
 * rebuilt when the set of sections changes (the Collapse All / Expand All pair got stuck in Search).
 * Re-resolving is unconditional: the event is already coalesced, and checking which keys changed
 * would mean parsing the when-expressions of every item.
 */
export class ViewTitleActionsContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [ContextKeyServiceDIToken, ViewsServiceDIToken] as const;

    public constructor(contextKeys: ContextKeyService, views: ViewsService) {
        super();
        this.register(
            contextKeys.onDidChange(() => {
                views.refreshTitleActions();
            }),
        );
    }
}
