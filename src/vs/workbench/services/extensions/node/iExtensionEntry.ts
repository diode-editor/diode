import * as path from "node:path";

export interface IExtensionEntry {
    activate(context: { readonly subscriptions: { dispose(): unknown }[] }): unknown;
    deactivate?(): unknown;
}

/** Exactly one of `mainPath` and `source`: a builtin comes as source, under SEA there is no file on disk. */
export interface IExtensionRegistration {
    readonly id: string;
    readonly manifest: {
        readonly name: string;
        readonly publisher: string;
        readonly version: string;
        readonly [key: string]: unknown;
    };
    readonly mainPath?: string;
    /** Without it (a builtin from `source`) the root is the directory of `filename`. */
    readonly extensionPath?: string;
    readonly source?: string;
    readonly filename?: string;
    /**
     * If the extension registers a command with this name, the host creates a proxy with this title for the
     * palette.
     */
    readonly commandTitles?: Readonly<Record<string, string>>;
    /**
     * The category prefixes the label only in the palette: inside the title it would leak into menus and the status
     * bar.
     */
    readonly commandCategories?: Readonly<Record<string, string>>;
    /** Empty or missing is treated as `["*"]` (eager). */
    readonly activationEvents?: readonly string[];
}

/**
 * One rule for both sides of RPC. For a builtin from `source`, the directory of the synthetic `filename` "inside
 * the bundle".
 */
export function extensionRootPath(spec: {
    readonly extensionPath?: string;
    readonly mainPath?: string;
    readonly filename?: string;
}): string {
    /* v8 ignore next -- one of the two is always present: without mainPath and filename the extension wouldn't load */
    // Stryker disable next-line StringLiteral: the trailing `?? ""` is unreachable by the same invariant as the v8 ignore above, so a mutant has nothing to hit
    return spec.extensionPath ?? path.dirname(spec.mainPath ?? spec.filename ?? "");
}
