import { URI, Utils } from "vscode-uri";

/**
 * `vscode-uri` is the upstream implementation, not a port; it is also `vscode.Uri` in the subprocess.
 * The static `joinPath` is added via `Object.assign` so `instanceof` in
 * extensions doesn't break. `fsPath` doesn't throw on non-file schemes
 * (`untitled:Untitled-1` → `"Untitled-1"`): gate disk operations on `scheme`.
 */
export const Uri = Object.assign(URI, { joinPath: Utils.joinPath });

export type Uri = URI;
