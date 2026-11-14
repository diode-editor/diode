import { URI, Utils } from "vscode-uri";

/**
 * `vscode-uri` is the upstream implementation, not a port; it is also `vscode.Uri` in the subprocess.
 * The static `joinPath` is added via `Object.assign` so `instanceof` in
 * extensions doesn't break. `fsPath` doesn't throw on non-file schemes
 * (`untitled:Untitled-1` → `"Untitled-1"`): gate disk operations on `scheme`.
 */
export const Uri = Object.assign(URI, { joinPath: Utils.joinPath });

export type Uri = URI;

/** Path helpers on a `Uri` (upstream `resources.basename`/`dirname`/`extname`), posix-style on `uri.path`. */
export const UriUtils = {
    basename: Utils.basename,
    dirname: Utils.dirname,
    extname: Utils.extname,
    /** Upstream `resources.basenameOrAuthority`: `http://host/` has no basename, the host names it. */
    basenameOrAuthority: (resource: URI): string => Utils.basename(resource) || resource.authority,
};
