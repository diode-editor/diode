import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { findApiTags, pickCandidates, readClasses, renderMatrix } from "./api-matrix.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionsDocs = join(repoRoot, "docs", "extensions");

const ext = (id, downloads, members, extra = {}) => ({ id, version: "1.0.0", downloads, members, apiFound: true, inRegistry: false, unknownMembers: [], contributes: [], activationEvents: [], ...extra });

test("only the title of a running test gives the test mark", () => {
    assert.deepEqual(findApiTags(`test("x [api:window.a]", () => {});`), ["window.a"]);
    assert.deepEqual(findApiTags(`// [api:window.comment] to be written\ntest("x", () => {});`), []);
    assert.deepEqual(findApiTags(`const fixture = "[api:window.string]";`), []);
    assert.deepEqual(findApiTags(`test.skip("[api:window.skipped]", () => {});`), []);
    assert.deepEqual(findApiTags(`it.todo("[api:window.todo]");`), []);
});

test("an extension with no resolved member is not ranked as having no gap", () => {
    const surface = new Map([["window.a", { kind: "namespace", owner: "window" }]]);
    const classes = new Map([["window.a", { class: "ok" }]]);
    const text = renderMatrix({
        surface,
        classes,
        survey: { date: "d", top: 1, extensions: [ext("pub.opaque", 100, []), ext("pub.seen", 50, ["window.a"])] },
        tagged: new Map(),
        conformance: new Set(),
        confirmed: new Map(),
    });
    const ranking = text.slice(text.indexOf("## Extension ranking"), text.indexOf("## Bundles without a visible API"));
    assert.match(ranking, /`pub\.seen`/);
    const opaqueRow = ranking.split("\n").find((line) => line.includes("`pub.opaque`"));
    assert.doesNotMatch(opaqueRow ?? "", /\| 0 \| 0 \| 0 \| 0 \| 0 \| 0 \|$/, "a zero here means 'not found', the row reads as 'nothing is missing'");
});

test("an extension contributing an icon theme has a class C gap and is not proposed", () => {
    // The epic names icon themes in class C; they are reached through contributes, not through a member.
    const classes = new Map([
        ["window.a", { class: "ok" }],
        ["window.b", { class: "B" }],
    ]);
    const candidates = pickCandidates([ext("pub.icons", 100, ["window.a", "window.b"], { contributes: ["iconThemes"] }), ext("pub.plain", 50, ["window.a", "window.b"])], classes);
    const ids = candidates.map((candidate) => candidate.extension?.id ?? candidate.id);
    assert.deepEqual(ids, ["pub.plain"]);
});

test("the committed proposal has no icon theme extension", () => {
    const survey = JSON.parse(readFileSync(join(extensionsDocs, "survey.json"), "utf8"));
    const matrix = readFileSync(join(extensionsDocs, "api-matrix.generated.md"), "utf8");
    const proposal = matrix.slice(matrix.indexOf("## Proposed extensions"), matrix.indexOf("## Extension ranking"));
    const proposedIconThemes = survey.extensions.filter((extension) => extension.contributes.includes("iconThemes") && proposal.includes(`\`${extension.id}\``)).map((extension) => extension.id);
    assert.deepEqual(proposedIconThemes, []);
});

test("a value the extension host does export is not a gap for being undeclared in vscode.d.ts", () => {
    const namespaceSource = readFileSync(join(repoRoot, "src", "vs", "workbench", "api", "common", "vscodeNamespace.ts"), "utf8");
    const { classes } = readClasses(join(extensionsDocs, "api-matrix"));
    const isExported = (name) => new RegExp(`^\\s*${name},$`, "m").test(namespaceSource);
    // A type or an enum value: a CompletionItem field depends on wiring, so fields stay out of this check.
    const isValue = (member) => /^[A-Z]\w*(\.[A-Z]\w*)?$/.test(member);
    const falseGaps = [...classes]
        .filter(([member, entry]) => entry.class !== "ok" && /not declared/.test(entry.note ?? "") && isValue(member) && isExported(member.split(".")[0]))
        .map(([member]) => member);
    assert.deepEqual(falseGaps, []);
});
