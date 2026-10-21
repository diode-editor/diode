import * as path from "node:path";

import type { IEditorPane } from "./iEditorPane.ts";

/**
 * Отступление от эталона по решению человека: VS Code показывает удаление только
 * зачёркиванием (SGR 9), а его рисуют не все терминалы.
 */
export const DELETED_TAB_SUFFIX = " (deleted)";

/**
 * Тёзкам добавляется минимальный различающий суффикс пути (как в VS Code). Общая для
 * tab strip'а и оверлея Ctrl+Tab: списки разного порядка, но имена обязаны совпадать.
 */
export function computeTabLabels(
    editors: readonly IEditorPane[],
    displayName: (editor: IEditorPane) => string,
): string[] {
    const names = editors.map((editor) => displayName(editor));
    const groups = new Map<string, number[]>();
    names.forEach((name, i) => {
        const arr = groups.get(name);
        if (arr) arr.push(i);
        else groups.set(name, [i]);
    });

    const labels = [...names];
    for (const indices of groups.values()) {
        if (indices.length < 2) continue;
        const dirs = indices.map((i) => {
            const uri = editors[i].uri;
            // Гейт по схеме, а не «путь непустой»: fsPath у не-file схемы вернёт мусор, а не бросит.
            /* v8 ignore start -- defensive: одинаковый displayName бывает только у файлов */
            // Stryker disable next-line ConditionalExpression,ArrayDeclaration: ветка недостижима по той же причине, что и для покрытия
            if (uri.scheme !== "file") return [];
            /* v8 ignore stop */
            // Путь уже абсолютный: Uri.file идёт через path.resolve.
            return path.dirname(uri.fsPath).split(path.sep).filter(Boolean);
        });
        const maxK = Math.max(0, ...dirs.map((d) => d.length));
        indices.forEach((editorIndex, a) => {
            // Тёзки всегда различаются по пути (дедуп в openFile) — цикл находит
            // уникальный хвост не позже k = maxK.
            for (let k = 1; k <= maxK; k++) {
                const mine = dirs[a].slice(-k).join(path.sep);
                const collision = dirs.some((d, b) => b !== a && d.slice(-k).join(path.sep) === mine);
                if (!collision) {
                    labels[editorIndex] = `${names[editorIndex]} — ${mine}`;
                    return;
                }
            }
        });
    }
    // После различающего суффикса: тёзок различаем по пути, а не по удалённости.
    return labels.map((label, i) => (editors[i].isOrphaned === true ? label + DELETED_TAB_SUFFIX : label));
}
