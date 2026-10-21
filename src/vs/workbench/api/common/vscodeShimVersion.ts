/**
 * Lock-step with `extensions/VSCODE_VERSION` and the vscode.d.ts pin (checked by vscodeNamespace.identity.test).
 * A separate module so that `main.ts` does not pull in the whole namespace assembly.
 */
export const VSCODE_SHIM_VERSION = "1.127.0";
