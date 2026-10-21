import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";

import type { ViewsService } from "./viewsService.ts";
import { ViewsServiceDIToken } from "./viewsService.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const ViewTitleActionsContributionDIToken = token<ViewTitleActionsContribution>("ViewTitleActionsContribution");

/**
 * `when` и `enablement` пунктов заголовка зависят от контекст-ключей, а заголовок сам
 * пересобирается только со сменой состава секций (залипала пара Collapse All / Expand All
 * в Search). Пере-резолв безусловный: событие уже коалесцировано, а разбирать задетые ключи
 * значило бы парсить when-выражения всех пунктов.
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
