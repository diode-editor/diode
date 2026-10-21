import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Достижимость биндов без extended keys (ssh + tmux, #376). Главный кадр — F1 после подъёма tier'а: раньше F1
// висел под `when: "tier == 'legacy'"`, поднявшийся tier его снимал, а Ctrl+Shift+P за tmux не доезжал.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "keybinding-reachability",
    title: "Бинды доезжают на любом терминале: аккорд у Explorer, честные подписи, F1 после подъёма tier'а",
    open: [repoRoot, sampleFile],
    settings: {
        // На Windows-раннере встроенный TS-сервер не поднимается, и его error-тост накрывал палитру.
        "diode.lsp.typescript.enabled": false,
    },
    cols: 110,
    rows: 26,
    async run(editor) {
        // Окружение e2e пинуется к legacy, как tmux без extended keys.
        await editor.waitForText((t) => t.includes("greeting") && t.includes("legacy"));

        // Сайдбар убираем, чтобы по кадру было видно, что аккорд его открывает.
        await editor.sendKey("Ctrl+B");
        await editor.waitForText((t) => !t.includes("EXPLORER"));
        await editor.capture("sidebar-hidden");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("e");
        await editor.waitForText((t) => t.includes("EXPLORER") && t.includes("sample.ts"));
        await editor.capture("chord-opens-explorer");

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.waitForText((t) => t.includes("File: Save As...") && t.includes("Ctrl+K Alt+S"));
        await editor.capture("f1-on-legacy");

        await editor.sendText("format");
        await editor.waitForText((t) => t.includes("Format Document") && t.includes("Ctrl+K Ctrl+E"));
        await editor.capture("format-labels-on-legacy");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("Format Document"));

        // Ctrl+Shift+E приходит в CSI-u форме — по нему приложение поднимает tier до csi-u.
        await editor.sendKey("Ctrl+Shift+E");
        await editor.waitForText((t) => t.includes("csi-u"));
        await editor.capture("tier-promoted");

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.waitForText((t) => t.includes("File: Save As...") && t.includes("Ctrl+Shift+S"));
        await editor.capture("f1-after-tier-promotion");
    },
});
