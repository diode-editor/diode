import { defineScenario, repoRoot } from "./framework.ts";

// Против настоящего SEA-бинаря, включая распаковку вшитого `rg`.

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
    title: "Поиск по файлам: кнопки и «⋯»-меню заголовка, детали за «···», режимы list/tree, Collapse All",
    open: [repoRoot],
    cols: 100,
    rows: 30,
    // The e2e key-DSL can't encode Ctrl+Shift+letter (Ctrl+Shift+F, Ctrl+Shift+J), so the commands are bound to encodable keys.
    userKeybindings: [
        { key: "f6", command: "workbench.view.search" },
        { key: "f7", command: "search.action.viewAsList" },
        { key: "f8", command: "search.action.viewAsTree" },
        { key: "f9", command: "workbench.action.search.toggleQueryDetails" },
        { key: "f10", command: "search.action.collapseSearchResults" },
        { key: "f11", command: "search.action.expandSearchResults" },
    ],
    async run(driver) {
        await driver.waitForText((t) => t.includes("EXPLORER"));

        await driver.sendKey("F6");
        await driver.waitForText((t) => t.includes("SEARCH") && t.includes("···"));
        await driver.capture("empty");

        // Case-insensitive by default, so a lowercase query matches the mixed-case identifier.
        await typeText(driver, "textsearchservice");
        await driver.waitForText((t) => t.includes("results in") && t.includes(CHEVRON_EXPANDED));
        await driver.capture("results-list");

        await driver.sendKey("F9");
        await driver.waitForText((t) => t.includes("files to include") && t.includes("files to exclude"));
        await driver.capture("details");

        await driver.sendKey("ArrowDown");
        await driver.sendKey("ArrowDown");

        // Home прижимает курсор к вершине: порядок стрима rg платформозависим, и сохранённый по id курсор может утащить скролл вниз.
        await driver.sendKey("F8");
        await driver.sendKey("Home");
        await driver.waitForText((t) => t.includes("contrib/search/browser"));
        await driver.capture("tree");

        // «⋯» — правые 3 колонки заголовка SEARCH.
        const header = await driver.waitForNode("#paneHeader-workbench-search-results");
        await driver.clickNode("#paneHeader-workbench-search-results", { dx: header.box.width - 2 });
        await driver.waitForText((t) => t.includes("View as List") && t.includes("View as Tree"));
        await driver.capture("more-actions-menu");
        await driver.sendKey("Escape");

        // Поэтапный: первый вызов сворачивает матчи под файлами, второй — всё дерево.
        await driver.sendKey("F10");
        await driver.waitForText((t) => t.includes(CHEVRON_COLLAPSED) && t.includes(CHEVRON_EXPANDED));
        await driver.capture("collapsed-files");
        await driver.sendKey("F10");
        await driver.waitForText((t) => t.includes(CHEVRON_COLLAPSED) && !t.includes(CHEVRON_EXPANDED));
        await driver.capture("collapsed-all");

        await driver.sendKey("F11");
        await driver.sendKey("F7");
        await driver.waitForText((t) => !t.includes("contrib/search/browser"));
        await driver.sendKey("F6");
        await driver.sendKey("F9"); // скрыть детали — Down пойдёт сразу в список
        await driver.waitForText((t) => !t.includes("files to include"));
        await driver.sendKey("ArrowDown");
        await driver.sendKey("Home");
        await driver.sendKey("ArrowDown");
        await driver.sendKey("Enter");
        await driver.waitForText((t) => t.includes(", Col "));
        await driver.capture("opened");

        // Replacement absent from the whole repo, assembled from fragments so no file contains the contiguous token (it would self-match).
        await driver.sendKey("F6");
        for (let i = 0; i < "textsearchservice".length; i++) {
            await driver.sendKey("Backspace");
        }
        await typeText(driver, ["Xq7", "zzV", "nomatch", "Wk9q"].join(""));
        await driver.waitForText((t) => t.includes("No results"));
        await driver.capture("no-results");
    },
});
