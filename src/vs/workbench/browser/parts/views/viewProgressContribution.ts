import { Disposable } from "@tuidom/core/common/disposable";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";

import type { ViewsService } from "./viewsService.ts";
import { ViewsServiceDIToken } from "./viewsService.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const ViewProgressContributionDIToken = token<ViewProgressContribution>("ViewProgressContribution");

/**
 * Мост `ProgressService` → заголовки view-секций: раскладывает кадры спиннера по
 * viewId и снимает их у тех, кто закончил. Свой набор показанных секций нужен
 * именно для снятия — сервис про закончившуюся операцию уже забыл, а заголовок
 * с ней остался бы крутиться вечно.
 *
 * Проводка отдельной контрибуцией, а не подпиской внутри `ViewsService`: тот —
 * презентационная инфраструктура, которой незачем знать про прогресс.
 */
export class ViewProgressContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [ProgressServiceDIToken, ViewsServiceDIToken] as const;

    private readonly shown = new Set<string>();

    public constructor(
        private readonly progress: ProgressService,
        private readonly views: ViewsService,
    ) {
        super();
        this.register(progress.onDidChange(() => this.sync()));
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
