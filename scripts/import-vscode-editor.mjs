#!/usr/bin/env node
/**
 * Manages vendored copies of editor code from upstream `microsoft/vscode`:
 *   - the line diff algorithm — `src/vs/editor/common/diff/` together with the
 *     core primitives (`src/vs/editor/common/core/`), the `CharCode` enum and
 *     the fixture corpus;
 *   - model tokenization — `src/vs/editor/common/model/textModelTokens.ts`
 *     (end-state store, invalid line queue, background tokenizer, viewport
 *     heuristic) and its small dependencies, the binary token format
 *     (`encodedTokenAttributes.ts`, `tokens/lineTokens.ts`,
 *     `tokens/contiguousMultilineTokens*.ts`) — docs/TODO/VscodeModel.md, B1/B2.
 *
 * One script for all imports rather than one per subsystem: the transform, the
 * `--check` guard and the pin are shared, and there is no reason for them to diverge.
 *
 * Same philosophy as `import-vscode-dts.mjs`: the vendored code is a staged
 * copy of upstream, not our source. It is **never edited by hand**; the only
 * way to change it is to change the pin or the declared transform here and
 * regenerate. The guard is `--check` mode.
 *
 * TRANSFORM (deterministic, applied in this order):
 *   1. EXCISIONS — declared cuts of code that pulls in extra dependencies.
 *      Anchors are exact lines; a missing anchor is fatal.
 *   2. IMPORT EXTENSIONS `'./x.js'` → `'./x.ts'` (diode convention, AGENTS.md).
 *   3. `import` → `import type` for symbols in TYPE_ONLY: we use
 *      `verbatimModuleSyntax: true`, under which a value import of a type is
 *      error TS1484. The list is declared below, not inferred heuristically.
 *   4. Provenance BANNER right after the upstream MIT header, followed by the
 *      declared prelude (PRELUDES: mocha globals import in upstream tests).
 *
 * Steps 1–4 are reversible in the sense that `--check` re-derives the expected
 * content from upstream and compares byte for byte. If upstream drifts so that
 * an excision anchor is not found, the script fails loudly instead of
 * corrupting the vendored copy.
 *
 * Dependencies that upstream pulls from `base/common` (arrays, assert, errors,
 * map, strings, …) are NOT vendored: their full versions drag in
 * `cancellation → event → lifecycle → observableInternal` (~30 files the diff
 * does not need). Narrow hand-written shims live at the same paths instead;
 * the mirrored layout makes the substitution transparent, no import needs
 * editing. Tokenization dependencies from `editor/common` (`languages.ts`,
 * `model.ts`) are covered the same way: their upstream versions are thousands
 * of lines of language feature providers and upstream `TextModel`, of which
 * the vendored code needs dozens.
 *
 * Modes:
 *   (no flags)    — import files from upstream at the pinned tag.
 *   --check       — compare the tree with re-derived upstream. Exit 1 on drift.
 *
 * The pin matches `extensions/VSCODE_VERSION` — keep the tags in lockstep.
 *
 * Usage: node scripts/import-vscode-editor.mjs [--check] [--keep-clone]
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const VSCODE_TAG = "1.127.0";
const VSCODE_REPO = "https://github.com/microsoft/vscode.git";

const repoRoot = resolve(import.meta.dirname, "..");

// ---- what we vendor --------------------------------------------------------

/** Files vendored verbatim. Upstream path == our path (mirrored layout). */
const FILES = [
    // Diff algorithm. Skips legacyLinesDiffComputer / externalLinesDiffComputer /
    // documentDiffProvider / linesDiffComputers (the legacy+advanced registry).
    "src/vs/editor/common/diff/linesDiffComputer.ts",
    "src/vs/editor/common/diff/rangeMapping.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/computeMovedLines.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/heuristicSequenceOptimizations.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/lineSequence.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/linesSliceCharSequence.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/utils.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/diffAlgorithm.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/dynamicProgrammingDiffing.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/myersDiffAlgorithm.ts",

    // Core primitives the algorithm is built on.
    "src/vs/editor/common/core/position.ts",
    "src/vs/editor/common/core/range.ts",
    "src/vs/editor/common/core/editOperation.ts",
    "src/vs/editor/common/core/ranges/lineRange.ts",
    "src/vs/editor/common/core/ranges/offsetRange.ts",
    "src/vs/editor/common/core/text/textLength.ts",
    "src/vs/editor/common/core/text/abstractText.ts",
    "src/vs/editor/common/core/text/positionToOffsetImpl.ts",
    "src/vs/editor/common/core/edits/edit.ts",
    "src/vs/editor/common/core/edits/stringEdit.ts",
    "src/vs/editor/common/core/edits/textEdit.ts",

    // A plain enum with no dependencies — cheaper to vendor whole than to shim.
    "src/vs/base/common/charCode.ts",

    // Model tokenization: line state, queue, background, viewport heuristic.
    "src/vs/editor/common/model/textModelTokens.ts",
    "src/vs/editor/common/model/fixedArray.ts",
    "src/vs/editor/common/core/misc/eolCounter.ts",
    "src/vs/base/common/stopwatch.ts",
    // Binary token format (B2): metadata layout, line tokens, tokens of
    // contiguous lines (what the background emits) with editing and
    // (de)serialization (the latter for the worker, B3), the "tokenizer failed" result.
    "src/vs/editor/common/encodedTokenAttributes.ts",
    "src/vs/editor/common/tokens/lineTokens.ts",
    "src/vs/editor/common/tokens/contiguousMultilineTokens.ts",
    "src/vs/editor/common/tokens/contiguousMultilineTokensBuilder.ts",
    "src/vs/editor/common/tokens/contiguousTokensEditing.ts",
    "src/vs/editor/common/languages/nullTokenize.ts",

    // Text storage: PieceTree (a red-black tree of pieces with a line start
    // cache) and its dependencies. Unused so far — wiring it into TextDocument
    // is step A3 (docs/TODO/VscodeModel.md).
    "src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeBase.ts",
    "src/vs/editor/common/model/pieceTreeTextBuffer/rbTreeBase.ts",
    "src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.ts",
    "src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.ts",
    "src/vs/editor/common/core/textChange.ts",
    // Buffer search (`findMatchesLineByLine`): `Searcher` and word boundary parsing.
    "src/vs/editor/common/model/textModelSearch.ts",
    "src/vs/editor/common/core/wordCharacterClassifier.ts",
    "src/vs/editor/common/core/characterClassifier.ts",
    "src/vs/base/common/uint.ts",

    // Upstream PieceTree tests (fuzzing with random edits) — the main gate for
    // the vendored tree. The path is upstream's (`editor/test/...`), not
    // colocated: the mirrored layout keeps relative imports verbatim.
    "src/vs/editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts",
];

/** Fixture corpus: upstream path → our path. Files are copied as is. */
const FIXTURES_FROM = "src/vs/editor/test/node/diffing/fixtures";
const FIXTURES_TO = "src/vs/editor/common/diff/__fixtures__";
/** Legacy computer expectations are not needed — we do not vendor legacy. */
const FIXTURE_SKIP = new Set(["legacy.expected.diff.json"]);

/** Sparse-checkout paths (cover FILES + fixtures). */
const SPARSE_PATHS = [
    "src/vs/editor/common/diff",
    "src/vs/editor/common/core",
    // A single file needs a leading slash in non-cone mode, otherwise git
    // treats the path as a name glob and warns (NON-CONE PROBLEMS).
    "/src/vs/base/common/charCode.ts",
    "/src/vs/base/common/stopwatch.ts",
    "/src/vs/editor/common/model/textModelTokens.ts",
    "/src/vs/editor/common/model/fixedArray.ts",
    "/src/vs/editor/common/encodedTokenAttributes.ts",
    "/src/vs/editor/common/tokens/lineTokens.ts",
    "/src/vs/editor/common/tokens/contiguousMultilineTokens.ts",
    "/src/vs/editor/common/tokens/contiguousMultilineTokensBuilder.ts",
    "/src/vs/editor/common/tokens/contiguousTokensEditing.ts",
    "/src/vs/editor/common/languages/nullTokenize.ts",
    "src/vs/editor/common/model/pieceTreeTextBuffer",
    "/src/vs/editor/common/model/textModelSearch.ts",
    "/src/vs/base/common/uint.ts",
    "/src/vs/editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts",
    FIXTURES_FROM,
];

// ---- declared transform ----------------------------------------------------

/**
 * Excisions: cut lines from `from` through `to` inclusive (`to: "EOF"` — to the
 * end of file, `"SELF"` — the `from` line alone; `nth` — up to the `nth` `to` line).
 * Each one carries a justification; the list aims to stay short.
 */
const EXCISIONS = {
    "src/vs/editor/common/diff/rangeMapping.ts": [
        {
            // The only consumer of the IChange type from legacyLinesDiffComputer.
            // The function has NO callers anywhere in upstream (checked with
            // grep -rn over src/vs), yet it pulls in legacyLinesDiffComputer.ts
            // (691 LOC) and base/common/diff/{diff,diffChange}.ts (1375 LOC) with LcsDiff.
            from: "export function lineRangeMappingFromChange(change: IChange): LineRangeMapping {",
            to: "EOF",
        },
        { from: "import { IChange } from './legacyLinesDiffComputer.js';", to: "SELF" },
    ],
    "src/vs/editor/common/tokens/lineTokens.ts": [
        {
            // Token type at a model position — reads `model.tokenization`
            // (upstream `TokenizationTextModelPart`), but our model is our own
            // (`ITextDocument` + `DocumentTokenStore`); we do the same in
            // `languages/standardTokenType.ts` on top of `LineTokens`.
            from: "export function getStandardTokenTypeAtPosition(model: ITextModel, position: IPosition): StandardTokenType | undefined {",
            to: "}",
        },
        { from: "import { IPosition } from '../core/position.js';", to: "SELF" },
        { from: "import { ITextModel } from '../model.js';", to: "SELF" },
    ],
    "src/vs/editor/common/core/textChange.ts": [
        {
            // Binary serialization of TextChange (`writeSize`/`write`/`read` and
            // their helpers — six methods in a row) — for saving the upstream
            // undo stack to a Uint8Array. Pulls in base/common/buffer.ts (lazy,
            // stream) and core/stringBuilder.ts (platform, TextDecoder). We only
            // need TextChange itself as the PieceTree reverse edit record.
            from: "\tprivate static _writeStringSize(str: string): number {",
            to: "\t}",
            nth: 6,
        },
        { from: "import * as buffer from '../../../base/common/buffer.js';", to: "SELF" },
        { from: "import { decodeUTF16LE } from './stringBuilder.js';", to: "SELF" },
    ],
    "src/vs/editor/common/model/textModelSearch.ts": [
        {
            // Find widget query parsing (string/regex/case) — pulls in
            // strings.createRegExp and escaping. PieceTree receives a ready
            // SearchData; our find widget is still our own.
            from: "export class SearchParams {",
            to: "}",
        },
        {
            // TextModel search (multiline, next/previous) — pulls in all of
            // textModel.ts (we do not vendor upstream TextModel,
            // docs/TODO/VscodeModel.md, branch C). PieceTree only calls
            // Searcher / createFindMatch / isValidMatch, which stay.
            from: "export class TextModelSearch {",
            to: "}",
        },
        { from: "import { TextModel } from './textModel.js';", to: "SELF" },
    ],
};

/**
 * Lines inserted right after the banner. Currently only the mocha globals
 * import (`suite`/`test`) in upstream tests: upstream has them as globals
 * (mocha), we run vitest without globals. The adapter is src/TestUtils/mochaCompat.ts
 * (it also gives the test `this.timeout()`, which the fuzzing cases call).
 */
const PRELUDES = {
    "src/vs/editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts": [
        "import { suite, test } from '../../../../../../TestUtils/mochaCompat.ts';",
    ],
};

/**
 * Symbols the vendored set exports as `interface`/`type`. Under
 * `verbatimModuleSyntax` they must be imported with `import type`, otherwise TS1484.
 *
 * The list comes from `grep '^export (interface|type)'` over the vendored set
 * plus two names from our shims (`Comparator`, `IEquatable`). If upstream adds
 * a new type and we miss it, `npm run typecheck` fails loudly.
 */
const TYPE_ONLY = new Set([
    // from the vendored set
    "AnyEdit",
    "AnyReplacement",
    "IDiffAlgorithm",
    "IEditData",
    "ILinesDiffComputer",
    "ILinesDiffComputerOptions",
    "IOffsetRange",
    "IPosition",
    "IRange",
    "ISequence",
    "ISerializedLineRange",
    "ISerializedStringEdit",
    "ISerializedStringReplacement",
    "ISingleEditOperation",
    "ITimeout",
    "SerializedLineEdit",
    "SerializedLineReplacement",
    "ITokenPresentation",
    "IViewLineTokens",
    // from our shims in base/common
    "Comparator",
    "IEquatable",
    "IdleDeadline",
    // from our tokenization shims in editor/common
    "IBackgroundTokenizationStore",
    "IBackgroundTokenizer",
    "ILanguageIdCodec",
    "IModelContentChange",
    "IState",
    "ITextModel",
    "ITokenizationSupport",
    // PieceTree: from the model.ts and lifecycle.ts shims
    "IDisposable",
    "IInternalModelContentChange",
    "ISingleEditOperationIdentifier",
    "ITextBuffer",
    "ITextBufferBuilder",
    "ITextBufferFactory",
    "ITextSnapshot",
    "IValidEditOperation",
]);

/** Last line of the upstream MIT header — the banner goes right after it. */
const MIT_HEADER_LAST = " *--------------------------------------------------------------------------------------------*/";

function banner(upstreamPath) {
    return [
        `//@diode:vendored microsoft/vscode@${VSCODE_TAG} ${upstreamPath}`,
        "// DO NOT EDIT BY HAND — regenerated by scripts/import-vscode-editor.mjs (see AGENTS.md).",
    ];
}

// ---- transform steps -------------------------------------------------------

function applyExcisions(lines, upstreamPath) {
    const specs = EXCISIONS[upstreamPath];
    if (specs === undefined) return lines;
    let out = lines;
    for (const spec of specs) {
        const start = out.findIndex((l) => l === spec.from);
        if (start === -1) {
            throw new Error(`[vendor] excision did not apply in ${upstreamPath}: anchor not found\n  ${spec.from}`);
        }
        const end = spec.to === "EOF" ? out.length - 1 : spec.to === "SELF" ? start : nthIndex(out, start, spec.to, spec.nth ?? 1);
        if (end === -1) {
            throw new Error(`[vendor] excision did not apply in ${upstreamPath}: end anchor not found\n  ${spec.to}`);
        }
        out = [...out.slice(0, start), ...out.slice(end + 1)];
    }
    return out;
}

/** Index of the `nth` (1-based) line equal to `line`, starting at `from`; -1 if none. */
function nthIndex(lines, from, line, nth) {
    let seen = 0;
    for (let i = from; i < lines.length; i++) {
        if (lines[i] === line && ++seen === nth) return i;
    }
    return -1;
}

/** `from './x.js'` → `from './x.ts'` — only in import/export specifiers. */
function rewriteImportExtensions(lines) {
    return lines.map((l) => l.replace(/(\bfrom\s+')([^']+)\.js(')/g, "$1$2.ts$3"));
}

/**
 * Splits a mixed import into a value part and a type part. Name order within
 * each group is kept; the value import comes first.
 */
function splitTypeImports(lines) {
    const out = [];
    for (const line of lines) {
        const match = /^import\s+\{([^}]*)\}\s+from\s+('[^']+');$/.exec(line);
        if (match === null) {
            out.push(line);
            continue;
        }
        const names = match[1]
            .split(",")
            .map((n) => n.trim())
            .filter((n) => n !== "");
        const types = names.filter((n) => TYPE_ONLY.has(n));
        if (types.length === 0) {
            out.push(line);
            continue;
        }
        const values = names.filter((n) => !TYPE_ONLY.has(n));
        if (values.length > 0) out.push(`import { ${values.join(", ")} } from ${match[2]};`);
        out.push(`import type { ${types.join(", ")} } from ${match[2]};`);
    }
    return out;
}

function insertBanner(lines, upstreamPath) {
    const idx = lines.indexOf(MIT_HEADER_LAST);
    if (idx === -1) throw new Error(`[vendor] MIT header not found in ${upstreamPath}`);
    return [...lines.slice(0, idx + 1), ...banner(upstreamPath), ...(PRELUDES[upstreamPath] ?? []), ...lines.slice(idx + 1)];
}

/** The full declared transform of upstream text into our file. */
function transform(text, upstreamPath) {
    let lines = text.replace(/\r\n/g, "\n").split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    lines = applyExcisions(lines, upstreamPath);
    lines = rewriteImportExtensions(lines);
    lines = splitTypeImports(lines);
    lines = insertBanner(lines, upstreamPath);
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n") + "\n";
}

// ---- upstream fetch --------------------------------------------------------

function withUpstream(fn) {
    const scratch = mkdtempSync(join(tmpdir(), "vscode-editor-"));
    const cloneDir = join(scratch, "vscode");
    const keepClone = process.argv.includes("--keep-clone");
    try {
        console.error(`[vendor] cloning microsoft/vscode@${VSCODE_TAG} (sparse, blobless)`);
        execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", VSCODE_TAG, VSCODE_REPO, cloneDir], {
            stdio: ["ignore", "ignore", "inherit"],
        });
        execFileSync("git", ["-C", cloneDir, "sparse-checkout", "set", "--no-cone", ...SPARSE_PATHS], {
            stdio: ["ignore", "ignore", "inherit"],
        });
        const sha = execFileSync("git", ["-C", cloneDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        return fn(cloneDir, sha);
    } finally {
        if (!keepClone) rmSync(scratch, { recursive: true, force: true });
    }
}

/** All files of the upstream fixture corpus — relative paths, sorted. */
function fixtureFiles(cloneDir) {
    const root = join(cloneDir, FIXTURES_FROM);
    const out = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir).sort()) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (!FIXTURE_SKIP.has(entry)) out.push(relative(root, full));
        }
    };
    walk(root);
    return out;
}

// ---- modes -----------------------------------------------------------------

function regen() {
    withUpstream((cloneDir, sha) => {
        for (const upstreamPath of FILES) {
            const source = readFileSync(join(cloneDir, upstreamPath), "utf8");
            const target = join(repoRoot, upstreamPath);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, transform(source, upstreamPath));
        }
        console.error(`[vendor] imported files: ${FILES.length}`);

        const fixtureTarget = join(repoRoot, FIXTURES_TO);
        rmSync(fixtureTarget, { recursive: true, force: true });
        const fixtures = fixtureFiles(cloneDir);
        for (const rel of fixtures) {
            const to = join(fixtureTarget, rel);
            mkdirSync(dirname(to), { recursive: true });
            cpSync(join(cloneDir, FIXTURES_FROM, rel), to);
        }
        console.error(`[vendor] imported fixtures: ${fixtures.length} file(s) → ${FIXTURES_TO}`);
        console.error(`[vendor] upstream ${VSCODE_TAG} ${sha}`);
    });
}

function check() {
    withUpstream((cloneDir, sha) => {
        const problems = [];

        for (const upstreamPath of FILES) {
            const want = transform(readFileSync(join(cloneDir, upstreamPath), "utf8"), upstreamPath);
            const target = join(repoRoot, upstreamPath);
            if (!existsSync(target)) {
                problems.push(`missing: ${upstreamPath}`);
                continue;
            }
            const got = readFileSync(target, "utf8");
            if (got === want) continue;
            const gotLines = got.split("\n");
            const wantLines = want.split("\n");
            const at = gotLines.findIndex((l, i) => l !== wantLines[i]);
            problems.push(
                `drift: ${upstreamPath}:${at + 1}\n    file:     ${JSON.stringify(gotLines[at])}\n    upstream: ${JSON.stringify(wantLines[at])}`,
            );
        }

        const fixtures = fixtureFiles(cloneDir);
        for (const rel of fixtures) {
            const target = join(repoRoot, FIXTURES_TO, rel);
            if (!existsSync(target)) {
                problems.push(`missing fixture: ${FIXTURES_TO}/${rel}`);
                continue;
            }
            if (!readFileSync(target).equals(readFileSync(join(cloneDir, FIXTURES_FROM, rel)))) {
                problems.push(`fixture drift: ${FIXTURES_TO}/${rel}`);
            }
        }

        if (problems.length === 0) {
            console.error(`[vendor] --check OK: ${FILES.length} file(s) + ${fixtures.length} fixture(s) match upstream @ ${VSCODE_TAG} ${sha}`);
            return;
        }
        console.error(`[vendor] --check FAIL (${problems.length}):`);
        for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
        process.exit(1);
    });
}

// ---- main ------------------------------------------------------------------

if (process.argv.includes("--check")) check();
else regen();
