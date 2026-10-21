/**
 * An ESM extension in the shape the marketplace ships them: a directory with its own
 * `package.json` (`"type": "module"`) and a `.js` entry point with NAMED
 * imports from `"vscode"`, exactly how `esbenp.prettier-vscode` 12.x is built.
 *
 * Checks two things at once: the host decides "this is ESM" by the manifest's `"type"`,
 * and the ESM loader sees the virtual `"vscode"` module. The subprocess's CJS cache
 * is invisible to the ESM loader, so without `module.registerHooks` this file fails with
 * `ERR_MODULE_NOT_FOUND: Cannot find package 'vscode'`.
 */
import { commands, languages, Range, TextEdit } from "vscode";

// Top-level await is not here for looks: `require(esm)` on such a module
// fails with `ERR_REQUIRE_ASYNC_MODULE`, so it is what pins the loader CHOICE
// (`isEsmEntry` → `importModule`). Without it the CJS branch passes by
// accident: Node 22+ supports `require(esm)` for a synchronous graph.
await Promise.resolve();

export function activate(context) {
    context.subscriptions.push(
        commands.registerCommand("test.esm.ping", () => "pong from esm"),
        languages.registerDocumentFormattingEditProvider("plaintext", {
            provideDocumentFormattingEdits(document) {
                // positionAt is what the real prettier uses to build a minimal
                // edit; without it the provider silently returned an empty list.
                const text = document.getText();
                const formatted = text.replace(/ {2,}/g, " ");
                if (formatted === text) return [];
                const range = new Range(document.positionAt(0), document.positionAt(text.length));
                return [TextEdit.replace(range, formatted)];
            },
        }),
    );
    return { marker: "esm exports" };
}
