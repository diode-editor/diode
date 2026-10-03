import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Достижимость биндов на терминале без extended keys (ssh + tmux — окружение,
// в котором пункт M5 ParityBacklog и завёлся).
//
// Кадры показывают три вещи:
//  1. у Explorer есть безусловный лидер-аккорд Ctrl+K E — канонический
//     Ctrl+Shift+E на legacy в байтовом потоке неотличим от Ctrl+E;
//  2. палитра подписывает команды ДОСТИЖИМЫМ биндом: Save As — Ctrl+K Alt+S,
//     Format Document — Ctrl+K Ctrl+E, а не Ctrl+Shift+S и Shift+Alt+F, которые
//     на legacy не доезжают (пользователь жал подсказанное, и ничего не
//     происходило — команда выглядела отсутствующей);
//  3. F1 открывает палитру И ПОСЛЕ подъёма tier'а. Это главный кадр: tier
//     поднимается от первой же CSI-u клавиши (`noteExtendedKeysObserved`), а
//     раньше F1 висел под `when: "tier == 'legacy'"` — поднявшийся tier снимал
//     его, Ctrl+Shift+P за tmux всё равно не доезжал, и редактор оставался
//     вообще без палитры, а набранный текст уходил прямо в документ.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "keybinding-reachability",
    title: "Бинды доезжают на любом терминале: аккорд у Explorer, честные подписи, F1 после подъёма tier'а",
    open: [repoRoot, sampleFile],
    settings: {
        // В кадре важны статус-бар с tier'ом и палитра, а не диагностика: на
        // Windows-раннере встроенный TS-сервер не поднимается, и его error-тост
        // накрывал палитру.
        "diode.lsp.typescript.enabled": false,
    },
    cols: 110,
    rows: 26,
    async run(editor) {
        // Старт — legacy (окружение e2e пинуется к нему, как tmux без extended
        // keys): индикатор окружения — первым слева в статус-баре.
        await editor.waitForText((t) => t.includes("greeting") && t.includes("legacy"));

        // Сайдбар убираем, чтобы по кадру было видно, что аккорд его открывает.
        await editor.sendKey("Ctrl+B");
        await editor.waitForText((t) => !t.includes("EXPLORER"));
        await editor.capture("sidebar-hidden");

        // Ctrl+K E — безусловный аккорд Explorer'а, парный к Ctrl+K F (Search) и
        // Ctrl+K G (Source Control). Обе части доезжают на любом терминале.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("e");
        await editor.waitForText((t) => t.includes("EXPLORER") && t.includes("sample.ts"));
        await editor.capture("chord-opens-explorer");

        // F1 на legacy — палитра открывается, и Save As подписан достижимым аккордом.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.waitForText((t) => t.includes("File: Save As...") && t.includes("Ctrl+K Alt+S"));
        await editor.capture("f1-on-legacy");

        // Формат-команды: подпись — досягаемый чорд, а не Shift+Alt+F.
        await editor.sendText("format");
        await editor.waitForText((t) => t.includes("Format Document") && t.includes("Ctrl+K Ctrl+E"));
        await editor.capture("format-labels-on-legacy");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("Format Document"));

        // Ctrl+Shift+E приходит в CSI-u форме — этим приложение узнаёт, что
        // extended keys есть, и поднимает tier до csi-u.
        await editor.sendKey("Ctrl+Shift+E");
        await editor.waitForText((t) => t.includes("csi-u"));
        await editor.capture("tier-promoted");

        // Главный кадр: палитра по F1 жива и на поднятом tier'е, а подпись Save As
        // переехала на канонический Ctrl+Shift+S — теперь он действительно доезжает.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.waitForText((t) => t.includes("File: Save As...") && t.includes("Ctrl+Shift+S"));
        await editor.capture("f1-after-tier-promotion");
    },
});
