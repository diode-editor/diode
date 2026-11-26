// Built-in Merge Conflict: upstream's `vscode.merge-conflict` as is. Its sources in `src/` are a vendored copy
// (scripts/import-vscode-editor.mjs); this file is only the entry `build-extensions.mjs` compiles.
export { activate, deactivate } from "./src/mergeConflictMain.ts";
