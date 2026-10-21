import { frameToText } from "../helpers/frame.ts";
import { defineScenario } from "./framework.ts";

// The scenario's settings.json has two keys of the built-in git extension and one unowned key: only the unowned one
// gets "Unknown Configuration Setting".

export default defineScenario({
    name: "extension-settings-known",
    title: "settings.json: extension keys are known, only an unknown key gets a warning",
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
            throw new Error(`extension-settings-known: expected one warning, got ${String(warnings)} on screen`);
        }
    },
});
