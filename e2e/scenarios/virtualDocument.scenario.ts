import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Контракт стокового `redhat.java`: F12 уводит на `jdt:`-ресурс провайдера. Неизвестная схема — не украшение:
// раньше `TextFileModel.openFile` бросал на не-`file:` схеме, промис никто не ждал, и Node закрывал редактор.

/** Замок read-only на вкладке (nf-cod-lock; рисует `EditorTabItemElement` движка). */
const READONLY_LOCK = "\uea75";

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "virtualDocsSample");
const sampleFile = resolve(sampleDir, "app.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-virtual-docs");

export default defineScenario({
    name: "virtual-document",
    title: "Read-only документ от registerTextDocumentContentProvider (F12 в библиотеку)",
    seedUserData: userData,
    open: [sampleDir, sampleFile],
    cols: 110,
    rows: 26,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Документ-образец"), { timeoutMs: 20_000 });
        // Провайдеры регистрируются в `activate()` через секунды; маркер в статус-баре — «реестр уже не пуст».
        await editor.waitForText((t) => t.includes("jdt: provider ready"), { timeoutMs: 30_000 });
        await editor.sendKey("F12");

        await editor.waitForText((t) => t.includes("public final class TextUtils"), { timeoutMs: 20_000 });
        await editor.waitForText((t) => t.includes(`${READONLY_LOCK} TextUtils.java`));
        await editor.capture("definition");

        // Схема без провайдера: причина названа, редактор жив и продолжает
        // отвечать (вкладка с исходником из jar никуда не делась).
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Open Unknown Scheme");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Unable to open") && t.includes("nosuchscheme"), {
            timeoutMs: 20_000,
        });
        await editor.capture("unknown-scheme");
    },
});
