import { defineScenario, repoRoot } from "./framework.ts";

// Search view (Ctrl+Shift+F): the left sidebar swaps from Explorer to a query
// input + case/whole-word/regex toggles and an interactive results list backed
// by ripgrep. The results are a virtualised ListViewElement: file groups
// collapse (tree mode), a command flips tree/flat, and Enter on a match opens
// the file at the match position. This shot exercises the whole feature
// end-to-end against the real SEA binary — including extracting the bundled
// `rg` at runtime.

const CHEVRON_EXPANDED = "";
const CHEVRON_COLLAPSED = "";

async function typeText(driver: { sendKey(name: string): Promise<void> }, text: string): Promise<void> {
    for (const ch of text) {
        await driver.sendKey(ch);
    }
}

export default defineScenario({
    name: "searchInFiles",
    title: "Поиск по файлам (Ctrl+Shift+F): дерево результатов, collapse, открытие на позиции",
    open: [repoRoot],
    cols: 100,
    rows: 30,
    // The real keybinding is Ctrl+Shift+F, but the e2e key-DSL can't encode
    // Ctrl+Shift+letter (needs a kitty/csi-u terminal) — like the rename/terminal
    // scenarios, we bind the same commands to encodable keys for the demo.
    userKeybindings: [
        { key: "f6", command: "workbench.view.search" },
        { key: "f7", command: "search.action.viewAsList" },
        { key: "f8", command: "search.action.viewAsTree" },
    ],
    async run(driver) {
        // Sidebar starts on Explorer; wait for the workspace to be ready.
        await driver.waitForText((t) => t.includes("EXPLORER"));

        // Show the Search view (Ctrl+Shift+F for the user; F6 here) — it swaps the
        // sidebar from Explorer to Search and focuses the query input.
        await driver.sendKey("F6");
        await driver.waitForText((t) => t.includes("SEARCH"));
        await driver.capture("empty");

        // Case-insensitive by default, so a lowercase query matches the mixed-case
        // identifier across the codebase; results stream in as collapsible file
        // groups (tree mode shows expanded chevrons).
        await typeText(driver, "textsearchservice");
        await driver.waitForText((t) => t.includes("results in") && t.includes(CHEVRON_EXPANDED));
        await driver.capture("results");

        // Click the first row (a file group; dx skips the chevron column so the
        // click only moves the cursor) — the list takes focus — then Enter
        // collapses the group: its matches fold away and the chevron flips.
        await driver.clickNode("#searchResults", { dx: 4, dy: 0 });
        await driver.sendKey("Enter");
        await driver.waitForText((t) => t.includes(CHEVRON_COLLAPSED));
        await driver.capture("collapsed");

        // Flat mode (search.action.viewAsList; F7 here): the same grouped rows,
        // but nothing collapses — the chevron gutter disappears.
        await driver.sendKey("F7");
        await driver.waitForText((t) => !t.includes(CHEVRON_EXPANDED) && !t.includes(CHEVRON_COLLAPSED));
        await driver.capture("flat");

        // Back to tree mode, step onto the first match and open it: the file
        // appears in the editor with the cursor at the match position (status bar
        // shows Ln/Col).
        await driver.sendKey("F8");
        await driver.waitForText((t) => t.includes(CHEVRON_EXPANDED));
        await driver.sendKey("ArrowDown");
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
