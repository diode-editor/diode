import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { CommentThreadCollapsibleState } from "./vscodeTypes.ts";

/**
 * Stub until real comments exist: shapes follow upstream, nothing is rendered.
 * Claude Code attaches a thread to every hunk of a proposed diff — a missing
 * member would break showing the whole diff, while without threads the diff is accepted via commands.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

/** Defaults follow upstream (`ExtHostCommentThread`); fields are writable — extensions edit them after creation. */
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

    // The essential part first: an Output line is clipped to the panel width.
    function reportUnsupported(id: string): void {
        if (reported.has(id)) return;
        reported.add(id);
        rpc.notify("output.append", {
            channel: OUTPUT_CHANNEL,
            label: OUTPUT_LABEL,
            level: "warn",
            value: `comments "${id}" are not rendered in TUI yet — no threads, the rest of the extension works`,
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
