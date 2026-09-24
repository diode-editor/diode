import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Пункт статус-бара от расширения (`window.createStatusBarItem`): фикстурное
// расширение `status-bar-demo` ставит справа пункт `Demo` при активации, вешает
// на него свою команду и правит текст из неё же. Кадры показывают весь круг:
// пункт в полосе → клик исполнил команду расширения (счётчик в тексте) →
// левая пара по приоритетам → длинный текст усечён, встроенные сегменты целы →
// `dispose()` убрал пункт.

// Markdown, а не .ts, и без папки-воркспейса: иначе полосу делят с нами
// сегменты SCM и спиннер запуска tsserver, и её раскладка плывёт по ходу
// сценария.
const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-status-bar-demo");

/** Исполняет команду расширения через палитру (F1 → заголовок → Enter). */
async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "status-bar-extension",
    title: "Status bar item contributed by an extension",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux (как
    // inline-completion — субпроцесс расширений на Windows флейкает).
    skipOn: ["win32"],
    async run(editor) {
        // Пункт появляется, как только расширение активировалось.
        await editor.waitForNode("#statusBarItem-extensions-status-bar-demo", { timeoutMs: 20_000 });
        await editor.capture("item");

        // Клик по пункту исполняет команду РАСШИРЕНИЯ, и она же правит текст —
        // значит, клик доехал до его кода и вернулся обратно в полосу.
        // clickNode, а не координаты из `item`: сегменты полосы переезжают,
        // когда соседи меняют ширину.
        await editor.clickNode("#statusBarItem-extensions-status-bar-demo");
        await editor.waitForText((t) => t.includes("Demo · clicked 1"), { timeoutMs: 5000 });
        await editor.capture("clicked");

        // alignment + priority: пара пунктов слева в порядке L-high, L-low.
        await runCommand(editor, "Status Bar Demo: Create Left Pair");
        await editor.waitForText((t) => t.includes("L-high") && t.includes("L-low"), { timeoutMs: 5000 });
        await editor.capture("left-pair");

        // Длинный текст усечён многоточием — встроенные сегменты остаются целыми.
        await runCommand(editor, "Status Bar Demo: Long Text");
        await editor.waitForText((t) => t.includes("Long Long") && t.includes("…"), { timeoutMs: 5000 });
        await editor.capture("truncated");

        // dispose() снимает пункт с полосы; соседние сегменты смыкаются.
        await runCommand(editor, "Status Bar Demo: Dispose");
        await editor.waitForText((t) => !t.includes("Long Long"), { timeoutMs: 5000 });
        await editor.capture("disposed");
    },
});
