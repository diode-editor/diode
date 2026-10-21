import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { GIT_OP_COMMAND, type GitOpResult, parseGitOpResult } from "../common/gitProtocol.ts";

import { gitProgressTarget, gitProgressTitle } from "./gitProgress.ts";

const OP_NOTICE_MS = 5000;

/**
 * `null` — расширение не активно или канал упал. Специальные реакции (диалоги
 * auth/push-rejected/no-upstream) вызывающий наслаивает по `kind` через `silent`.
 */
export async function runGitOp(
    accessor: ServiceAccessor,
    op: string,
    params?: Record<string, unknown>,
    options?: { silent?: boolean },
): Promise<GitOpResult | null> {
    const commands = accessor.get(CommandRegistryDIToken);
    if (!commands.has(GIT_OP_COMMAND)) return null;
    const raw = await withGitProgress(accessor, op, () =>
        // Stryker disable next-line ArrowFunction: parseGitOpResult одинаково отвечает null и на null, и на undefined
        Promise.resolve(commands.execute(GIT_OP_COMMAND, { op, params })).catch(() => null),
    );
    const result = parseGitOpResult(raw);
    if (result === null) return null;
    if (!result.ok && options?.silent !== true) {
        showGitNotice(accessor, result.message);
    }
    return result;
}

/**
 * Внутри транспортных швов, а не у вызывающих: промис операции наверху не ждёт никто.
 * Заодно под прогресс попадает очередь мутаций расширения, и спиннер гаснет после
 * его refresh'а — когда список изменений сошёлся.
 */
export function withGitProgress<T>(accessor: ServiceAccessor, op: string, task: () => Promise<T>): Promise<T> {
    const progress = accessor.get(ProgressServiceDIToken);
    const { viewId, window } = gitProgressTarget(op);
    const title = gitProgressTitle(op);
    const inView = (): Promise<T> => progress.withProgress({ location: "view", viewId, title }, task);
    if (!window) return inView();
    // Stryker disable next-line StringLiteral: локация выбирается сравнением с "view", поэтому любая другая строка ведёт себя как "window"
    return progress.withProgress({ location: "window", title }, inView);
}

export function showGitNotice(accessor: ServiceAccessor, message: string): void {
    const handle = accessor.get(StatusBarServiceDIToken).addEntry({
        id: "scm.git.notice",
        text: `Git: ${message}`,
        alignment: "left",
        priority: 100,
    });
    setTimeout(() => {
        handle.dispose();
    }, OP_NOTICE_MS);
}
