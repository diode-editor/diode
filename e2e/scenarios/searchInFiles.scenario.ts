import { defineScenario, repoRoot } from "./framework.ts";

// Search view (Ctrl+Shift+F): merged одно-view контейнер — заголовок SEARCH с
// меню «⋯» рисует pane-header. Хедер с отступами, include/exclude спрятаны за
// «···» (Toggle Search Details), режимы list (файлы плоско, матчи-дети) и tree
// (иерархия каталогов со сжатием цепочек), поэтапный Collapse All, кольцо
// фокуса Down/Up между инпутами и списком. Всё — против настоящего SEA-бинаря,
// включая распаковку вшитого `rg`.

// Шевроны ListViewElement (nf-fa-angle_down / angle_right) — эскейпами, чтобы
// PUA-глифы не потерялись при редактировании файла.
const CHEVRON_EXPANDED = "";
const CHEVRON_COLLAPSED = "";

async function typeText(driver: { sendKey(name: string): Promise<void> }, text: string): Promise<void> {
    for (const ch of text) {
        await driver.sendKey(ch);
    }
}

export default defineScenario({
    name: "searchInFiles",
    title: "Поиск по файлам: «⋯»-меню, детали за «···», режимы list/tree, Collapse All",
    open: [repoRoot],
    cols: 100,
    rows: 30,
    // The real keybinding is Ctrl+Shift+F (и Ctrl+Shift+J у деталей), but the
    // e2e key-DSL can't encode Ctrl+Shift+letter (needs a kitty/csi-u terminal)
    // — like the rename/terminal scenarios, we bind the same commands to
    // encodable keys for the demo.
    userKeybindings: [
        { key: "f6", command: "workbench.view.search" },
        { key: "f7", command: "search.action.viewAsList" },
        { key: "f8", command: "search.action.viewAsTree" },
        { key: "f9", command: "workbench.action.search.toggleQueryDetails" },
        { key: "f10", command: "search.action.collapseSearchResults" },
        { key: "f11", command: "search.action.expandSearchResults" },
    ],
    async run(driver) {
        // Sidebar starts on Explorer; wait for the workspace to be ready.
        await driver.waitForText((t) => t.includes("EXPLORER"));

        // Show the Search view (Ctrl+Shift+F for the user; F6 here): merged
        // header « SEARCH ⋯», отступы у инпутов, кнопка «···» под запросом,
        // include/exclude скрыты.
        await driver.sendKey("F6");
        await driver.waitForText((t) => t.includes("SEARCH") && t.includes("···"));
        await driver.capture("empty");

        // Case-insensitive by default, so a lowercase query matches the mixed-case
        // identifier across the codebase; list-режим (дефолт): файл-группы с
        // матчами-детьми, сворачиваемые.
        await typeText(driver, "textsearchservice");
        await driver.waitForText((t) => t.includes("results in") && t.includes(CHEVRON_EXPANDED));
        await driver.capture("results-list");

        // «···» (Toggle Search Details; F9 = Ctrl+Shift+J): появились
        // files to include/exclude, фокус ушёл в include.
        await driver.sendKey("F9");
        await driver.waitForText((t) => t.includes("files to include") && t.includes("files to exclude"));
        await driver.capture("details");

        // Кольцо фокуса: Down из include → exclude → список результатов.
        await driver.sendKey("ArrowDown");
        await driver.sendKey("ArrowDown");

        // Tree-режим (F8): иерархия каталогов, одиночные цепочки сжаты в «a/b/c»,
        // файлы — basename. Метка «contrib/search/browser» — компакт-цепочка,
        // в list-режиме такой контиг не влезает в клип узкого сайдбара.
        await driver.sendKey("F8");
        await driver.waitForText((t) => t.includes("contrib/search/browser"));
        await driver.capture("tree");

        // Меню «⋯» заголовка SEARCH (правые 3 колонки): View as List / View as
        // Tree (галочка на активном) и Collapse All.
        const header = await driver.waitForNode("#paneHeader-workbench-search-results");
        await driver.clickNode("#paneHeader-workbench-search-results", { dx: header.box.width - 2 });
        await driver.waitForText((t) => t.includes("View as List") && t.includes("Collapse All"));
        await driver.capture("more-actions-menu");
        await driver.sendKey("Escape");

        // Поэтапный Collapse All (F10): первый вызов сворачивает матчи под
        // файлами (папки раскрыты), второй — всё дерево до корня.
        await driver.sendKey("F10");
        await driver.waitForText((t) => t.includes(CHEVRON_COLLAPSED) && t.includes(CHEVRON_EXPANDED));
        await driver.capture("collapsed-files");
        await driver.sendKey("F10");
        await driver.waitForText((t) => t.includes(CHEVRON_COLLAPSED) && !t.includes(CHEVRON_EXPANDED));
        await driver.capture("collapsed-all");

        // Expand All (F11), обратно в list-режим (F7) и открытие матча: Down из
        // строки запроса уводит в список, ещё Down — на первый матч, Enter
        // открывает файл на позиции (статус-бар показывает Ln/Col).
        await driver.sendKey("F11");
        await driver.sendKey("F7");
        await driver.waitForText((t) => !t.includes("contrib/search/browser"));
        await driver.sendKey("F6"); // фокус обратно в строку запроса
        await driver.sendKey("F9"); // скрыть детали — Down пойдёт сразу в список
        await driver.waitForText((t) => !t.includes("files to include"));
        await driver.sendKey("ArrowDown"); // кольцо: query → список
        await driver.sendKey("Home"); // курсор на первую строку (файл)
        await driver.sendKey("ArrowDown"); // внутри списка: на первый матч
        await driver.sendKey("Enter");
        await driver.waitForText((t) => t.includes(", Col "));
        await driver.capture("opened");

        // Replace with a string absent from the whole repo — the count turns to
        // "No results". Assembled from fragments so neither this file nor any test
        // fixture contains the contiguous token (which would make it self-match).
        await driver.sendKey("F6"); // back to the query input
        for (let i = 0; i < "textsearchservice".length; i++) {
            await driver.sendKey("Backspace");
        }
        await typeText(driver, ["Xq7", "zzV", "nomatch", "Wk9q"].join(""));
        await driver.waitForText((t) => t.includes("No results"));
        await driver.capture("no-results");
    },
});
