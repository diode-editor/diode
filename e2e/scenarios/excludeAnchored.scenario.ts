import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Шаблоны exclude-настроек считаются от корня — и в дереве, и в поиске.
//
// Монорепа прячет корневые каталоги шаблонами вида `"common": true`. Дерево
// понимало это как «только `<корень>/common`», а поиск по содержимому отдавал
// шаблон ripgrep'у как есть, и у rg он значит «`common` на любой глубине»:
// вложенный `nci/common/**` был виден в Explorer'е, но не находился поиском.
//
// В фикстуре токен лежит в двух файлах:
// - `common/RootOnly.java` — под шаблоном, нет ни в дереве, ни в поиске;
// - `nci/common/TopicStreamConsumer.java` — вне шаблона, виден и находится.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "excludeAnchored");

export default defineScenario({
    name: "exclude-anchored",
    title: "files.exclude: `common` прячет только корневой каталог — вложенный `nci/common` ищется",
    open: [sampleDir],
    cols: 110,
    rows: 26,
    settings: {
        "files.exclude": { common: true },
    },
    // Настоящий бинд поиска — Ctrl+Shift+F, в key-DSL он не выражается, поэтому
    // команда повешена на F6, как в сценарии searchInFiles.
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(editor) {
        // Дерево: `nci` на месте, корневого `common` нет. Сжатую цепочку
        // `nci/common` не ждём: у свёрнутой папки она появляется, только когда
        // подгрузились дети, — на windows-раннере кадр успевает раньше.
        // Строка дерева — имя, хвост пробелов и, возможно, `│` до соседней части.
        await editor.waitForText((t) => t.includes("EXPLORER") && t.includes("nci") && !/^\s*common\s*(│|$)/mu.test(t));
        await editor.capture("tree");

        // Поиск: токен найден в одном файле — вложенном. Корневой отрезан
        // шаблоном, вложенный шаблону не подходит.
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("SEARCH"));
        for (const ch of "quietHarborLantern") {
            await editor.sendKey(ch);
        }
        await editor.waitForText(
            (t) => t.includes("in 1 file") && t.includes("TopicStreamConsumer.java") && !t.includes("RootOnly.java"),
        );
        await editor.capture("search");
    },
});
