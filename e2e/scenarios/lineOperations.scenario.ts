import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Строчные операции (VS Code lineOperations): перенос строки Alt+↑/↓, дубль
// Ctrl+Shift+Alt+↑/↓, удаление Ctrl+Shift+K (на legacy-терминале харнесса —
// аккорд-фолбэк Ctrl+K Ctrl+K) и клипборд пустого выделения
// (`editor.emptySelectionClipboard`): Ctrl+C без выделения копирует строку
// целиком, Ctrl+V кладёт её строкой выше курсорной. Кадры — единственный
// свидетель связки «бинд → команда → правка → перерисовка»; индикатор Ln/Col
// в статус-баре показывает, что каретка едет вместе со своей строкой.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "line-operations",
    title: "Строчные операции: move/copy/delete line, копия строки без выделения",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        const count = (t: string, needle: string): number => t.split(needle).length - 1;
        await editor.waitForText((t) => t.includes("greeting"));

        // Alt+↓ на первой строке: комментарий и `const greeting` меняются местами,
        // каретка едет со своей строкой (Ln 2 в статус-баре).
        await editor.sendKey("Alt+ArrowDown");
        await editor.waitForText((t) => t.includes("Ln 2"));
        await editor.capture("move-line-down");

        // Alt+↑ возвращает строку на место; каретка снова на комментарии.
        await editor.sendKey("Alt+ArrowUp");
        await editor.waitForText((t) => t.includes("Ln 1"));

        // Ctrl+Shift+Alt+↓: дубль строки, каретка на нижней копии.
        await editor.sendKey("Ctrl+Shift+Alt+ArrowDown");
        await editor.waitForText((t) => count(t, "// fixture") === 2);
        await editor.capture("copy-line-down");

        // Удаление строки-дубля. Сессия харнесса — legacy-терминал (индикатор
        // tier в статус-баре), где Ctrl+Shift+K неотличим от Ctrl+K: работает
        // аккорд-фолбэк Ctrl+K Ctrl+K — заодно кадр показывает, что он живой.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+K");
        await editor.waitForText((t) => count(t, "// fixture") === 1);
        await editor.capture("delete-line");

        // Ctrl+C без выделения уносит строку каретки целиком (`const greeting…`);
        // Ctrl+V строкой ниже кладёт её ВЫШЕ курсорной — линейная вставка VS Code.
        await editor.sendKey("Ctrl+C");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+V");
        await editor.waitForText((t) => count(t, "const greeting") === 2);
        await editor.capture("paste-copied-line");
    },
});
