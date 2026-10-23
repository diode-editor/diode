import { defineScenario, repoRoot } from "./framework.ts";

// Runs against the real SEA binary, including unpacking the bundled `rg`.

// ListViewElement chevrons (nf-fa-angle_down / angle_right) as escapes, so the
// PUA glyphs do not get lost when the file is edited.
const CHEVRON_EXPANDED = "";
const CHEVRON_COLLAPSED = "";

/**
 * The screen without the sidebar title row: its container switcher draws the same angle_down glyph, so
 * chevron checks of the result list must not see it.
 */
function withoutTitle(text: string): string {
    return text
        .split("\n")
        .filter((line) => !line.includes(" SEARCH "))
        .join("\n");
}

async function typeText(driver: { sendKey(name: string): Promise<void> }, text: string): Promise<void> {
    for (const ch of text) {
        await driver.sendKey(ch);
    }
}

export default defineScenario({
    name: "searchInFiles",
    title: "Search in files: header buttons and '⋯' menu, details behind '···', list/tree modes, Collapse All",
    open: [repoRoot],
    cols: 100,
    rows: 30,
    // The e2e key-DSL can't encode Ctrl+Shift+letter (Ctrl+Shift+F, Ctrl+Shift+J), so the commands are bound to
    // encodable keys.
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
        await driver.waitForText((t) => t.includes("results in") && withoutTitle(t).includes(CHEVRON_EXPANDED));
        await driver.capture("results-list");

        await driver.sendKey("F9");
        await driver.waitForText((t) => t.includes("files to include") && t.includes("files to exclude"));
        await driver.capture("details");

        await driver.sendKey("ArrowDown");
        await driver.sendKey("ArrowDown");

        // Home pins the cursor to the top: rg's stream order is platform-dependent, and a cursor kept by id can drag
        // the scroll down.
        await driver.sendKey("F8");
        await driver.sendKey("Home");
        await driver.waitForText((t) => t.includes("contrib/search/browser"));
        await driver.capture("tree");

        // "⋯" is the rightmost 3 columns of the SEARCH header.
        const header = await driver.waitForNode("#paneHeader-workbench-search-results");
        await driver.clickNode("#paneHeader-workbench-search-results", { dx: header.box.width - 2 });
        await driver.waitForText((t) => t.includes("View as List") && t.includes("View as Tree"));
        await driver.capture("more-actions-menu");
        await driver.sendKey("Escape");

        // Staged: the first call collapses matches under files, the second the whole tree.
        await driver.sendKey("F10");
        await driver.waitForText((t) => t.includes(CHEVRON_COLLAPSED) && withoutTitle(t).includes(CHEVRON_EXPANDED));
        await driver.capture("collapsed-files");
        await driver.sendKey("F10");
        await driver.waitForText((t) => t.includes(CHEVRON_COLLAPSED) && !withoutTitle(t).includes(CHEVRON_EXPANDED));
        await driver.capture("collapsed-all");

        await driver.sendKey("F11");
        await driver.sendKey("F7");
        await driver.waitForText((t) => !t.includes("contrib/search/browser"));
        await driver.sendKey("F6");
        await driver.sendKey("F9"); // hide details so Down goes straight to the list
        await driver.waitForText((t) => !t.includes("files to include"));
        await driver.sendKey("ArrowDown");
        await driver.sendKey("Home");
        await driver.sendKey("ArrowDown");
        await driver.sendKey("Enter");
        await driver.waitForText((t) => t.includes(", Col "));
        await driver.capture("opened");

        // Replacement absent from the whole repo, assembled from fragments so no file contains the contiguous token (it
        // would self-match).
        await driver.sendKey("F6");
        for (let i = 0; i < "textsearchservice".length; i++) {
            await driver.sendKey("Backspace");
        }
        await typeText(driver, ["Xq7", "zzV", "nomatch", "Wk9q"].join(""));
        await driver.waitForText((t) => t.includes("No results"));
        await driver.capture("no-results");
    },
});
