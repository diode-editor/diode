import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `search.useIgnoreFiles` на дефолте: Quick Open и поиск уважают `.gitignore`.
//
// Симптом заявки — «слишком много мусора в поиске файлов из quick pick»: свой
// обход ФС у Quick Open `.gitignore` не знал, и всё, что игнорирует git, ехало
// в список. Теперь индекс строится `rg --files`, как у эталона.
//
// Фикстура: `.gitignore` с `generated/` и `*.log`; один и тот же токен — в
// трёх файлах:
//
// - `src/app.ts` — своё: видно везде;
// - `generated/client.ts`, `server.log` — проигнорированы `.gitignore`: в
//   дереве ВИДНЫ (`explorer.excludeGitIgnore` у эталона по умолчанию `false`),
//   а в Quick Open и в поиске их нет.
//
// NB: файлы фикстуры добавлены в git через `git add -f` — её же `.gitignore`
// игнорирует их и для git.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "ignoreFiles");

export default defineScenario({
    name: "ignore-files",
    title: "search.useIgnoreFiles: .gitignore в Quick Open и поиске",
    open: [sampleDir],
    cols: 110,
    rows: 26,
    // Настоящий бинд поиска — Ctrl+Shift+F, в key-DSL он не выражается (нужен
    // kitty/csi-u терминал), поэтому команда повешена на F6, как в сценарии
    // searchInFiles.
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(editor) {
        // Дерево: проигнорированное на месте — оно не скрыто, а только не ищется.
        await editor.waitForText(
            (t) => t.includes("EXPLORER") && t.includes("generated") && t.includes("server.log") && t.includes("src"),
        );
        await editor.capture("tree");

        // Quick Open: только своё — ни `generated/client.ts`, ни `server.log`.
        await editor.sendKey("Ctrl+P");
        await editor.waitForText((t) => {
            const list = quickOpenText(t);
            return (
                list.includes("app.ts") &&
                list.includes(".gitignore") &&
                !list.includes("client.ts") &&
                !list.includes("server.log")
            );
        });
        await editor.capture("quick-open");
        await editor.sendKey("Escape");

        // Поиск по содержимому: токен найден в одном файле из трёх.
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("SEARCH"));
        for (const ch of "quietHarborLamp") {
            await editor.sendKey(ch);
        }
        await editor.waitForText((t) => t.includes("1 results in 1 file") && t.includes("app.ts"));
        await editor.capture("search");
    },
});

/**
 * Текст попапа Quick Open: правее его левой рамки и ниже заголовка. Дерево
 * Explorer'а слева на тех же строках показывает `server.log` — весь кадр для
 * проверки «в списке нет» не годится.
 */
function quickOpenText(frame: string): string {
    const lines = frame.split("\n");
    const top = lines.findIndex((line) => line.includes("Go to File"));
    if (top === -1) return "";
    const left = lines[top].lastIndexOf("│", lines[top].indexOf("Go to File"));
    return lines
        .slice(top)
        .map((line) => line.slice(left))
        .join("\n");
}
