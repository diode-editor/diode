import type * as vscode from "vscode";

/**
 * `vscode.l10n` без бандлов переводов: локализованных строк у Diode нет
 * (`bundle`/`uri` честно `undefined`), но подстановка плейсхолдеров обязана
 * работать — VS Code подставляет аргументы и БЕЗ загруженного бандла, а
 * расширения (ruff) зовут `l10n.t` на каждое пользовательское сообщение.
 */

// Элементы и значения — с `undefined`: чтение по индексу за краем или по
// незнакомому ключу штатно даёт его, и подстановка на это опирается.
type L10nArgs = readonly (string | number | boolean | undefined)[] | Partial<Record<string, string | number | boolean>>;

/** `Array.isArray` сузил бы к `any[]` и потерял тип значений — берём предикат. */
function isPositionalArgs(args: L10nArgs): args is readonly (string | number | boolean | undefined)[] {
    return Array.isArray(args);
}

/** `{0}`/`{name}` → значение из args; незнакомый плейсхолдер остаётся как есть. */
function substitute(message: string, args: L10nArgs | undefined): string {
    if (args === undefined) return message;
    return message.replace(/\{([^}]+)\}/g, (whole, key: string) => {
        const value = isPositionalArgs(args) ? args[Number(key)] : args[key];
        return value === undefined ? whole : String(value);
    });
}

/** Все три перегрузки `t`: rest-аргументы, record и объект-options. */
function t(...params: unknown[]): string {
    const [first, second] = params;
    if (typeof first !== "string") {
        const options = first as { message: string; args?: L10nArgs };
        return substitute(options.message, options.args);
    }
    // Одинокий plain-object вторым аргументом — форма t(message, record).
    if (params.length === 2 && typeof second === "object" && second !== null && !Array.isArray(second)) {
        return substitute(first, second as Record<string, string | number | boolean>);
    }
    return substitute(first, params.slice(1) as (string | number | boolean)[]);
}

export function createL10nNamespace(): typeof vscode.l10n {
    return { t, bundle: undefined, uri: undefined } as unknown as typeof vscode.l10n;
}
