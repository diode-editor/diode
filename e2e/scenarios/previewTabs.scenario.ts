import { resolve } from "node:path";

import type { NodeSnapshot } from "@tuidom/inspector/protocol";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Режим предпросмотра вкладок (VS Code `workbench.editor.enablePreview`,
// дефолт `true`): активация файла в дереве открывает его
// ВКЛАДКОЙ-ПРЕДПРОСМОТРА. Такая вкладка в группе одна, и следующее превью
// занимает её слот — обход дерева больше не набивает таб-строку.
//
// Прикалывание (вкладка перестаёт быть предпросмотром) — по первой правке
// документа и по `workbench.action.keepEditor` (Ctrl+K Enter). Демо идёт ровно
// этим маршрутом: активация → активация (одна вкладка) → правка (приколола) →
// активация (новое превью рядом).
//
// Маршрут активации — клик по строке (он её ВЫБИРАЕТ и переводит фокус в
// дерево) плюс Enter. Одиночный клик сам по себе файл пока не открывает:
// `TreeViewElement` движка зовёт `onActivate` на Enter и на двойном клике, а
// одиночный клик у него только выбирает строку. Превью к входной точке не
// привязано — открывает его `onActivate` дерева, какой бы ввод до него ни
// довёл, — поэтому «одиночный клик открывает превью» приедет вместе с
// различением числа кликов в движке (фаза 3 в docs/TODO/PreviewEditors.md).
//
// Метки вкладок читаем из `inspectState` полосы, а не из текста кадра: в кадре
// рядом с меткой стоит PUA-глиф иконки файла, и текстовый матч на нём врёт.
// Курсив у метки предпросмотра — фаза 2, она ждёт признака `isPreview` в
// `TabInfo` движка; замещение видно и без него.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "previewTabs");

interface TabState {
    label: string;
    active: boolean;
    modified: boolean;
}

/** Вкладки полосы глазами инспектора (`EditorTabStripElement.inspectState`). */
function tabsOf(strip: NodeSnapshot): TabState[] {
    return (strip.state?.tabs ?? []) as TabState[];
}

/** Ждёт полосу, в которой метки вкладок — ровно `expected` (по порядку). */
async function waitForTabs(editor: ScenarioDriver, expected: readonly string[]): Promise<TabState[]> {
    let seen: string[] = [];
    for (let attempt = 0; attempt < 60; attempt++) {
        const tabs = tabsOf(await editor.waitForNode("EditorTabStripElement"));
        seen = tabs.map((tab) => tab.label);
        if (seen.length === expected.length && expected.every((label, i) => seen[i].includes(label))) {
            return tabs;
        }
        await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`в полосе ожидались вкладки [${expected.join(", ")}], а оказались [${seen.join(", ")}]`);
}

export default defineScenario({
    name: "preview-tabs",
    title: "Режим предпросмотра: обход дерева переиспользует одну вкладку",
    open: [sampleDir],
    cols: 110,
    rows: 24,
    async run(editor) {
        // Воркспейс открыт без файлов — в дереве три файла, таб-строки ещё нет.
        const tree = await editor.waitForNode("TreeViewElement");
        await editor.waitForText((t) => t.includes("alpha.ts") && t.includes("beta.ts") && t.includes("gamma.ts"));
        if (tabsOf(await editor.waitForNode("EditorTabStripElement")).length !== 0) {
            throw new Error("полоса вкладок ожидалась пустой");
        }
        await editor.capture("tree-only");

        // Строки дерева идут сверху вниз в алфавитном порядке; первая строка
        // лежит ровно на верхней границе виджета.
        const rowX = tree.box.x + 5;
        const rowY = (index: number): number => tree.box.y + index;
        /** Активирует файл в строке `index`: клик выбирает её, Enter открывает. */
        const activate = async (index: number): Promise<void> => {
            await editor.click(rowX, rowY(index));
            await editor.sendKey("Enter");
        };

        // Активация №1 — alpha.ts приехала предпросмотром.
        await activate(0);
        await waitForTabs(editor, ["alpha.ts"]);
        await editor.capture("first-preview");

        // Активация №2 — beta.ts ЗАНЯЛА СЛОТ alpha.ts: вкладка по-прежнему одна.
        await activate(1);
        const afterSecond = await waitForTabs(editor, ["beta.ts"]);
        if (!afterSecond[0].active) throw new Error("новое превью не стало активной вкладкой");
        await editor.capture("preview-replaced");

        // Правка прикалывает вкладку: фокус после активации уже в редакторе.
        await editor.sendText("// приколото правкой\n");
        const pinnedByEdit = await waitForTabs(editor, ["beta.ts"]);
        if (!pinnedByEdit[0].modified) throw new Error("правка не дошла до вкладки");

        // Активация №3 — gamma.ts встаёт РЯДОМ: приколотую правкой вкладку
        // замещение не трогает.
        await activate(2);
        await waitForTabs(editor, ["beta.ts", "gamma.ts"]);
        await editor.capture("edit-pins-tab");

        // Активация №4 — alpha.ts замещает gamma.ts (превью снова одна), а
        // beta.ts остаётся: в группе ровно одна вкладка-предпросмотр.
        await activate(0);
        await waitForTabs(editor, ["beta.ts", "alpha.ts"]);

        // Ctrl+K Enter (`workbench.action.keepEditor`) прикалывает превью без
        // правки — следующая активация открывает новое превью третьей вкладкой.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Enter");
        await activate(2);
        await waitForTabs(editor, ["beta.ts", "alpha.ts", "gamma.ts"]);
        await editor.capture("keep-editor-pins-tab");
    },
});
