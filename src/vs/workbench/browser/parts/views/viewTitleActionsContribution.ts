import { Disposable } from "@tuidom/core/common/disposable";

import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";

import type { ViewsService } from "./viewsService.ts";
import { ViewsServiceDIToken } from "./viewsService.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const ViewTitleActionsContributionDIToken = token<ViewTitleActionsContribution>("ViewTitleActionsContribution");

/**
 * Живой тулбар заголовков view: `when` и `enablement` их пунктов зависят от
 * контекст-ключей, а сам заголовок пересобирался только со сменой состава
 * секций. Отсюда и залипания: пара Collapse All / Expand All в Search
 * переключается по ключам, которые ставит сам список результатов, но заголовок
 * их не видел.
 *
 * Событие уже коалесцировано сервисом (одно на тик, только реально
 * изменившиеся ключи), поэтому пере-резолв здесь безусловный: разбирать, какие
 * именно ключи задеты, значило бы парсить when-выражения всех пунктов.
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
