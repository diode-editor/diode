// Built-in Node Debug Auto-attach: upstream's `vscode.debug-auto-launch` as is. Its sources in `src/` are a vendored
// copy (scripts/import-vscode-editor.mjs); this file is only the entry `build-extensions.mjs` compiles.
export { activate, deactivate } from './src/extension.ts';
