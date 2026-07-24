import { defineScenario, repoRoot } from "./framework.ts";

// Search view (Ctrl+Shift+F): the left sidebar swaps from Explorer to a query
// input + case/whole-word/regex toggles and a results list grouped by file,
// backed by ripgrep. This shot exercises the whole feature end-to-end against
// the real SEA binary — including extracting the bundled `rg` at runtime.

async function typeText(driver: { sendKey(name: string): Promise<void> }, text: string): Promise<void> {
    for (const ch of text) {
        await driver.sendKey(ch);
    }
}

export default defineScenario({
    name: "searchInFiles",
    title: "Поиск по файлам (Ctrl+Shift+F): запрос и результаты по файлам",
    open: [repoRoot],
    cols: 100,
    rows: 30,
    // The real keybinding is Ctrl+Shift+F, but the e2e key-DSL can't encode
    // Ctrl+Shift+letter (needs a kitty/csi-u terminal) — like the rename/terminal
    // scenarios, we bind the same command to an encodable key for the demo.
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(driver) {
        // Sidebar starts on Explorer; wait for the workspace to be ready.
        await driver.waitForText((t) => t.includes("EXPLORER"));

        // Show the Search view (Ctrl+Shift+F for the user; F6 here) — it swaps the
        // sidebar from Explorer to Search and focuses the query input.
        await driver.sendKey("F6");
        await driver.waitForText((t) => t.includes("SEARCH"));
        await driver.capture("empty");

        // Case-insensitive by default, so a lowercase query matches the mixed-case
        // identifier across the codebase and the results stream in grouped by file.
        await typeText(driver, "textsearchservice");
        await driver.waitForText((t) => t.includes("results in"));
        await driver.capture("results");

        // Replace with a string absent from the whole repo — the count turns to
        // "No results". Assembled from fragments so neither this file nor any test
        // fixture contains the contiguous token (which would make it self-match).
        for (let i = 0; i < "textsearchservice".length; i++) {
            await driver.sendKey("Backspace");
        }
        await typeText(driver, ["Xq7", "zzV", "nomatch", "Wk9q"].join(""));
        await driver.waitForText((t) => t.includes("No results"));
        await driver.capture("no-results");
    },
});
