import { Disposable } from "@tuidom/core/common/disposable";

import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const ScmBusyContextContributionDIToken = token<ScmBusyContextContribution>("ScmBusyContextContribution");

/**
 * Публикует контекст-ключ `gitOperationInProgress` из живых прогрессов SCM —
 * аналог `operationInProgress`, который в VS Code выставляет git-расширение.
 * На нём висит `enablement` мутирующих git-команд: пока операция идёт, они
 * гаснут.
 *
 * Источник — занятость секций Source Control, а НЕ факт «расширение сейчас
 * что-то делает»: наружу расширение этого не публикует, так что фоновый refresh
 * по watcher'у команд не гасит (и не должен — он не наш).
 */
export class ScmBusyContextContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [ProgressServiceDIToken, ContextKeyServiceDIToken] as const;

    public constructor(
        private readonly progress: ProgressService,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        this.register(progress.onDidChange(() => this.update()));
        this.update();
    }

    private update(): void {
        const busy = this.progress.isBusy(SCM_CHANGES_VIEW_ID) || this.progress.isBusy(SCM_GRAPH_VIEW_ID);
        this.contextKeys.set("gitOperationInProgress", busy);
    }
}
