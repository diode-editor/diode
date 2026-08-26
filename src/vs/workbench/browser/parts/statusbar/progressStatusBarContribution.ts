import { Disposable } from "@tuidom/core/common/disposable";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

export const ProgressStatusBarContributionDIToken =
    // Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
    token<ProgressStatusBarContribution>("ProgressStatusBarContribution");

/** Тот же приоритет, что у прогресса расширений: левее chord-хинта, правее terminal-env. */
const PROGRESS_PRIORITY = 60;

/**
 * Прогресс локации `window` в статус-баре: спиннер с подписью, пока идёт
 * долгая операция. Нужен там, где заголовка секции не видно — сетевой push при
 * открытом Explorer'е. Запись транзиентная и без `name`: в меню видимости
 * сегментов ей делать нечего.
 */
export class ProgressStatusBarContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [ProgressServiceDIToken, StatusBarServiceDIToken] as const;

    private handle: IStatusBarEntryHandle | null = null;

    public constructor(
        private readonly progress: ProgressService,
        private readonly statusBar: StatusBarService,
    ) {
        super();
        this.register(progress.onDidChange(() => this.sync()));
        this.register({ dispose: () => this.clear() });
    }

    private sync(): void {
        const frame = this.progress.windowProgress();
        if (frame === null) {
            this.clear();
            return;
        }
        const text = `${frame.spinner} ${frame.title}`;
        if (this.handle === null) {
            this.handle = this.statusBar.addEntry({
                id: "status.progress",
                text,
                alignment: "left",
                priority: PROGRESS_PRIORITY,
            });
            return;
        }
        this.handle.update({ text });
    }

    private clear(): void {
        this.handle?.dispose();
        this.handle = null;
    }
}
