import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Канал переключаем командой `workbench.action.output.show.<id>` — тем же путём, что и селектор;
// раскрытие списка мышью — в `selectBoxElement.test.ts`. Клавиши — user-кейбинды: палитра
// возвращает фокус меню-бару. Не O: `ESC O` — префикс SS3 (`ESC O P` = F1).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "output",
    title: "Output: лог подсистемы в нижней панели",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    userKeybindings: [
        { key: "alt+u", command: "workbench.action.output.toggleOutput" },
        { key: "alt+j", command: "workbench.action.output.show.extensions" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Alt+U");

        await editor.waitForText((t) => t.includes("OUTPUT"));
        await editor.waitForText((t) => t.includes("[info] diode starting"));
        await editor.waitForText((t) => t.includes("Bootstrap"));
        // «⋯» с копией «Switch Output ›» не рисуется: submenu `isSelection` — это SelectBox, как в VS Code.
        await editor.waitForText((t) => {
            const tabRow = t.split("\n").find((line) => line.includes("PROBLEMS  OUTPUT  TERMINAL"));
            return tabRow !== undefined && tabRow.includes("Bootstrap") && !tabRow.includes("⋯");
        });
        await editor.capture("panel");

        await editor.sendKey("Alt+J");
        await editor.waitForText((t) => t.includes("Extensions") && !t.includes("diode starting"));
        await editor.capture("channel-switched");

        // BUG-1 из ревью: после смены канала фокус терялся — проверяем тем, что курсор двигается по логу.
        await editor.sendKey("ArrowUp");
        await editor.sendKey("ArrowUp");
        await editor.waitForText((t) => t.includes("Ln 1, Col 1"));
    },
});
