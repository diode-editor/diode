import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { GIT_OP_COMMAND, type GitOpResult, parseGitOpResult } from "../common/gitProtocol.ts";

import { gitProgressTarget, gitProgressTitle } from "./gitProgress.ts";

const OP_NOTICE_MS = 5000;

/**
 * `null` means the extension is inactive or the channel failed. The caller layers special reactions
 * (auth/push-rejected/no-upstream dialogs) by `kind` via `silent`.
 */
export async function runGitOp(
    accessor: ServiceAccessor,
    op: string,
    params?: Record<string, unknown>,
    options?: { silent?: boolean; viewId?: string },
): Promise<GitOpResult | null> {
    const commands = accessor.get(CommandRegistryDIToken);
    if (!commands.has(GIT_OP_COMMAND)) return null;
    const raw = await withGitProgress(
        accessor,
        op,
        () =>
            // Stryker disable next-line ArrowFunction: parseGitOpResult returns null for both null and undefined
            Promise.resolve(commands.execute(GIT_OP_COMMAND, { op, params })).catch(() => null),
        options?.viewId,
    );
    const result = parseGitOpResult(raw);
    if (result === null) return null;
    if (!result.ok && options?.silent !== true) {
        showGitNotice(accessor, result.message);
    }
    return result;
}

/**
 * Inside the transport seams, not in callers: nobody upstream awaits the operation promise.
 * This also puts the extension's mutation queue under progress, and the spinner stops after
 * its refresh, once the changes list has settled.
 */
export function withGitProgress<T>(
    accessor: ServiceAccessor,
    op: string,
    task: () => Promise<T>,
    targetViewId?: string,
): Promise<T> {
    const progress = accessor.get(ProgressServiceDIToken);
    const { viewId, window } = gitProgressTarget(op, targetViewId);
    const title = gitProgressTitle(op);
    const inView = (): Promise<T> => progress.withProgress({ location: "view", viewId, title }, task);
    if (!window) return inView();
    // Stryker disable next-line StringLiteral: only "view" is compared, any other string acts as "window"
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
