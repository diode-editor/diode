import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { CommentThreadCollapsibleState } from "./vscodeTypes.ts";

/**
 * Заглушка до честных комментариев: формы эталонные, ничего не рисуется.
 * Claude Code вешает тред на каждый ханк предложенного диффа — отсутствие
 * члена роняло бы показ диффа целиком, а без тредов дифф принимается командами.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

/** Дефолты — эталонные (`ExtHostCommentThread`); поля записываемые — расширения правят их после создания. */
function createInertCommentThread(
    uri: vscode.Uri,
    range: vscode.Range | undefined,
    comments: readonly vscode.Comment[],
): vscode.CommentThread {
    return {
        uri,
        range,
        comments,
        collapsibleState: CommentThreadCollapsibleState.Collapsed,
        canReply: true,
        contextValue: undefined,
        label: undefined,
        state: undefined,
        dispose: (): void => undefined,
    };
}

export function createCommentsNoop(rpc: SubprocessRpc): typeof vscode.comments {
    const reported = new Set<string>();

    // Главное — первым: строка Output обрезается шириной панели.
    function reportUnsupported(id: string): void {
        if (reported.has(id)) return;
        reported.add(id);
        rpc.notify("output.append", {
            channel: OUTPUT_CHANNEL,
            label: OUTPUT_LABEL,
            level: "warn",
            value: `комментарии "${id}" в TUI пока не рисуются — тредов не будет, остальное расширение работает`,
        });
    }

    return {
        createCommentController: (id: string, label: string): vscode.CommentController => {
            reportUnsupported(id);
            return {
                id,
                label,
                options: undefined,
                commentingRangeProvider: undefined,
                reactionHandler: undefined,
                createCommentThread: (uri, range, comments) => createInertCommentThread(uri, range, comments),
                dispose: (): void => undefined,
            };
        },
    };
}
