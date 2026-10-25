// Upstream's `problemMatcher.ts`: the matcher model, the tasks.json parser and the built-in patterns and
// matchers, ported as is. Contributed ones live in `problemMatcherRegistry.ts`. Background (`watching`)
// patterns are not supported yet (docs/TODO/Tasks.md).

import * as paths from "node:path";

import { Uri } from "../../../../base/common/uri.ts";
import { createRange, type IRange } from "../../../../editor/common/core/iRange.ts";
import { FileType, type IFileService } from "../../../../platform/files/common/files.ts";
import { type IMarkerData, MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";

export type FileLocationKind = "absolute" | "relative" | "autoDetect" | "search";

export type ProblemLocationKind = "file" | "location";

export type ApplyToKind = "allDocuments" | "openDocuments" | "closedDocuments";

/** Values are match group indices. */
export interface IProblemPattern {
    readonly regexp: RegExp;
    readonly kind?: ProblemLocationKind;
    readonly file?: number;
    readonly message?: number;
    readonly location?: number;
    readonly line?: number;
    readonly character?: number;
    readonly endLine?: number;
    readonly endCharacter?: number;
    readonly code?: number;
    readonly severity?: number;
    readonly loop?: boolean;
}

export interface ISearchFileLocationArgs {
    readonly include?: string | readonly string[];
    readonly exclude?: string | readonly string[];
}

/** `filePrefix` may hold task variables; the task system resolves them before a run. */
export interface IProblemMatcher {
    readonly owner: string;
    readonly source?: string;
    readonly applyTo: ApplyToKind;
    readonly fileLocation: FileLocationKind;
    readonly filePrefix?: string | ISearchFileLocationArgs;
    readonly pattern: IProblemPattern | readonly IProblemPattern[];
    readonly severity?: MarkerSeverity;
}

/** What resolving a file name needs: `autoDetect` checks existence, `search` walks directories. */
export type IProblemMatcherFiles = Pick<IFileService, "exists" | "resolve">;

export interface IProblemMatch {
    readonly resource: Promise<Uri>;
    readonly marker: IMarkerData;
    readonly description: IProblemMatcher;
}

interface IHandleResult {
    readonly match: IProblemMatch | null;
    readonly continue: boolean;
}

/** Captured text by property; `kind` comes from the pattern. */
interface IProblemData {
    kind?: ProblemLocationKind;
    file?: string;
    location?: string;
    line?: string;
    character?: string;
    endLine?: string;
    endCharacter?: string;
    message?: string;
    severity?: string;
    code?: string;
}

type ProblemDataProperty = Exclude<keyof IProblemData, "kind">;

/** Keys are lower case: upstream compares ignoring case. */
const FILE_LOCATIONS: ReadonlyMap<string, FileLocationKind> = new Map<string, FileLocationKind>([
    ["absolute", "absolute"],
    ["relative", "relative"],
    ["autodetect", "autoDetect"],
    ["search", "search"],
]);

const PROBLEM_LOCATIONS: ReadonlyMap<string, ProblemLocationKind> = new Map<string, ProblemLocationKind>([
    ["file", "file"],
    ["location", "location"],
]);

/** An unknown value means all documents. */
const APPLY_TO: ReadonlyMap<string, ApplyToKind> = new Map<string, ApplyToKind>([
    ["opendocuments", "openDocuments"],
    ["closeddocuments", "closedDocuments"],
]);

const SEVERITIES: ReadonlyMap<string, MarkerSeverity> = new Map([
    ["error", MarkerSeverity.Error],
    ["warning", MarkerSeverity.Warning],
    ["warn", MarkerSeverity.Warning],
    ["info", MarkerSeverity.Info],
]);

/** Severity letters of a captured severity (upstream's `getSeverity`), compared case-sensitively. */
const SEVERITY_LETTERS: ReadonlyMap<string, MarkerSeverity> = new Map([
    ["E", MarkerSeverity.Error],
    ["W", MarkerSeverity.Warning],
    ["I", MarkerSeverity.Info],
]);

/** Upstream's `Severity.fromValue`: `undefined` is `Severity.Ignore`. */
export function severityFromValue(value: string): MarkerSeverity | undefined {
    return SEVERITIES.get(value.toLowerCase());
}

// --- built-in patterns and matchers (upstream's `fillDefaults`, verbatim) ---

const PATTERNS = {
    msCompile: {
        regexp: /^\s*(?:\s*\d+>)?(\S.*?)(?:\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\))?\s*:\s+(?:(\S+)\s+)?((?:fatal +)?error|warning|info)\s+(\w+\d+)?\s*:\s*(.*)$/,
        kind: "location",
        file: 1,
        location: 2,
        severity: 4,
        code: 5,
        message: 6,
    },
    "gulp-tsc": {
        regexp: /^([^\s].*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+(\d+)\s+(.*)$/,
        kind: "location",
        file: 1,
        location: 2,
        code: 3,
        message: 4,
    },
    cpp: {
        regexp: /^(\S.*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+(error|warning|info)\s+(C\d+)\s*:\s*(.*)$/,
        kind: "location",
        file: 1,
        location: 2,
        severity: 3,
        code: 4,
        message: 5,
    },
    csc: {
        regexp: /^(\S.*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+(error|warning|info)\s+(CS\d+)\s*:\s*(.*)$/,
        kind: "location",
        file: 1,
        location: 2,
        severity: 3,
        code: 4,
        message: 5,
    },
    vb: {
        regexp: /^(\S.*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+(error|warning|info)\s+(BC\d+)\s*:\s*(.*)$/,
        kind: "location",
        file: 1,
        location: 2,
        severity: 3,
        code: 4,
        message: 5,
    },
    lessCompile: {
        regexp: /^\s*(.*) in file (.*) line no. (\d+)$/,
        kind: "location",
        message: 1,
        file: 2,
        line: 3,
    },
    jshint: {
        regexp: /^(.*):\s+line\s+(\d+),\s+col\s+(\d+),\s(.+?)(?:\s+\((\w)(\d+)\))?$/,
        kind: "location",
        file: 1,
        line: 2,
        character: 3,
        message: 4,
        severity: 5,
        code: 6,
    },
    "jshint-stylish": [
        { regexp: /^(.+)$/, kind: "location", file: 1 },
        {
            regexp: /^\s+line\s+(\d+)\s+col\s+(\d+)\s+(.+?)(?:\s+\((\w)(\d+)\))?$/,
            line: 1,
            character: 2,
            message: 3,
            severity: 4,
            code: 5,
            loop: true,
        },
    ],
    "eslint-compact": {
        regexp: /^(.+):\sline\s(\d+),\scol\s(\d+),\s(Error|Warning|Info)\s-\s(.+)\s\((.+)\)$/,
        file: 1,
        kind: "location",
        line: 2,
        character: 3,
        severity: 4,
        message: 5,
        code: 6,
    },
    "eslint-stylish": [
        { regexp: /^((?:[a-zA-Z]:)*[./\\]+.*?)$/, kind: "location", file: 1 },
        {
            regexp: /^\s+(\d+):(\d+)\s+(error|warning|info)\s+(.+?)(?:\s\s+(.*))?$/,
            line: 1,
            character: 2,
            severity: 3,
            message: 4,
            code: 5,
            loop: true,
        },
    ],
    go: {
        regexp: /^([^:]*: )?((.:)?[^:]*):(\d+)(:(\d+))?: (.*)$/,
        kind: "location",
        file: 2,
        line: 4,
        character: 6,
        message: 7,
    },
} satisfies Readonly<Record<string, IProblemPattern | readonly IProblemPattern[]>>;

const BUILTIN_PATTERNS: ReadonlyMap<string, IProblemPattern | readonly IProblemPattern[]> = new Map(
    Object.entries(PATTERNS),
);

const BUILTIN_MATCHERS: ReadonlyMap<string, IProblemMatcher> = new Map<string, IProblemMatcher>([
    [
        "msCompile",
        {
            owner: "msCompile",
            source: "cpp",
            applyTo: "allDocuments",
            fileLocation: "absolute",
            pattern: PATTERNS.msCompile,
        },
    ],
    [
        "lessCompile",
        {
            owner: "lessCompile",
            source: "less",
            applyTo: "allDocuments",
            fileLocation: "absolute",
            pattern: PATTERNS.lessCompile,
            severity: MarkerSeverity.Error,
        },
    ],
    [
        "gulp-tsc",
        {
            owner: "typescript",
            source: "ts",
            applyTo: "closedDocuments",
            fileLocation: "relative",
            filePrefix: "${workspaceFolder}",
            pattern: PATTERNS["gulp-tsc"],
        },
    ],
    [
        "jshint",
        {
            owner: "jshint",
            source: "jshint",
            applyTo: "allDocuments",
            fileLocation: "absolute",
            pattern: PATTERNS.jshint,
        },
    ],
    [
        "jshint-stylish",
        {
            owner: "jshint",
            source: "jshint",
            applyTo: "allDocuments",
            fileLocation: "absolute",
            pattern: PATTERNS["jshint-stylish"],
        },
    ],
    [
        "eslint-compact",
        {
            owner: "eslint",
            source: "eslint",
            applyTo: "allDocuments",
            fileLocation: "absolute",
            filePrefix: "${workspaceFolder}",
            pattern: PATTERNS["eslint-compact"],
        },
    ],
    [
        "eslint-stylish",
        {
            owner: "eslint",
            source: "eslint",
            applyTo: "allDocuments",
            fileLocation: "absolute",
            pattern: PATTERNS["eslint-stylish"],
        },
    ],
    [
        "go",
        {
            owner: "go",
            source: "go",
            applyTo: "allDocuments",
            fileLocation: "relative",
            filePrefix: "${workspaceFolder}",
            pattern: PATTERNS.go,
        },
    ],
]);

/** Named patterns and matchers a description refers to (`"$name"`); names come without `$`. */
export interface IProblemMatcherLookup {
    getPattern(name: string): IProblemPattern | readonly IProblemPattern[] | undefined;
    getMatcher(name: string): IProblemMatcher | undefined;
}

export const BUILTIN_PROBLEM_MATCHERS: IProblemMatcherLookup = {
    getPattern: (name) => BUILTIN_PATTERNS.get(name),
    getMatcher: (name) => BUILTIN_MATCHERS.get(name),
};

/** A built-in matcher by name, with or without `$` (upstream's `_resolveMatchers`). */
export function getBuiltinProblemMatcher(name: string): IProblemMatcher | undefined {
    return BUILTIN_MATCHERS.get(name.startsWith("$") ? name.substring(1) : name);
}

// --- resources ---

/** Upstream's `getResource`: the file name from the output to a resource by `fileLocation`. */
export async function getResource(
    filename: string,
    matcher: IProblemMatcher,
    files: IProblemMatcherFiles,
): Promise<Uri> {
    const kind = matcher.fileLocation;
    let fullPath: string | undefined;
    if (kind === "absolute") {
        fullPath = filename;
    } else if (kind === "relative" && typeof matcher.filePrefix === "string") {
        fullPath = paths.join(matcher.filePrefix, filename);
    } else if (kind === "autoDetect") {
        const relative = await getResource(filename, { ...matcher, fileLocation: "relative" }, files);
        if (await files.exists(relative)) return relative;
        return getResource(filename, { ...matcher, fileLocation: "absolute" }, files);
    } else if (kind === "search") {
        const found = await searchForFileLocation(filename, files, matcher.filePrefix as ISearchFileLocationArgs);
        if (found === undefined) return getResource(filename, { ...matcher, fileLocation: "absolute" }, files);
        fullPath = found.path;
    }
    if (fullPath === undefined) {
        throw new Error(
            "FileLocationKind is not actionable. Does the matcher have a filePrefix? This should never happen.",
        );
    }
    // Upstream also prepends "/" to a path without one; `Uri.file` does that itself.
    return Uri.file(paths.normalize(fullPath).replace(/\\/g, "/"));
}

function asArray(value: string | readonly string[] | undefined): readonly string[] {
    // Stryker disable next-line ArrayDeclaration: equivalent: a made-up directory is neither listed nor excluded
    return [value ?? []].flat();
}

/** Depth-first: the files of a directory before its subdirectories. */
async function searchForFileLocation(
    filename: string,
    files: IProblemMatcherFiles,
    args: ISearchFileLocationArgs,
): Promise<Uri | undefined> {
    const exclusions = new Set(asArray(args.exclude).map((dir) => Uri.file(dir).path));
    const search = async (dir: Uri): Promise<Uri | undefined> => {
        if (exclusions.has(dir.path)) return undefined;
        let children;
        try {
            children = (await files.resolve(dir)).children;
        } catch {
            return undefined;
        }
        // Stryker disable next-line ArrayDeclaration: equivalent: a made-up entry is not a directory that can be listed
        const subdirs: Uri[] = [];
        for (const child of children) {
            if (child.type === FileType.Directory) subdirs.push(child.resource);
            // `filename` may be a relative path ("sub/name.ext"), so the whole path is compared by its end.
            else if (child.type === FileType.File && child.resource.path.endsWith(filename)) return child.resource;
        }
        for (const subdir of subdirs) {
            const result = await search(subdir);
            if (result !== undefined) return result;
        }
        return undefined;
    };
    for (const dir of asArray(args.include)) {
        const hit = await search(Uri.file(dir));
        if (hit !== undefined) return hit;
    }
    return undefined;
}

// --- line matchers ---

export interface ILineMatcher {
    readonly matchLength: number;
    /** The next line for a looping last pattern. */
    next(line: string): IProblemMatch | null;
    handle(lines: readonly string[], start: number): IHandleResult;
}

export function createLineMatcher(matcher: IProblemMatcher, files: IProblemMatcherFiles): ILineMatcher {
    const pattern = matcher.pattern;
    return isPatternArray(pattern)
        ? new MultiLineMatcher(matcher, pattern, files)
        : new SingleLineMatcher(matcher, pattern, files);
}

function isPatternArray(pattern: IProblemPattern | readonly IProblemPattern[]): pattern is readonly IProblemPattern[] {
    return Array.isArray(pattern);
}

/** Upstream: the code has no window above, so its `2 ** 31 - 1` "to the end of the line". */
const END_OF_LINE_COLUMN = 2 ** 31 - 1;

abstract class AbstractLineMatcher {
    protected constructor(
        private readonly matcher: IProblemMatcher,
        private readonly files: IProblemMatcherFiles,
    ) {}

    /** Upstream's `fillProblemData`: a property keeps its first capture, the message collects all. */
    protected fillProblemData(data: IProblemData, pattern: IProblemPattern, matches: RegExpExecArray): void {
        this.fill(data, "file", pattern, matches, true);
        this.appendMessage(data, pattern, matches);
        this.fill(data, "code", pattern, matches, true);
        this.fill(data, "severity", pattern, matches, true);
        // Stryker disable BooleanLiteral: equivalent: `parseInt` skips the whitespace trimming removes
        this.fill(data, "location", pattern, matches, true);
        this.fill(data, "line", pattern, matches, false);
        this.fill(data, "character", pattern, matches, false);
        this.fill(data, "endLine", pattern, matches, false);
        this.fill(data, "endCharacter", pattern, matches, false);
        // Stryker restore BooleanLiteral
    }

    /** A property keeps its first capture. */
    private fill(
        data: IProblemData,
        property: ProblemDataProperty,
        pattern: IProblemPattern,
        matches: RegExpExecArray,
        trim: boolean,
    ): void {
        const value = captureOf(matches, pattern[property]);
        if (value === undefined || data[property] !== undefined) return;
        data[property] = trim ? value.trim() : value;
    }

    /** The message collects the captures of all lines, one per line. */
    private appendMessage(data: IProblemData, pattern: IProblemPattern, matches: RegExpExecArray): void {
        const value = captureOf(matches, pattern.message)?.trim();
        if (value === undefined) return;
        data.message = data.message === undefined ? value : `${data.message}${endOfLine()}${value}`;
    }

    protected getMarkerMatch(data: IProblemData): IProblemMatch | undefined {
        const range = this.getRange(data);
        if (!isSet(data.file) || range === null || !isSet(data.message)) return undefined;
        const marker: IMarkerData = {
            severity: this.getSeverity(data),
            range,
            message: data.message,
            ...(isSet(data.code) ? { code: data.code } : {}),
            ...(this.matcher.source !== undefined ? { source: this.matcher.source } : {}),
        };
        return { description: this.matcher, resource: getResource(data.file, this.matcher, this.files), marker };
    }

    /** Upstream's 1-based location becomes our 0-based range. */
    private getRange(data: IProblemData): IRange | null {
        if (data.kind === "file") return toRange(0, 0, 0, 0);
        if (isSet(data.location)) return parseLocationInfo(data.location);
        if (!isSet(data.line)) return null;
        const startLine = parseInt(data.line);
        const startColumn = nonEmptyInt(data.character);
        const endLine = nonEmptyInt(data.endLine);
        const endColumn = nonEmptyInt(data.endCharacter);
        return createLocation(startLine, startColumn, endLine, endColumn);
    }

    /** A captured severity by name or letter (hint and note are info), else the matcher's, else error. */
    private getSeverity(data: IProblemData): MarkerSeverity {
        // Stryker disable next-line StringLiteral: equivalent: no severity name, letter or hint/note is that text either
        const value = data.severity ?? "";
        const captured =
            severityFromValue(value) ??
            SEVERITY_LETTERS.get(value) ??
            (/^(?:hint|note)$/i.test(value) ? MarkerSeverity.Info : undefined);
        return captured ?? this.matcher.severity ?? MarkerSeverity.Error;
    }
}

function endOfLine(): string {
    // Stryker disable next-line all: the Windows line break is not reachable on the platforms the gate runs on
    return process.platform === "win32" ? "\r\n" : "\n";
}

/** A group the pattern doesn't have, or one that didn't participate, captures nothing. */
function captureOf(matches: RegExpExecArray, group: number | undefined): string | undefined {
    return matches[group ?? -1] as string | undefined;
}

/** Upstream tests captures for truthiness: an empty capture is no capture. */
function isSet(value: string | undefined): value is string {
    return value !== undefined && value !== "";
}

function nonEmptyInt(value: string | undefined): number | undefined {
    return isSet(value) ? parseInt(value) : undefined;
}

function parseLocationInfo(value: string): IRange | null {
    // Upstream's unanchored `(\d+|\d+,\d+|\d+,\d+,\d+,\d+)` is "has a digit".
    if (!/\d/.test(value)) return null;
    const parts = value.split(",");
    const startLine = parseInt(parts[0]);
    const startColumn = parts.length > 1 ? parseInt(parts[1]) : undefined;
    if (parts.length > 3) return createLocation(startLine, startColumn, parseInt(parts[2]), parseInt(parts[3]));
    return createLocation(startLine, startColumn, undefined, undefined);
}

/** Upstream's `createLocation`: without a column the problem spans the whole line. */
function createLocation(
    startLine: number,
    startColumn: number | undefined,
    endLine: number | undefined,
    endColumn: number | undefined,
): IRange {
    if (startColumn !== undefined && endColumn !== undefined) {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- upstream's falsy check: 0 and NaN fall back too
        return toRange(startLine, startColumn, endLine || startLine, endColumn);
    }
    if (startColumn !== undefined) return toRange(startLine, startColumn, startLine, startColumn);
    return toRange(startLine, 1, startLine, END_OF_LINE_COLUMN);
}

/**
 * 1-based to 0-based, sanitized as upstream's `MarkerService._toMarker`: a line or column below 1 or not a number
 * (a whole-file problem's 0, a column group that captured text) is 1, the end is not before the start.
 */
function toRange(startLine: number, startColumn: number, endLine: number, endColumn: number): IRange {
    const line = startLine > 0 ? startLine : 1;
    const column = startColumn > 0 ? startColumn : 1;
    return createRange(
        line - 1,
        column - 1,
        // Stryker disable next-line EqualityOperator: equivalent: at endLine === line both branches give line
        (endLine >= line ? endLine : line) - 1,
        (endColumn > 0 ? endColumn : column) - 1,
    );
}

class SingleLineMatcher extends AbstractLineMatcher implements ILineMatcher {
    public readonly matchLength = 1;

    public constructor(
        matcher: IProblemMatcher,
        private readonly pattern: IProblemPattern,
        files: IProblemMatcherFiles,
    ) {
        super(matcher, files);
    }

    public handle(lines: readonly string[], start: number): IHandleResult {
        const data: IProblemData = { kind: this.pattern.kind };
        const matches = this.pattern.regexp.exec(lines[start]);
        if (matches !== null) {
            this.fillProblemData(data, this.pattern, matches);
            // A location pattern that captured no location reports the whole file (a file pattern already does).
            if (!isSet(data.location) && !isSet(data.line) && isSet(data.file)) {
                data.kind = "file";
            }
            const match = this.getMarkerMatch(data);
            if (match !== undefined) return { match, continue: false };
        }
        return { match: null, continue: false };
    }

    public next(): IProblemMatch | null {
        return null;
    }
}

class MultiLineMatcher extends AbstractLineMatcher implements ILineMatcher {
    /** What the patterns before the last one captured, for the looping last one. */
    private data: IProblemData = {};

    public constructor(
        matcher: IProblemMatcher,
        private readonly patterns: readonly IProblemPattern[],
        files: IProblemMatcherFiles,
    ) {
        super(matcher, files);
    }

    public get matchLength(): number {
        return this.patterns.length;
    }

    public handle(lines: readonly string[], start: number): IHandleResult {
        this.data = { kind: this.patterns[0].kind };
        let data = this.data;
        const last = this.patterns.length - 1;
        for (let i = 0; i < this.patterns.length; i++) {
            const pattern = this.patterns[i];
            const matches = pattern.regexp.exec(lines[i + start]);
            if (matches === null) return { match: null, continue: false };
            // The last line's captures stay out of the shared data: a looping pattern starts from it each time.
            if (i === last) data = { ...data };
            this.fillProblemData(data, pattern, matches);
        }
        return { match: this.getMarkerMatch(data) ?? null, continue: this.patterns[last].loop === true };
    }

    /** Only called after {@link handle} matched with a looping last pattern. */
    public next(line: string): IProblemMatch | null {
        const pattern = this.patterns[this.patterns.length - 1];
        const matches = pattern.regexp.exec(line);
        if (matches === null) return null;
        const data = { ...this.data };
        this.fillProblemData(data, pattern, matches);
        return this.getMarkerMatch(data) ?? null;
    }
}

// --- tasks.json parser (upstream's `ProblemPatternParser`/`ProblemMatcherParser`) ---

type Json = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Messages in upstream texts; the matcher that failed to parse is skipped. */
export type ProblemReporter = (message: string) => void;

function createRegularExpression(value: string, report: ProblemReporter): RegExp | undefined {
    try {
        return new RegExp(value);
    } catch {
        report(`Error: The string ${value} is not a valid regular expression.\n`);
        return undefined;
    }
}

type MutablePattern = { -readonly [K in keyof IProblemPattern]: IProblemPattern[K] };

const PATTERN_PROPERTIES: readonly [keyof IProblemPattern, string][] = [
    ["file", "file"],
    ["location", "location"],
    ["line", "line"],
    ["character", "column"],
    ["endLine", "endLine"],
    ["endCharacter", "endColumn"],
    ["severity", "severity"],
    ["code", "code"],
    ["message", "message"],
];

function createSinglePattern(value: Json, setDefaults: boolean, report: ProblemReporter): MutablePattern | undefined {
    const regexp = createRegularExpression(value.regexp as string, report);
    if (regexp === undefined) return undefined;
    const result: MutablePattern = { regexp };
    if (typeof value.kind === "string") result.kind = PROBLEM_LOCATIONS.get(value.kind.toLowerCase());
    for (const [resultKey, sourceKey] of PATTERN_PROPERTIES) {
        const index = value[sourceKey];
        if (typeof index === "number") (result as Record<string, unknown>)[resultKey] = index;
    }
    // Stryker disable next-line ConditionalExpression: equivalent: a `loop` of another type reads as false
    if (typeof value.loop === "boolean") result.loop = value.loop;
    if (setDefaults) {
        // Only properties the pattern doesn't set.
        // Upstream's `result.location || …`: group 0 is no location.
        const defaults: Partial<IProblemPattern> =
            (result.location ?? 0) !== 0 || result.kind === "file"
                ? { file: 1, message: 0 }
                : { file: 1, line: 2, character: 3, message: 0 };
        return { ...defaults, ...result };
    }
    return result;
}

function validatePattern(values: readonly IProblemPattern[], report: ProblemReporter): boolean {
    // Stryker disable next-line StringLiteral: equivalent: both callers set the first kind before validating
    const locationKind = values[0].kind ?? "location";
    if (values.slice(1).some((pattern) => pattern.kind !== undefined)) {
        report("The problem pattern is invalid. The kind property must be provided only in the first element");
    }
    const has = (property: keyof IProblemPattern): boolean => values.some((pattern) => pattern[property] !== undefined);
    const file = has("file");
    const message = has("message");
    const location = has("location");
    const line = has("line");
    if (!(file && message)) {
        report("The problem pattern is invalid. It must have at least have a file and a message.");
        return false;
    }
    if (locationKind === "location" && !(location || line)) {
        report(
            'The problem pattern is invalid. It must either have kind: "file" or have a line or location match group.',
        );
        return false;
    }
    return true;
}

function isCheckedPattern(value: unknown): value is Json {
    return isObject(value) && typeof value.regexp === "string";
}

/** Upstream's `ProblemPatternParser.parse` for an unnamed single or multi-line pattern. */
export function parseProblemPattern(
    value: unknown,
    report: ProblemReporter,
): IProblemPattern | readonly IProblemPattern[] | undefined {
    if (Array.isArray(value) && value.every(isCheckedPattern)) {
        return createMultiLinePattern(value as readonly Json[], report);
    }
    if (isCheckedPattern(value)) {
        const result = createSinglePattern(value, true, report);
        if (result === undefined) return undefined;
        result.kind ??= "location";
        return validatePattern([result], report) ? result : undefined;
    }
    report("The problem pattern is missing a regular expression.");
    return undefined;
}

function createMultiLinePattern(values: readonly Json[], report: ProblemReporter): IProblemPattern[] | undefined {
    const result: MutablePattern[] = [];
    for (let i = 0; i < values.length; i++) {
        const pattern = createSinglePattern(values[i], false, report);
        if (pattern === undefined) return undefined;
        // Upstream also resets such a `loop`; only the last pattern's is ever read.
        if (i < values.length - 1 && pattern.loop === true) {
            report("The loop property is only supported on the last line matcher.");
        }
        result.push(pattern);
    }
    if (result.length === 0) {
        report("The problem pattern is invalid. It must contain at least one pattern.");
        return undefined;
    }
    result[0].kind ??= "location";
    return validatePattern(result, report) ? result : undefined;
}

/** `"$name"` of a named pattern, or an inline pattern. */
function createProblemPattern(
    value: unknown,
    report: ProblemReporter,
    lookup: IProblemMatcherLookup,
): IProblemPattern | readonly IProblemPattern[] | undefined {
    if (typeof value === "string") {
        if (value.length > 1 && value.startsWith("$")) {
            const result = lookup.getPattern(value.substring(1));
            if (result === undefined) report(`Error: the pattern with the identifier ${value} doesn't exist.`);
            return result;
        }
        // An empty string never gets here: it is no pattern at all.
        report(`Error: the pattern property ${value} is not a valid pattern variable name.`);
        return undefined;
    }
    return parseProblemPattern(value, report);
}

interface IFileLocation {
    readonly fileLocation?: FileLocationKind;
    readonly filePrefix?: string | ISearchFileLocationArgs;
}

function fileLocationOf(value: unknown): IFileLocation {
    if (value === undefined) return { fileLocation: "relative", filePrefix: "${workspaceFolder}" };
    if (typeof value === "string") {
        const kind = FILE_LOCATIONS.get(value.toLowerCase());
        if (kind === "relative" || kind === "autoDetect") {
            return { fileLocation: kind, filePrefix: "${workspaceFolder}" };
        }
        if (kind === "search") return { fileLocation: kind, filePrefix: { include: ["${workspaceFolder}"] } };
        return { fileLocation: kind };
    }
    if (isStringArray(value)) {
        // Stryker disable next-line StringLiteral: equivalent: an empty array finds no kind under any key
        const kind = FILE_LOCATIONS.get(value.at(0)?.toLowerCase() ?? "");
        if (value.length === 1 && kind === "absolute") return { fileLocation: kind };
        if (value.length === 2 && (kind === "relative" || kind === "autoDetect") && value[1] !== "") {
            return { fileLocation: kind, filePrefix: value[1] };
        }
        return {};
    }
    if (Array.isArray(value) && String(value[0]).toLowerCase() === "search") {
        const args: unknown = value[1];
        return {
            fileLocation: "search",
            filePrefix: isObject(args) ? searchArgsOf(args) : { include: ["${workspaceFolder}"] },
        };
    }
    return {};
}

function searchArgsOf(value: Json): ISearchFileLocationArgs {
    const pick = (v: unknown): string | readonly string[] | undefined =>
        typeof v === "string" || isStringArray(v) ? v : undefined;
    return { include: pick(value.include), exclude: pick(value.exclude) };
}

/** Upstream's: an empty severity is none; an unknown one is reported and is error. */
function severityOf(value: unknown, report: ProblemReporter): MarkerSeverity | undefined {
    if (typeof value !== "string" || value === "") return undefined;
    const severity = severityFromValue(value);
    if (severity !== undefined) return severity;
    report(`Info: unknown severity ${value}. Valid values are error, warning and info.\n`);
    return MarkerSeverity.Error;
}

/**
 * Upstream's `ProblemMatcherParser.parse`: an inline `problemMatcher` object of tasks.json or a matcher an
 * extension contributes. `$name` of `pattern` and `base` is looked up in `lookup`.
 */
export function parseProblemMatcher(
    json: Json,
    report: ProblemReporter,
    lookup: IProblemMatcherLookup = BUILTIN_PROBLEM_MATCHERS,
): IProblemMatcher | undefined {
    const result = createProblemMatcher(json, report, lookup);
    const text = JSON.stringify(json, null, 4);
    if (result === undefined) {
        report(`Error: the description can't be converted into a problem matcher:\n${text}\n`);
        return undefined;
    }
    if (result.owner === "") {
        report(`Error: the description doesn't define an owner:\n${text}\n`);
        return undefined;
    }
    return result;
}

function createProblemMatcher(
    description: Json,
    report: ProblemReporter,
    lookup: IProblemMatcherLookup,
): IProblemMatcher | undefined {
    const owner = typeof description.owner === "string" ? description.owner : crypto.randomUUID();
    const source = typeof description.source === "string" && description.source !== "" ? description.source : undefined;
    const applyTo = APPLY_TO.get(String(description.applyTo).toLowerCase()) ?? "allDocuments";
    const { fileLocation, filePrefix } = fileLocationOf(description.fileLocation);
    // Upstream's `description.pattern ? … : undefined`.
    const pattern =
        description.pattern === undefined || description.pattern === null || description.pattern === ""
            ? undefined
            : createProblemPattern(description.pattern, report, lookup);
    const severity = severityOf(description.severity, report);

    if (typeof description.base === "string") {
        const base = description.base.startsWith("$") ? lookup.getMatcher(description.base.substring(1)) : undefined;
        if (base === undefined) return undefined;
        // The base, with what the description sets (and parsed) on top.
        return {
            ...base,
            ...(description.owner !== undefined ? { owner } : {}),
            ...(source !== undefined ? { source } : {}),
            // Without `fileLocation` in the description the base keeps its own, not the default.
            ...(description.fileLocation !== undefined && fileLocation !== undefined
                ? { fileLocation, filePrefix }
                : {}),
            ...(pattern !== undefined ? { pattern } : {}),
            ...(severity !== undefined ? { severity } : {}),
            ...(description.applyTo !== undefined ? { applyTo } : {}),
        };
    }
    if (fileLocation === undefined || pattern === undefined) return undefined;
    return { owner, applyTo, fileLocation, pattern, source, filePrefix, severity };
}
