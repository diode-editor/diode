import { frameToText } from "../helpers/frame.ts";
import { defineScenario } from "./framework.ts";

// Настройки расширений — в общем реестре конфигурации.
//
// В settings.json сценария — два ключа встроенного расширения git
// (`contributes.configuration` его манифеста) и один ключ, которого не
// объявляет никто. Открываем settings.json (палитра → «Preferences: Open User
// Settings») и панель Problems (Ctrl+J): предупреждение «Unknown Configuration
// Setting» стоит только у чужого ключа — ключи git валидатор знает, потому что
// их регистрирует тот же реестр, из которого собираются дефолты ядра. Раньше
// предупреждения висели на всех трёх.

export default defineScenario({
    name: "extension-settings-known",
    title: "settings.json: ключи расширений известны, предупреждение — только у чужого ключа",
    settings: {
        "git.enabled": true,
        "git.refreshDebounce": 300,
        "nobody.declares.this": 1,
    },
    cols: 110,
    rows: 28,
    async run(editor) {
        await editor.sendKey("F1");
        await editor.sendText("Open User Settings");
        await editor.waitForText((t) => t.includes("Preferences: Open User Settings"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("nobody.declares.this"));

        await editor.sendKey("Ctrl+J");
        const frame = await editor.waitForText((t) =>
            t.includes("Unknown Configuration Setting: nobody.declares.this"),
        );
        await editor.capture("problems");

        // Ключи встроенного расширения — известные: предупреждение ровно одно.
        const warnings = frameToText(frame).split("Unknown Configuration Setting").length - 1;
        if (warnings !== 1) {
            throw new Error(`extension-settings-known: ожидалось одно предупреждение, на экране ${String(warnings)}`);
        }
    },
});
