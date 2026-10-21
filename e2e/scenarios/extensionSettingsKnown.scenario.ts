import { frameToText } from "../helpers/frame.ts";
import { defineScenario } from "./framework.ts";

// В settings.json сценария два ключа встроенного git и один ничей: «Unknown Configuration Setting» — только у ничьего.

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

        const warnings = frameToText(frame).split("Unknown Configuration Setting").length - 1;
        if (warnings !== 1) {
            throw new Error(`extension-settings-known: ожидалось одно предупреждение, на экране ${String(warnings)}`);
        }
    },
});
