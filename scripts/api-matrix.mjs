#!/usr/bin/env node
/**
 * Extension x API matrix (`npm run api-matrix`): `docs/extensions/api-matrix.generated.md`, built
 * offline from the pinned `vscode.d.ts`, the committed survey, the hand-kept classes and the marks
 * the repository can prove. Format and rules: docs/extensions/README.md.
 *
 *   node scripts/api-matrix.mjs           rewrite the generated file
 *   node scripts/api-matrix.mjs --check   fail if inputs are inconsistent or the file is stale (static gate)
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadSurface } from "./ext-survey-analyze.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const DOCS = join(repoRoot, "docs", "extensions");
export const OUTPUT_PATH = join(DOCS, "api-matrix.generated.md");
const CONFORMANCE = join(repoRoot, "e2e", "api-conformance");
const TEST_ROOTS = ["src", "e2e", "extensions", "tools"];
const TEST_FILE = /\.test\.tsx?$/;

/** `ok` is ours: the epic's classes name gaps, and a member without a known gap needs a class too. */
export const CLASSES = ["ok", "A", "B", "C", "X"];
const GAP_CLASSES = new Set(["A", "B", "C", "X"]);
const CANDIDATES = 15;
const TOP_GAPS = 100;

/** Reads `<namespace>.json` files into one member map; a member in two files is an error. */
export function readClasses(dir) {
    const classes = new Map();
    const problems = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
        const { members } = JSON.parse(readFileSync(join(dir, file), "utf8"));
        for (const [member, value] of Object.entries(members)) {
            if (classes.has(member)) problems.push(`${member}: listed twice (${file})`);
            classes.set(member, value);
        }
    }
    return { classes, problems };
}

/** Every surface member has a valid class, every class belongs to a real member. */
export function validateClasses(surface, classes) {
    const problems = [];
    for (const member of surface.keys()) {
        if (!classes.has(member)) problems.push(`${member}: no class in docs/extensions/api-matrix/`);
    }
    for (const [member, value] of classes) {
        if (!surface.has(member)) problems.push(`${member}: not in vscode.d.ts`);
        if (!CLASSES.includes(value.class)) problems.push(`${member}: unknown class "${String(value.class)}"`);
    }
    return problems;
}

/** Tags in test titles: `[api:window.showTextDocument]`, several per title are fine. */
export function findApiTags(source) {
    return [...source.matchAll(/\[api:([\w$.]+)\]/g)].map((match) => match[1]);
}

function* walkTests(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) yield* walkTests(path);
        else if (TEST_FILE.test(entry.name)) yield path;
    }
}

function readTaggedMembers() {
    const tagged = new Map();
    for (const root of TEST_ROOTS) {
        for (const path of walkTests(join(repoRoot, root))) {
            for (const member of findApiTags(readFileSync(path, "utf8"))) {
                if (!tagged.has(member)) tagged.set(member, relative(repoRoot, path));
            }
        }
    }
    return tagged;
}

/**
 * A member the upstream conformance tests prove: a `memberMap.json` row whose test is green, that
 * is, listed in the baseline of its suite. A key is `<suite> <test title>`.
 *
 * @param {Record<string, string[]>} memberMap
 * @param {(suite: string) => Set<string>} greenTests
 */
export function conformanceMembers(memberMap, greenTests) {
    const proven = new Set();
    for (const [key, members] of Object.entries(memberMap)) {
        const space = key.indexOf(" ");
        if (space === -1) continue;
        if (greenTests(key.slice(0, space)).has(key.slice(space + 1))) for (const member of members) proven.add(member);
    }
    return proven;
}

function readConformanceMembers() {
    const mapPath = join(CONFORMANCE, "memberMap.json");
    if (!existsSync(mapPath)) return new Set();
    const baselines = new Map();
    return conformanceMembers(JSON.parse(readFileSync(mapPath, "utf8")), (suite) => {
        if (!baselines.has(suite)) {
            const path = join(CONFORMANCE, "baseline", `${suite}.txt`);
            baselines.set(suite, new Set(existsSync(path) ? readFileSync(path, "utf8").split("\n") : []));
        }
        return baselines.get(suite);
    });
}

/** `docs/extensions/api-confirmed/<id>.json`, written from the call journal, never by hand. */
function readConfirmed() {
    const dir = join(DOCS, "api-confirmed");
    const confirmed = new Map();
    if (!existsSync(dir)) return confirmed;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
        const { members } = JSON.parse(readFileSync(join(dir, file), "utf8"));
        const id = file.slice(0, -".json".length);
        for (const member of members) confirmed.set(member, [...(confirmed.get(member) ?? []), id]);
    }
    return confirmed;
}

const formatDownloads = (n) => n.toLocaleString("en-US");

function table(headers, rows) {
    return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

/** Gaps of one extension: used members whose class is not `ok`. */
export function extensionGaps(extension, classes) {
    return extension.members.filter((member) => GAP_CLASSES.has(classes.get(member)?.class)).map((member) => ({ member, class: classes.get(member).class }));
}

/**
 * Extensions a human should try next: the API is visible, every gap is wiring (A or B), and there
 * is at least one gap to close. Nearest first.
 */
export function pickCandidates(extensions, classes, limit = CANDIDATES) {
    return extensions
        .filter((e) => e.apiFound)
        .map((e) => ({ extension: e, gaps: extensionGaps(e, classes) }))
        .filter(({ gaps }) => gaps.length > 0 && gaps.every((g) => g.class === "A" || g.class === "B"))
        .sort((a, b) => a.gaps.length - b.gaps.length || b.extension.downloads - a.extension.downloads || a.extension.id.localeCompare(b.extension.id, "en"))
        .slice(0, limit);
}

/** @returns {Map<string, { count: number, weight: number }>} */
export function usage(extensions) {
    const used = new Map();
    for (const e of extensions) {
        for (const member of e.members) {
            const row = used.get(member) ?? { count: 0, weight: 0 };
            row.count++;
            row.weight += e.downloads;
            used.set(member, row);
        }
    }
    return used;
}

/** The whole document, a pure function of its inputs: same inputs, same bytes. */
export function renderMatrix({ surface, classes, survey, tagged, conformance, confirmed }) {
    const { extensions } = survey;
    const used = usage(extensions);
    const hasTest = (member) => tagged.has(member) || conformance.has(member);
    const withoutApi = extensions.filter((e) => !e.apiFound);
    const share = extensions.length === 0 ? 0 : (withoutApi.length / extensions.length) * 100;
    const out = [];

    out.push("# Extension x API matrix", "");
    out.push("Generated by `npm run api-matrix`, do not edit. Rules: [README.md](README.md).", "");
    out.push(
        `Survey of ${survey.date}: top ${String(survey.top)} of Open VSX by downloads without code-less themes and packs, plus the records of our registry: **${String(extensions.length)} extensions**. Upstream members: **${String(surface.size)}**.`,
        "",
    );
    out.push(
        `\`require("vscode")\` was not found in **${String(withoutApi.length)} of ${String(extensions.length)} bundles (${share.toFixed(1)}%)**; their usage below is "not found", not "none".`,
        "",
    );
    const silent = extensions.filter((e) => e.apiFound && e.members.length === 0);
    out.push(
        `In **${String(silent.length)}** more the API object was found but no member was resolved (it is passed around as a value)${silent.length === 0 ? "" : `: ${silent.map((e) => `\`${e.id}\``).join(", ")}`}.`,
        "",
    );
    out.push(
        "A member reached through a value (`editor.document.getText()`) has no syntactic link to the API, so interface members never show usage. False positives are possible; a zero means \"not found\".",
        "",
    );

    const byClass = CLASSES.map((c) => [c, String([...classes.values()].filter((v) => v.class === c).length)]);
    out.push("## Classes", "", table(["class", "members"], byClass), "");
    const counted = [...surface.keys()];
    out.push(
        table(
            ["mark", "members"],
            [
                ["test", String(counted.filter(hasTest).length)],
                ["confirmed by a real extension", String(counted.filter((m) => confirmed.has(m)).length)],
                ["used by a surveyed extension", String(counted.filter((m) => used.has(m)).length)],
            ],
        ),
        "",
    );

    const gaps = [...used.entries()]
        .filter(([member]) => GAP_CLASSES.has(classes.get(member)?.class))
        .sort(([a, x], [b, y]) => y.weight - x.weight || a.localeCompare(b, "en"))
        .slice(0, TOP_GAPS);
    out.push(`## Gap ranking`, "", `Members with a gap, by the downloads of the extensions using them (top ${String(TOP_GAPS)}).`, "");
    out.push(
        table(
            ["member", "class", "extensions", "downloads", "note"],
            gaps.map(([member, u]) => [`\`${member}\``, classes.get(member).class, String(u.count), formatDownloads(u.weight), classes.get(member).note ?? ""]),
        ),
        "",
    );

    const candidates = pickCandidates(extensions, classes);
    out.push("## Proposed extensions", "");
    out.push(
        `Up to ${String(CANDIDATES)} extensions whose whole gap is class A or B, nearest first. **Candidates for manual review:** a webview-centric extension cannot be detected automatically when it builds its UI in a way the survey does not see. Nothing here is confirmed yet: "ready" means class \`ok\`, the journal marks come later.`,
        "",
    );
    out.push(
        table(
            ["extension", "downloads", "gap", "why"],
            candidates.map(({ extension: e, gaps: g }) => [
                `\`${e.id}\``,
                formatDownloads(e.downloads),
                g.map((x) => `\`${x.member}\` (${x.class})`).join(", "),
                `${String(g.length)} A/B gap(s), no C or X; ${String(e.members.length - g.length)} of ${String(e.members.length)} used members ready`,
            ]),
        ),
        "",
    );

    const ranked = extensions
        .filter((e) => e.apiFound)
        .map((e) => ({ e, gaps: extensionGaps(e, classes) }))
        .sort((a, b) => a.gaps.length - b.gaps.length || b.e.downloads - a.e.downloads || a.e.id.localeCompare(b.e.id, "en"));
    const count = (gapList, c) => String(gapList.filter((g) => g.class === c).length);
    out.push("## Extension ranking", "", "By the size of the gap, smallest first.", "");
    out.push(
        table(
            ["extension", "version", "downloads", "registry", "members", "gap", "A", "B", "C", "X"],
            ranked.map(({ e, gaps: g }) => [
                `\`${e.id}\``,
                e.version,
                formatDownloads(e.downloads),
                e.inRegistry ? "yes" : "",
                String(e.members.length),
                String(g.length),
                count(g, "A"),
                count(g, "B"),
                count(g, "C"),
                count(g, "X"),
            ]),
        ),
        "",
    );

    if (withoutApi.length > 0) {
        out.push("## Bundles without a visible API", "", withoutApi.map((e) => `\`${e.id}\``).join(", "), "");
    }

    const outside = new Map();
    for (const e of extensions) for (const m of e.unknownMembers ?? []) outside.set(m, (outside.get(m) ?? 0) + 1);
    if (outside.size > 0) {
        out.push("## Paths outside vscode.d.ts", "", "Proposed API or a false hit: class X when real.", "");
        out.push(
            table(
                ["path", "extensions"],
                [...outside.entries()].sort(([a, x], [b, y]) => y - x || a.localeCompare(b, "en")).map(([m, n]) => [`\`${m}\``, String(n)]),
            ),
            "",
        );
    }

    out.push("## Members", "");
    out.push(
        table(
            ["member", "class", "test", "extensions", "downloads", "confirmed"],
            counted.sort((a, b) => a.localeCompare(b, "en")).map((member) => {
                const u = used.get(member);
                return [
                    `\`${member}\``,
                    classes.get(member)?.class ?? "?",
                    hasTest(member) ? "yes" : "",
                    u === undefined ? "0" : String(u.count),
                    u === undefined ? "0" : formatDownloads(u.weight),
                    confirmed.get(member)?.join(", ") ?? "",
                ];
            }),
        ),
        "",
    );
    return out.join("\n");
}

function main() {
    const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });
    const surface = loadSurface();
    const { classes, problems } = readClasses(join(DOCS, "api-matrix"));
    problems.push(...validateClasses(surface, classes));
    const tagged = readTaggedMembers();
    for (const [member, path] of tagged) {
        if (!surface.has(member)) problems.push(`${path}: [api:${member}] is not a member of vscode.d.ts`);
    }
    if (problems.length > 0) {
        for (const p of problems.slice(0, 50)) console.error(p);
        console.error(`api-matrix: ${String(problems.length)} problem(s)`);
        process.exitCode = 1;
        return;
    }
    const survey = JSON.parse(readFileSync(join(DOCS, "survey.json"), "utf8"));
    const rendered = renderMatrix({ surface, classes, survey, tagged, conformance: readConformanceMembers(), confirmed: readConfirmed() });
    if (!values.check) {
        writeFileSync(OUTPUT_PATH, rendered);
        console.log(`${relative(repoRoot, OUTPUT_PATH)}: ${String(surface.size)} members, ${String(survey.extensions.length)} extensions`);
        return;
    }
    if (!existsSync(OUTPUT_PATH) || readFileSync(OUTPUT_PATH, "utf8") !== rendered) {
        console.error("docs/extensions/api-matrix.generated.md is stale: run `npm run api-matrix`.");
        process.exitCode = 1;
    }
}

if (process.argv[1] === import.meta.filename) main();
