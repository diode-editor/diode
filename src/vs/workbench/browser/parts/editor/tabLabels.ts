import * as path from "node:path";

import type { IEditorPane } from "./iEditorPane.ts";

/**
 * Хвост метки вкладки удалённого файла (orphaned). Отступление от эталона по
 * решению человека: VS Code 1.127 показывает удаление только зачёркиванием и
 * цветом, а зачёркивание (SGR 9) рисуют не все терминалы — текст виден везде.
 */
export const DELETED_TAB_SUFFIX = " (deleted)";

/**
 * Метки вкладок для набора редакторов ОДНОЙ группы: обычно это имя файла, но
 * если несколько открытых файлов делят один basename, к ним добавляется
 * минимальный различающий суффикс родительского пути (как в VS Code), чтобы
 * вкладки нельзя было спутать. У удалённого файла — ещё и {@link DELETED_TAB_SUFFIX}. Общая для tab strip'а
 * ({@link import("./editorGroupComponent.ts").EditorGroupComponent}) и оверлея
 * переключателя Ctrl+Tab
 * ({@link import("./tabSwitcherComponent.ts").TabSwitcherComponent}) — списки
 * разного порядка, но имена в них обязаны совпадать.
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
            // Гейт по схеме, а не по «путь непустой»: fsPath у не-file схемы вернёт
            // мусор, а не бросит. В группу тёзок не-file и не попадёт — метки
            // безымянных буферов уникальны по построению (Untitled-N).
            /* v8 ignore start -- defensive: одинаковый displayName бывает только у файлов */
            // Stryker disable next-line ConditionalExpression,ArrayDeclaration: ветка недостижима по той же причине, что и для покрытия
            if (uri.scheme !== "file") return [];
            /* v8 ignore stop */
            // Путь уже абсолютный: подъём в Uri.file идёт через path.resolve.
            return path.dirname(uri.fsPath).split(path.sep).filter(Boolean);
        });
        const maxK = Math.max(0, ...dirs.map((d) => d.length));
        indices.forEach((editorIndex, a) => {
            // Минимальный хвост родительского пути, отличающий этот файл от
            // остальных в группе. Файлы-тёзки всегда различаются по пути (дедуп
            // в openFile), поэтому цикл гарантированно находит уникальный хвост
            // не позже k = maxK (там хвост — весь путь); не нашёл (недостижимо) —
            // метка остаётся именем без суффикса.
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
    // Хвост — после различающего суффикса: тёзок различаем по пути, а не по
    // тому, удалён ли файл.
    return labels.map((label, i) => (editors[i].isOrphaned === true ? label + DELETED_TAB_SUFFIX : label));
}
