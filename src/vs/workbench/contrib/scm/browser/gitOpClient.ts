import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { GIT_OP_COMMAND, parseGitOpResult, type GitOpResult } from "../common/gitProtocol.ts";

/** Сколько висит notice об ошибке git-операции в статус-баре. */
const OP_NOTICE_MS = 5000;

/**
 * Исполняет операцию диспетчера `vexx.git.op` и разбирает envelope. Расширение
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
    const raw = await Promise.resolve(commands.execute(GIT_OP_COMMAND, { op, params })).catch(() => null);
    const result = parseGitOpResult(raw);
    if (result === null) return null;
    if (!result.ok && options?.silent !== true) {
        showGitNotice(accessor, result.message);
    }
    return result;
}

/** Транзиентный notice в статус-баре (тостов в Vexx нет). */
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
