import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Шаблоны exclude считаются от корня и в поиске: rg сам понял бы `common` как «на любой глубине».
// Токен лежит в `common/RootOnly.java` (под шаблоном) и `nci/common/TopicStreamConsumer.java` (вне шаблона).

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
    // Ctrl+Shift+F в key-DSL не выражается — команда на F6.
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(editor) {
        // Сжатую цепочку `nci/common` не ждём: она появляется, лишь когда подгрузились дети, а windows-раннер снимает
        // кадр раньше. Строка дерева — имя, хвост пробелов и, возможно, `│` до соседней части.
        await editor.waitForText((t) => t.includes("EXPLORER") && t.includes("nci") && !/^\s*common\s*(│|$)/mu.test(t));
        await editor.capture("tree");

        // Имя файла сайдбар обрезает («nci/common/TopicStreamConsum…») — сверяем по префиксу пути.
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("SEARCH"));
        for (const ch of "quietHarborLantern") {
            await editor.sendKey(ch);
        }
        await editor.waitForText(
            (t) => t.includes("in 1 file") && t.includes("nci/common/TopicStream") && !t.includes("RootOnly"),
        );
        await editor.capture("search");
    },
});
