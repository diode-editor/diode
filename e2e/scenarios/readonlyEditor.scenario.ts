import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Команда на Alt+R, а не из палитры: палитра вернула бы фокус меню-бару, набор не дошёл бы до редактора,
// и кадр «ввод заблокирован» выглядел бы правильным, ничего не доказывая.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

/** nf-cod-lock — метка read-only вкладки, см. tuidom/ui/editorgroup/editorTabItemElement.ts. */
const LOCK = "\uea75";

export default defineScenario({
    name: "readonly-editor",
    title: "Read-only editor: замок на вкладке и заблокированный ввод",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    userKeybindings: [{ key: "alt+r", command: "workbench.action.files.toggleActiveEditorReadonlyInSession" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.capture("writable");

        await editor.sendKey("Alt+R");

        await editor.waitForText((t) => t.includes(LOCK));
        await editor.capture("readonly-tab");

        await editor.sendText("ZZZ");
        await editor.sendKey("Backspace");
        await editor.capture("typing-blocked");

        // Контроль предыдущего шага: тот же набор теперь обязан дойти до документа — иначе «заблокировано»
        // неотличимо от потерянного фокуса.
        await editor.sendKey("Alt+R");
        await editor.waitForText((t) => !t.includes(LOCK));
        await editor.sendText("ZZZ");
        await editor.waitForText((t) => t.includes("ZZZ"));
        await editor.capture("writable-again");
    },
});
