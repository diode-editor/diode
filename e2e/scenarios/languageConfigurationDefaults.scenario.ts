import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Настройки по языку: секции `"[lang]"`.
//
// Встроенное расширение make объявляет в `contributes.configurationDefaults`
// `"[makefile]": { "editor.insertSpaces": false }` — Makefile без табов не
// работает. Глобально `editor.insertSpaces: true` (дефолт), а в отступах
// Makefile'а пока ничего нет, так что автоопределению не на что опереться:
// отступ решает настройка для языка. Открываем такой Makefile — статус-бар
// показывает «Tab Size», а не «Spaces», и Tab вставляет табуляцию (кадр
// `makefile-tabs`). Раньше секция языка терялась, и Makefile получал пробелы.

const makefile = resolve(repoRoot, "e2e", "fixtures", "makefileDefaults", "Makefile");

export default defineScenario({
    name: "language-configuration-defaults",
    title: "configurationDefaults [makefile]: Makefile открывается с табами",
    open: [makefile],
    cols: 100,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("build:"));
        const frame = await editor.waitForText((t) => t.includes("Tab Size: 4"));
        if (frameToText(frame).includes("Spaces:")) {
            throw new Error("language-configuration-defaults: Makefile открылся с пробелами");
        }
        await editor.sendKey("End");
        await editor.sendKey("Enter");
        await editor.sendKey("Tab");
        await editor.sendText("echo ok");
        await editor.waitForText((t) => t.includes("echo ok"));
        await editor.capture("makefile-tabs");
    },
});
