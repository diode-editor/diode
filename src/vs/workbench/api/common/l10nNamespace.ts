import type * as vscode from "vscode";

import { implementsApi } from "./apiSurface.ts";

/**
 * Бандлов переводов нет, но подстановка обязана работать: VS Code подставляет и
 * без бандла, а расширения (ruff) зовут `l10n.t` на каждое сообщение.
 */

// Элементы и значения — с `undefined`: чтение по индексу за краем или по
// незнакомому ключу штатно даёт его, и подстановка на это опирается.
type L10nArgs = readonly (string | number | boolean | undefined)[] | Partial<Record<string, string | number | boolean>>;

/** `Array.isArray` сузил бы к `any[]` и потерял тип значений — берём предикат. */
function isPositionalArgs(args: L10nArgs): args is readonly (string | number | boolean | undefined)[] {
    return Array.isArray(args);
}

/** Незнакомый плейсхолдер остаётся как есть. */
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
