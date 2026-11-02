/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/terminalContrib/links/browser/terminalLinkParsing.ts

/**
 * This module is responsible for parsing possible links out of lines with only access to the line
 * text and the target operating system, ie. it does not do any validation that paths actually
 * exist.
 */

import { Lazy } from "../../../../../base/common/lazy.ts";
import { OperatingSystem } from "../../../../../base/common/platform.ts";

export interface IParsedLink {
    path: ILinkPartialRange;
    prefix?: ILinkPartialRange;
    suffix?: ILinkSuffix;
}

export interface ILinkSuffix {
    row: number | undefined;
    col: number | undefined;
    rowEnd: number | undefined;
    colEnd: number | undefined;
    suffix: ILinkPartialRange;
}

export interface ILinkPartialRange {
    index: number;
    text: string;
}

/**
 * A regex that extracts the link suffix which contains line and column information. The link suffix
 * must terminate at the end of line.
 */
const linkSuffixRegexEol = new Lazy<RegExp>(() => generateLinkSuffixRegex(true));
/**
 * A regex that extracts the link suffix which contains line and column information.
 */
const linkSuffixRegex = new Lazy<RegExp>(() => generateLinkSuffixRegex(false));

function generateLinkSuffixRegex(eolOnly: boolean) {
    let ri = 0;
    let ci = 0;
    let rei = 0;
    let cei = 0;
    function r(): string {
        return `(?<row${ri++}>\\d+)`;
    }
    function c(): string {
        return `(?<col${ci++}>\\d+)`;
    }
    function re(): string {
        return `(?<rowEnd${rei++}>\\d+)`;
    }
    function ce(): string {
        return `(?<colEnd${cei++}>\\d+)`;
    }

    const eolSuffix = eolOnly ? "$" : "";

    // The comments in the regex below use real strings/numbers for better readability, here's
    // the legend:
    // - Path    = foo
    // - Row     = 339
    // - Col     = 12
    // - RowEnd  = 341
    // - ColEnd  = 789
    //
    // These all support single quote ' in the place of " and [] in the place of ()
    //
    // See the tests for an exhaustive list of all supported formats
    const lineAndColumnRegexClauses = [
        // foo:339
        // foo:339:12
        // foo:339:12-789
        // foo:339:12-341.789
        // foo:339.12
        // foo 339
        // foo 339:12                              [#140780]
        // foo 339.12
        // foo#339
        // foo#339:12                              [#190288]
        // foo#339.12
        // foo, 339                                [#217927]
        // "foo",339
        // "foo",339:12
        // "foo",339.12
        // "foo",339.12-789
        // "foo",339.12-341.789
        `(?::|#| |['"],|, )${r()}([:.]${c()}(?:-(?:${re()}\\.)?${ce()})?)?` + eolSuffix,
        // The quotes below are optional           [#171652]
        // "foo", line 339                         [#40468]
        // "foo", line 339, col 12
        // "foo", line 339, column 12
        // "foo":line 339
        // "foo":line 339, col 12
        // "foo":line 339, column 12
        // "foo": line 339
        // "foo": line 339, col 12
        // "foo": line 339, column 12
        // "foo" on line 339
        // "foo" on line 339, col 12
        // "foo" on line 339, column 12
        // "foo" line 339 column 12
        // "foo", line 339, character 12           [#171880]
        // "foo", line 339, characters 12-789      [#171880]
        // "foo", lines 339-341                    [#171880]
        // "foo", lines 339-341, characters 12-789 [#178287]
        `['"]?(?:,? |: ?| on )lines? ${r()}(?:-${re()})?(?:,? (?:col(?:umn)?|characters?) ${c()}(?:-${ce()})?)?` +
            eolSuffix,
        // () and [] are interchangeable
        // foo(339)
        // foo(339,12)
        // foo(339, 12)
        // foo (339)
        // foo (339,12)
        // foo (339, 12)
        // foo: (339)
        // foo: (339,12)
        // foo: (339, 12)
        // foo(339:12)                             [#229842]
        // foo (339:12)                            [#229842]
        `:? ?[\\[\\(]${r()}(?:(?:, ?|:)${c()})?[\\]\\)]` + eolSuffix,
    ];

    const suffixClause = lineAndColumnRegexClauses
        // Join all clauses together
        .join("|")
        // Convert spaces to allow the non-breaking space char (ascii 160)
        .replace(/ /g, `[\u00A0 ]`);

    return new RegExp(`(${suffixClause})`, eolOnly ? undefined : "g");
}

/**
 * Removes the optional link suffix which contains line and column information.
 * @param link The link to use.
 */
export function removeLinkSuffix(link: string): string {
    const suffix = getLinkSuffix(link)?.suffix;
    if (!suffix) {
        return link;
    }
    return link.substring(0, suffix.index);
}

/**
 * Removes any query string from the link.
 * @param link The link to use.
 */
export function removeLinkQueryString(link: string): string {
    // Skip ? in UNC paths
    const start = link.startsWith("\\\\?\\") ? 4 : 0;
    const index = link.indexOf("?", start);
    if (index === -1) {
        return link;
    }
    return link.substring(0, index);
}

export function detectLinkSuffixes(line: string): ILinkSuffix[] {
    // Find all suffixes on the line. Since the regex global flag is used, lastIndex will be updated
    // in place such that there are no overlapping matches.
    let match: RegExpExecArray | null;
    const results: ILinkSuffix[] = [];
    linkSuffixRegex.value.lastIndex = 0;
    while ((match = linkSuffixRegex.value.exec(line)) !== null) {
        results.push(toLinkSuffix(match));
    }
    return results;
}

/**
 * Returns the optional link suffix which contains line and column information.
 * @param link The link to parse.
 */
export function getLinkSuffix(link: string): ILinkSuffix | null {
    const match = linkSuffixRegexEol.value.exec(link);
    return match === null ? null : toLinkSuffix(match);
}

// diode: takes the match itself (upstream takes `null` too and returns it); upstream also checks `match.length < 1`, never true.
export function toLinkSuffix(match: RegExpExecArray): ILinkSuffix {
    const groups = match.groups ?? {};
    return {
        row: parseIntOptional(groups.row0 || groups.row1 || groups.row2),
        col: parseIntOptional(groups.col0 || groups.col1 || groups.col2),
        rowEnd: parseIntOptional(groups.rowEnd0 || groups.rowEnd1 || groups.rowEnd2),
        colEnd: parseIntOptional(groups.colEnd0 || groups.colEnd1 || groups.colEnd2),
        suffix: { index: match.index, text: match[0] },
    };
}

function parseIntOptional(value: string | undefined): number | undefined {
    if (value === undefined) {
        return value;
    }
    return parseInt(value);
}

// This defines valid path characters for a link with a suffix, the first `[]` of the regex includes
// characters the path is not allowed to _start_ with, the second `[]` includes characters not
// allowed at all in the path. If the characters show up in both regexes the link will stop at that
// character, otherwise it will stop at a space character.
const linkWithSuffixPathCharacters = /(?<path>(?:file:\/\/\/)?[^\s|<>[({][^\s|<>]*)$/;

export function detectLinks(line: string, os: OperatingSystem) {
    // 1: Detect all links on line via suffixes first
    const results = detectLinksViaSuffix(line);

    // 2: Detect all links without suffixes and merge non-conflicting ranges into the results
    const noSuffixPaths = detectPathsNoSuffix(line, os);
    binaryInsertList(results, noSuffixPaths);

    return results;
}

// diode: upstream first pushes everything into an empty list, then inserts it again; the second pass
// rejects each item as a conflict with itself, so the insert alone does the same.
function binaryInsertList(list: IParsedLink[], newItems: IParsedLink[]) {
    for (const item of newItems) {
        binaryInsert(list, item, 0, list.length);
    }
}

function binaryInsert(list: IParsedLink[], newItem: IParsedLink, low: number, high: number) {
    if (low > high) {
        return;
    }
    // Find the index where the newItem would be inserted
    const mid = Math.floor((low + high) / 2);
    if (
        mid >= list.length ||
        // Stryker disable next-line EqualityOperator: an item at a neighbour's index fails the conflict check below.
        (newItem.path.index < list[mid].path.index && (mid === 0 || newItem.path.index > list[mid - 1].path.index))
    ) {
        // Check if it conflicts with an existing link before adding
        if (
            mid >= list.length ||
            // Stryker disable next-line EqualityOperator: a plain path stops at a character before the next link.
            (newItem.path.index + newItem.path.text.length < list[mid].path.index &&
                // Stryker disable next-line EqualityOperator: where a suffixed path ends, its suffix begins.
                (mid === 0 || newItem.path.index > list[mid - 1].path.index + list[mid - 1].path.text.length))
        ) {
            list.splice(mid, 0, newItem);
        }
        return;
    }
    if (newItem.path.index > list[mid].path.index) {
        binaryInsert(list, newItem, mid + 1, high);
    } else {
        binaryInsert(list, newItem, low, mid - 1);
    }
}

function detectLinksViaSuffix(line: string): IParsedLink[] {
    const results: IParsedLink[] = [];

    // 1: Detect link suffixes on the line
    const suffixes = detectLinkSuffixes(line);
    for (const suffix of suffixes) {
        const beforeSuffix = line.substring(0, suffix.suffix.index);
        const possiblePathMatch = linkWithSuffixPathCharacters.exec(beforeSuffix);
        // diode: the `path` group is the whole match, never empty.
        if (possiblePathMatch !== null) {
            let linkStartIndex = possiblePathMatch.index;
            let path = possiblePathMatch[0];
            // Extract a path prefix if it exists (not part of the path, but part of the underlined
            // section)
            let prefix: ILinkPartialRange | undefined = undefined;
            const prefixMatch = /^['"]+/.exec(path);
            if (prefixMatch !== null) {
                const prefixText = prefixMatch[0];
                prefix = {
                    index: linkStartIndex,
                    text: prefixText,
                };
                path = path.substring(prefix.text.length);

                // Don't allow suffix links to be returned when the link itself is the empty string
                // (diode: the path has no whitespace, upstream's `trim()` changes nothing)
                if (path.length === 0) {
                    continue;
                }

                // If there are multiple characters in the prefix, trim the prefix if the _first_
                // suffix character is the same as the last prefix character. For example, for the
                // text `echo "'foo' on line 1"`:
                //
                // - Prefix='
                // - Path=foo
                // - Suffix=' on line 1
                //
                // If this fails on a multi-character prefix, just keep the original.
                // diode: upstream also requires a multi-character prefix and a quote opening the suffix;
                // a one-character prefix trims nothing, and the prefix is quotes only.
                if (prefixText.endsWith(suffix.suffix.text[0])) {
                    const trimPrefixAmount = prefixText.length - 1;
                    prefix.index += trimPrefixAmount;
                    prefix.text = prefixText[prefixText.length - 1];
                    linkStartIndex += trimPrefixAmount;
                }
            }
            results.push({
                path: {
                    index: linkStartIndex + (prefix?.text.length ?? 0),
                    text: path,
                },
                prefix,
                suffix,
            });

            // If the path contains an opening bracket, provide the path starting immediately after
            // the opening bracket as an additional result
            // diode: the match is the one bracket character.
            const openingBracketMatch = path.matchAll(/[[(](?![\])])/g);
            for (const match of openingBracketMatch) {
                results.push({
                    path: {
                        index: linkStartIndex + (prefix?.text.length ?? 0) + match.index + 1,
                        text: path.substring(match.index + 1),
                    },
                    prefix,
                    suffix,
                });
            }
        }
    }

    return results;
}

// diode: a const object instead of the upstream string enum (erasable syntax only).
const RegexPathConstants = {
    PathPrefix: "(?:\\.\\.?|\\~|file://)",
    PathSeparatorClause: "\\/",
    // '":; are allowed in paths but they are often separators so ignore them
    // Also disallow \\ to prevent a catastropic backtracking case #24795
    ExcludedPathCharactersClause: "[^\\0<>\\?\\s!`&*()'\":;\\\\]",
    ExcludedStartPathCharactersClause: "[^\\0<>\\?\\s!`&*()\\[\\]'\":;\\\\]",

    WinOtherPathPrefix: "\\.\\.?|\\~",
    WinPathSeparatorClause: "(?:\\\\|\\/)",
    WinExcludedPathCharactersClause: "[^\\0<>\\?\\|\\/\\s!`&*()'\":;]",
    WinExcludedStartPathCharactersClause: "[^\\0<>\\?\\|\\/\\s!`&*()\\[\\]'\":;]",
} as const;

/**
 * A regex that matches non-Windows paths, such as `/foo`, `~/foo`, `./foo`, `../foo` and
 * `foo/bar`.
 */
const unixLocalLinkClause =
    "(?:(?:" +
    RegexPathConstants.PathPrefix +
    "|(?:" +
    RegexPathConstants.ExcludedStartPathCharactersClause +
    RegexPathConstants.ExcludedPathCharactersClause +
    "*))?(?:" +
    RegexPathConstants.PathSeparatorClause +
    "(?:" +
    RegexPathConstants.ExcludedPathCharactersClause +
    ")+)+)";

/**
 * A regex clause that matches the start of an absolute path on Windows, such as: `C:`, `c:`,
 * `file:///c:` (uri) and `\\?\C:` (UNC path).
 */
export const winDrivePrefix = "(?:\\\\\\\\\\?\\\\|file:\\/\\/\\/)?[a-zA-Z]:";

/**
 * A regex that matches Windows paths, such as `\\?\c:\foo`, `c:\foo`, `~\foo`, `.\foo`, `..\foo`
 * and `foo\bar`.
 */
const winLocalLinkClause =
    "(?:(?:" +
    `(?:${winDrivePrefix}|${RegexPathConstants.WinOtherPathPrefix})` +
    "|(?:" +
    RegexPathConstants.WinExcludedStartPathCharactersClause +
    RegexPathConstants.WinExcludedPathCharactersClause +
    "*))?(?:" +
    RegexPathConstants.WinPathSeparatorClause +
    "(?:" +
    RegexPathConstants.WinExcludedPathCharactersClause +
    ")+)+)";

function detectPathsNoSuffix(line: string, os: OperatingSystem): IParsedLink[] {
    const results: IParsedLink[] = [];

    const regex = new RegExp(os === OperatingSystem.Windows ? winLocalLinkClause : unixLocalLinkClause, "g");
    let match;
    while ((match = regex.exec(line)) !== null) {
        let text = match[0];
        let index = match.index;
        // diode: upstream breaks on an empty match here; the regex needs a separator and a character.

        // Adjust the link range to exclude a/ and b/ if it looks like a git diff
        if (
            // --- a/foo/bar
            // +++ b/foo/bar
            ((line.startsWith("--- a/") || line.startsWith("+++ b/")) && index === 4) ||
            // diff --git a/foo/bar b/foo/bar
            (line.startsWith("diff --git") && (text.startsWith("a/") || text.startsWith("b/")))
        ) {
            text = text.substring(2);
            index += 2;
        }

        results.push({
            path: {
                index,
                text,
            },
            prefix: undefined,
            suffix: undefined,
        });
    }

    return results;
}
