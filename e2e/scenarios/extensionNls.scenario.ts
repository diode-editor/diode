import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// `%key%` заголовков резолвится из `package.nls.json`, `category` становится префиксом; команды без категории
// префикса не получают — поэтому запрос `Java: `, а не `java`. Расширение не активируется (java-файла нет):
// заголовки — из заглушек `onCommand:`, сценарий стоит минуты, а не четверть часа jdt.ls.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "extensionNls.txt");

export default defineScenario({
    name: "extension-nls",
    title: "NLS манифеста: человеческие имена команд стокового redhat.java в палитре",
    open: [sampleFile],
    installVsix: ["redhat.java"],
    network: true,
    // Иначе тост согласия на телеметрию поверх кадра; активации нет, но настройка дешевле флака.
    settings: { "redhat.telemetry.enabled": false },
    // Внутрь кейса попадает закачка 139-МБ платформенного vsix.
    timeoutMs: 600_000,
    cols: 110,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Ни строчки Java"), { timeoutMs: 60_000 });

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput", { timeoutMs: 30_000 });
        // `Java: ` есть только в подписи, собранной из category и title.
        await editor.sendText("Java: ");

        const frame = await editor.waitForText((t) => t.includes("Java: Switch to Standard Mode"), {
            timeoutMs: 60_000,
        });
        if (frameToText(frame).includes("%java.")) {
            throw new Error("extension-nls: в палитре остался nls-ключ вместо заголовка");
        }
        await editor.capture("command-palette");
    },
});
