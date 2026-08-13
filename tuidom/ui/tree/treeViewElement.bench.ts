import { bench, describe } from "vitest";

import {
    buildInMemoryTree,
    collectCollapsibleNodes,
    makeInMemoryTreeProvider,
    type PerfTreeNode,
} from "../../testing/perfFixtures.ts";
import { TestApp } from "../../testing/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";

import { TreeViewElement } from "./treeViewElement.ts";

// Бенчмарки flatten/refresh/render виджета дерева на in-memory данных (без fs).
// Запуск: `npm run test:perf`.
//
// Диагностика: refresh() пересобирает плоский список и делает линейные O(N)
// сканы (findElementByKey, restoreSelection); renderViewport аллоцирует
// DisplayLine на каждую видимую строку каждый кадр.
//
// NB: фикстуры строятся на верхнем уровне модуля (top-level await), а не в
// beforeAll — в режиме `vitest bench` тяжёлая инициализация в beforeAll
// отрабатывает некорректно (бенч не набирает сэмплов).

const NODE_COUNT = 2_000;

// ─── Полностью раскрытое дерево: refresh + render ────────────────────────────

const expandedRoots = buildInMemoryTree(NODE_COUNT);
const expandedTree = new TreeViewElement(makeInMemoryTreeProvider(expandedRoots));
const expandedApp = TestApp.createWithContent(expandedTree, new Size(60, 40));
await expandedTree.refresh();
for (const node of collectCollapsibleNodes(expandedRoots)) {
    await expandedTree.toggleExpand(node);
}

describe("TreeViewElement — large expanded tree", () => {
    bench("refresh() over fully-expanded tree", async () => {
        await expandedTree.refresh();
    });

    bench("render viewport (40 rows) on scroll", () => {
        expandedTree.scrollBy(0, 1);
        expandedTree.scrollBy(0, -1);
        expandedApp.render();
    });
});

// ─── Стоимость одного раскрытия (rebuildFlatList) ────────────────────────────

const toggleRoots = buildInMemoryTree(NODE_COUNT);
const toggleTree = new TreeViewElement(makeInMemoryTreeProvider(toggleRoots));
TestApp.createWithContent(toggleTree, new Size(60, 40));
await toggleTree.refresh();
const toggleCollapsible = collectCollapsibleNodes(toggleRoots);
const toggleTarget: PerfTreeNode = toggleCollapsible[0];
// Раскрываем всё, кроме target — его будем дёргать в бенче.
for (const node of toggleCollapsible.slice(1)) {
    await toggleTree.toggleExpand(node);
}

describe("TreeViewElement — toggleExpand rebuild", () => {
    bench("toggleExpand collapse+expand (2 flat-list rebuilds)", async () => {
        await toggleTree.toggleExpand(toggleTarget); // expand
        await toggleTree.toggleExpand(toggleTarget); // collapse
    });
});
