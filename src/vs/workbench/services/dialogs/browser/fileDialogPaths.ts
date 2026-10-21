import * as path from "node:path";

// Paths are strings as in the query line: a directory ends with a separator; comparison is
// case-insensitive, like upstream `extUriIgnorePathCase` on the local file system.

/** `*` in `extensions` matches any. */
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

/** The root (`/`) stays the root. */
export function stripTrailingSeparator(value: string): string {
    return value.length > 1 && endsWithSeparator(value) ? value.substring(0, value.length - 1) : value;
}

export function pathsEqual(a: string, b: string): boolean {
    return equalsIgnoreCase(stripTrailingSeparator(path.normalize(a)), stripTrailingSeparator(path.normalize(b)));
}

export function expandTilde(value: string, home: string): string {
    return path.join(home, value.substring(1));
}

/** Joins so that typed `.` and `..` stay in the string as is. */
export function pathAppend(base: string, additional: string): string {
    if (additional === ".." || additional === ".") return withSeparator(base) + additional;
    return path.join(base, additional);
}

export function startsWithIgnoreCase(value: string, prefix: string): boolean {
    return value.toLowerCase().startsWith(prefix.toLowerCase());
}

/** A file name the file system accepts (simplified upstream `isValidBasename`). */
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

/** Without a matching extension appends the first extension of the first filter (upstream `addPostfix`). */
export function withFilterExtension(picked: string, filters: readonly IFileDialogFilter[] | undefined): string {
    if (filters === undefined || endsWithSeparator(picked)) return picked;
    const current = path.extname(picked).substring(1);
    const first = filters.at(0)?.extensions.at(0);
    if (first === undefined) return picked;
    const hasExt = filters.some((filter) => filter.extensions.some((ext) => ext === "*" || ext === current));
    return hasExt ? picked : `${picked}.${first}`;
}
