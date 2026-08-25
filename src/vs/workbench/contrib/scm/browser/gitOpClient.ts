import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { GIT_OP_COMMAND, parseGitOpResult, type GitOpResult } from "../common/gitProtocol.ts";

import { gitProgressTarget, gitProgressTitle } from "./gitProgress.ts";

/** Сколько висит notice об ошибке git-операции в статус-баре. */
const OP_NOTICE_MS = 5000;

/**
 * Исполняет операцию диспетчера `diode.git.op` и разбирает envelope. Расширение
 * не активно или канал упал — `null` (вызывающий трактует как «git недоступен»).
 * Ошибка операции по умолчанию показывается транзиентным notice; специальные
 * реакции (auth/push-rejected/no-upstream — диалоги) наслаиваются вызывающим
 * по `kind` через `silent`.
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
 * Обёртка прогресса вокруг мутации git: спиннер в заголовке своей секции, а для
 * сетевых операций — ещё и запись в статус-баре (их видно, когда в сайдбаре
 * открыт не Source Control).
 *
 * Стоит внутри транспортных швов, а не у вызывающих: промис операции наверху не
 * ждёт никто — ни кнопка Commit, ни статус-бар, ни кейбинд, ни палитра, — а
 * здесь он есть. Заодно под прогресс попадает ожидание в очереди мутаций
 * расширения, и спиннер гаснет уже после его refresh'а, то есть когда список
 * изменений сошёлся.
 */
export function withGitProgress<T>(accessor: ServiceAccessor, op: string, task: () => Promise<T>): Promise<T> {
    const progress = accessor.get(ProgressServiceDIToken);
    const { viewId, window } = gitProgressTarget(op);
    const title = gitProgressTitle(op);
    const inView = (): Promise<T> => progress.withProgress({ location: "view", viewId, title }, task);
    if (!window) return inView();
    return progress.withProgress({ location: "window", title }, inView);
}

/** Транзиентный notice в статус-баре (тостов в Diode нет). */
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
