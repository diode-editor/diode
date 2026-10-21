import type * as vscode from "vscode";

import { implementsApi } from "./apiSurface.ts";

/**
 * There are no translation bundles, but substitution must work: VS Code substitutes
 * even without a bundle, and extensions (ruff) call `l10n.t` for every message.
 */

// Elements and values include `undefined`: reading an index past the end or an
// unknown key yields it by design, and substitution relies on that.
type L10nArgs = readonly (string | number | boolean | undefined)[] | Partial<Record<string, string | number | boolean>>;

/** `Array.isArray` would narrow to `any[]` and lose the value type, hence the predicate. */
function isPositionalArgs(args: L10nArgs): args is readonly (string | number | boolean | undefined)[] {
    return Array.isArray(args);
}

/** An unknown placeholder is left as is. */
function substitute(message: string, args: L10nArgs | undefined): string {
    if (args === undefined) return message;
    return message.replace(/\{([^}]+)\}/g, (whole, key: string) => {
        const value = isPositionalArgs(args) ? args[Number(key)] : args[key];
        return value === undefined ? whole : String(value);
    });
}

function t(...params: unknown[]): string {
    const [first, second] = params;
    if (typeof first !== "string") {
        const options = first as { message: string; args?: L10nArgs };
        return substitute(options.message, options.args);
    }
    if (params.length === 2 && typeof second === "object" && second !== null && !Array.isArray(second)) {
        return substitute(first, second as Record<string, string | number | boolean>);
    }
    return substitute(first, params.slice(1) as (string | number | boolean)[]);
}

export function createL10nNamespace(): typeof vscode.l10n {
    return implementsApi<typeof vscode.l10n>()({ t, bundle: undefined, uri: undefined });
}
