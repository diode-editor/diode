import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { CommentThreadCollapsibleState } from "./vscodeTypes.ts";

/**
 * `vscode.comments` как заглушка до честных комментариев (треды в гаттере
 * редактора и панель Comments). Тот же принцип, что у деревьев
 * (treeViewNoop.ts): контроллер и треды — настоящие объекты с эталонной
 * формой, присваивания полей проходят, но ничего не рисуется и провайдер
 * диапазонов никто не зовёт.
 *
 * Claude Code заводит контроллер лениво, на первом предложенном диффе, и вешает
 * на каждый ханк тред с `label`/`contextValue`/`state` — отсутствие члена
 * роняло бы показ диффа целиком, а без тредов дифф остаётся рабочим: принять
 * или отклонить его можно командами.
 *
 * Человеку уходит одна warn-строка в Output на каждый id контроллера за жизнь
 * субпроцесса — иначе единственным следом остался бы `diode.log`.
 */

/** Канал панели Output для отказа: `extensions` уже в реестре ядра (label «Extensions»). */
const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

/**
 * Тред с эталонными дефолтами (`ExtHostCommentThread`): свёрнут, ответить
 * можно, состояние не задано. Поля записываемые — расширения правят их после
 * создания; `dispose` отписываться не от чего.
 */
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
