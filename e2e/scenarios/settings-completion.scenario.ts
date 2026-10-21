import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `editor.` в самом файле не встречается — его появление в попапе доказывает completion diode-settings, а не
// word-based fallback. Ключ печатается внутри объекта: вне его позиции ключа нет и подсказок не будет.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "settings.json");

export default defineScenario({
    name: "settings-completion",
    title: "Settings autocomplete (keys with quotes, values from schema)",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    // Только Linux: на Windows e2e субпроцесс-расширения флейкают.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("files.enableTrash"));
        await editor.capture("editor");

        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey(",");
        await editor.sendKey("Enter");

        await editor.sendKey('"');
        await editor.sendKey("e");
        await editor.sendKey("d");
        await editor.sendKey("i");

        await editor.waitForText((t) => t.includes("editor."), { timeoutMs: 4000 });
        await editor.capture("suggest-key");

        // Однозначный префикс, а не «N-й сверху»: порядок зависит от числа `editor.*` ключей в схеме. Ждём набранный
        // префикс, а не метку: узкий попап усекает её до `editor.…`. insertSpaces — ради boolean-значений.
        await editor.sendText("tor.ins");
        await editor.waitForText((t) => t.includes('"editor.ins'), { timeoutMs: 4000 });
        await editor.sendKey("Enter");

        // Ключ вставляется в кавычках: range накрыл уже набранную кавычку, она не удваивается.
        await editor.waitForText((t) => t.includes('"editor.insertSpaces"'), { timeoutMs: 4000 });
        await editor.capture("accepted-key");

        // `false` в файле нет — его появление доказывает, что значения пришли из схемы.
        await editor.sendKey(":");
        await editor.sendKey(" ");
        await editor.sendKey("f");
        await editor.waitForText((t) => t.includes("false"), { timeoutMs: 4000 });
        await editor.capture("suggest-value");
    },
});
