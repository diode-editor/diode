import * as path from "node:path";

// Путь — строкой, как в строке запроса: у каталога разделитель на конце; сравнение —
// без учёта регистра, как `extUriIgnorePathCase` эталона на локальной ФС.

/** `*` в `extensions` — любое. */
export interface IFileDialogFilter {
    readonly name: string;
    readonly extensions: readonly string[];
}

export function equalsIgnoreCase(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

export function endsWithSeparator(value: string): boolean {
    return /[/\\]$/.test(value);
}

export function withSeparator(value: string): string {
    return endsWithSeparator(value) ? value : value + path.sep;
}

/** Без разделителя на конце; корень (`/`) остаётся корнем. */
export function stripTrailingSeparator(value: string): string {
    return value.length > 1 && endsWithSeparator(value) ? value.substring(0, value.length - 1) : value;
}

export function pathsEqual(a: string, b: string): boolean {
    return equalsIgnoreCase(stripTrailingSeparator(path.normalize(a)), stripTrailingSeparator(path.normalize(b)));
}

export function expandTilde(value: string, home: string): string {
    return path.join(home, value.substring(1));
}

/** Склейка, при которой набранные `.` и `..` остаются в строке как есть. */
export function pathAppend(base: string, additional: string): string {
    if (additional === ".." || additional === ".") return withSeparator(base) + additional;
    return path.join(base, additional);
}

export function startsWithIgnoreCase(value: string, prefix: string): boolean {
    return value.toLowerCase().startsWith(prefix.toLowerCase());
}

/** Имя файла, которое ФС примет (`isValidBasename` эталона в упрощении). */
export function isValidBasename(name: string, platform: NodeJS.Platform = process.platform): boolean {
    if (name === "" || name === "." || name === "..") return false;
    if (/[/\\]/.test(name)) return false;
    if (platform === "win32" && /[<>:"|?*]/.test(name)) return false;
    return name.length <= 255;
}

export function matchesFilters(file: string, filters: readonly IFileDialogFilter[] | undefined): boolean {
    if (filters === undefined) return true;
    return filters.some((filter) => filter.extensions.some((ext) => ext === "*" || file.endsWith(`.${ext}`)));
}

/** Подходящего расширения нет — дописывается первое расширение первого фильтра (`addPostfix` эталона). */
export function withFilterExtension(picked: string, filters: readonly IFileDialogFilter[] | undefined): string {
    if (filters === undefined || endsWithSeparator(picked)) return picked;
    const current = path.extname(picked).substring(1);
    const first = filters.at(0)?.extensions.at(0);
    if (first === undefined) return picked;
    const hasExt = filters.some((filter) => filter.extensions.some((ext) => ext === "*" || ext === current));
    return hasExt ? picked : `${picked}.${first}`;
}
