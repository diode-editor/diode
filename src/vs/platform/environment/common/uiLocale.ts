/**
 * Single source of truth for both sides of RPC: `vscode.env.language` returns
 * the same value so the extension and the editor agree on the language. A constant because
 * there are no UI translations; locale selection, once it exists, starts here.
 */
export const UI_LOCALE = "en";
