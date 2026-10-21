/**
 * A subset of VS Code's `GlobPattern`: `*` and `?` within a segment, `**` any
 * number of segments (`**\/x` also matches plain `x`), `{a,b}`. No `[0-9]`
 * ranges: a bracket matches literally. The path is posix; the caller converts it.
 */

const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
    const cached = cache.get(glob);
    if (cached !== undefined) return cached;

    let re = "";
    let groupDepth = 0;
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "*") {
            if (glob[i + 1] === "*") {
                i++;
                if (glob[i + 1] === "/") {
                    i++;
                    re += "(?:.*/)?"; // `**/` is zero or more path segments
                } else {
                    re += ".*";
                }
            } else {
                re += "[^/]*";
            }
        } else if (c === "?") {
            re += "[^/]";
        } else if (c === "{") {
            groupDepth++;
            re += "(?:";
        } else if (c === "}" && groupDepth > 0) {
            groupDepth--;
            re += ")";
        } else if (c === "," && groupDepth > 0) {
            re += "|";
        } else if ("/.+^${}()|[]\\".includes(c)) {
            re += "\\" + c;
        } else {
            re += c;
        }
    }

    const compiled = new RegExp("^" + re + "$");
    cache.set(glob, compiled);
    return compiled;
}

export function matchGlob(pattern: string, path: string): boolean {
    return globToRegExp(pattern).test(path);
}

export function matchAnyGlob(patterns: readonly string[], path: string): boolean {
    return patterns.some((pattern) => matchGlob(pattern, path));
}

/** `vscode.RelativePattern` on the wire. */
export interface IRelativePattern {
    /** Absolute base directory (posix form). */
    readonly base: string;
    readonly pattern: string;
}

export function matchRelativeGlob(pattern: IRelativePattern, path: string): boolean {
    const base = pattern.base.endsWith("/") ? pattern.base : pattern.base + "/";
    if (!path.startsWith(base)) return false;
    return matchGlob(pattern.pattern, path.slice(base.length));
}

/** As upstream's `splitGlobAware`: empty segments in the middle are kept, an empty tail is not. */
export function splitGlobAware(pattern: string, splitChar: string): string[] {
    const segments: string[] = [];
    let inBraces = false;
    let inBrackets = false;
    let current = "";
    for (const char of pattern) {
        if (char === splitChar && !inBraces && !inBrackets) {
            segments.push(current);
            current = "";
            continue;
        }
        if (char === "{") inBraces = true;
        else if (char === "}") inBraces = false;
        else if (char === "[") inBrackets = true;
        else if (char === "]") inBrackets = false;
        current += char;
    }
    if (current !== "") segments.push(current);
    return segments;
}
