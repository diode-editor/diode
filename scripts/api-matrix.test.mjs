import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { conformanceMembers, extensionGaps, findApiTags, pickCandidates, readClasses, renderMatrix, usage, validateClasses } from "./api-matrix.mjs";

const surface = new Map([
    ["window.a", { kind: "namespace", owner: "window" }],
    ["window.b", { kind: "namespace", owner: "window" }],
    ["window.c", { kind: "namespace", owner: "window" }],
    ["window.x", { kind: "namespace", owner: "window" }],
]);
const classes = new Map([
    ["window.a", { class: "ok" }],
    ["window.b", { class: "B", note: "no wiring" }],
    ["window.c", { class: "C" }],
    ["window.x", { class: "X" }],
]);
const ext = (id, downloads, members, extra = {}) => ({ id, version: "1.0.0", downloads, members, apiFound: true, inRegistry: false, unknownMembers: [], ...extra });

test("every member needs a valid class and every class a real member", () => {
    assert.deepEqual(validateClasses(surface, classes), []);
    const broken = new Map(classes);
    broken.delete("window.a");
    broken.set("window.gone", { class: "ok" });
    broken.set("window.b", { class: "Z" });
    assert.deepEqual(validateClasses(surface, broken), [
        "window.a: no class in docs/extensions/api-matrix/",
        'window.b: unknown class "Z"',
        "window.gone: not in vscode.d.ts",
    ]);
});

test("a member listed in two files is an error", () => {
    const dir = mkdtempSync(join(tmpdir(), "api-matrix-test-"));
    try {
        writeFileSync(join(dir, "one.json"), JSON.stringify({ members: { "window.a": { class: "ok" } } }));
        writeFileSync(join(dir, "two.json"), JSON.stringify({ members: { "window.a": { class: "B" } } }));
        writeFileSync(join(dir, "ignored.txt"), "not json");
        const { classes: read, problems } = readClasses(dir);
        assert.equal(read.size, 1);
        assert.deepEqual(problems, ["window.a: listed twice (two.json)"]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("api tags: several per title", () => {
    assert.deepEqual(findApiTags(`test("shows [api:window.showTextDocument][api:Uri.file] and more", () => {}); // [not:a.tag]`), ["window.showTextDocument", "Uri.file"]);
});

test("a conformance test proves its members only while it is green", () => {
    const proven = conformanceMembers(
        { "window Tabs work": ["window.tabGroups"], "window Red test": ["window.a"], "other Green": ["window.b"], malformed: ["window.c"] },
        (suite) => new Set(suite === "window" ? ["Tabs work"] : suite === "other" ? ["Green"] : []),
    );
    assert.deepEqual([...proven].sort(), ["window.b", "window.tabGroups"]);
});

test("usage counts extensions and sums downloads", () => {
    const used = usage([ext("a", 10, ["window.a", "window.b"]), ext("b", 5, ["window.a"])]);
    assert.deepEqual(used.get("window.a"), { count: 2, weight: 15 });
    assert.deepEqual(used.get("window.b"), { count: 1, weight: 10 });
});

test("a gap is any non-ok class", () => {
    assert.deepEqual(extensionGaps(ext("a", 1, ["window.a", "window.b", "window.x"]), classes), [
        { member: "window.b", class: "B" },
        { member: "window.x", class: "X" },
    ]);
});

test("candidates: only A and B gaps, at least one, API visible, nearest first", () => {
    const picked = pickCandidates(
        [
            ext("noGap", 100, ["window.a"]),
            ext("withC", 100, ["window.b", "window.c"]),
            ext("withX", 100, ["window.b", "window.x"]),
            ext("hidden", 100, ["window.b"], { apiFound: false }),
            ext("small", 1, ["window.a", "window.b"]),
            ext("big", 50, ["window.b"]),
        ],
        classes,
    );
    assert.deepEqual(
        picked.map((c) => c.extension.id),
        ["big", "small"],
    );
    assert.equal(pickCandidates([ext("a", 1, ["window.b"]), ext("b", 2, ["window.b"])], classes, 1).length, 1);
});

const inputs = () => ({
    surface,
    classes,
    survey: { date: "2026-10-30", top: 2, extensions: [ext("pub.big", 1000, ["window.a", "window.b"]), ext("pub.hidden", 5, [], { apiFound: false }), ext("pub.c", 7, ["window.c"], { unknownMembers: ["window.proposed"] })] },
    tagged: new Map([["window.a", "src/a.test.ts"]]),
    conformance: new Set(["window.b"]),
    confirmed: new Map([["window.a", ["pub.big"]]]),
});

test("the document answers both questions and is deterministic", () => {
    const text = renderMatrix(inputs());
    assert.equal(text, renderMatrix(inputs()));
    assert.match(text, /\| `window\.a` \| ok \| yes \| 1 \| 1,000 \| pub\.big \|/);
    assert.match(text, /\| `window\.b` \| B \| yes \| 1 \| 1,000 \|  \|/);
    assert.match(text, /\| `window\.x` \| X \|  \| 0 \| 0 \|  \|/);
    assert.match(text, /not found in \*\*1 of 3 bundles \(33\.3%\)\*\*/);
    assert.match(text, /## Gap ranking[\s\S]*\| `window\.b` \| B \| 1 \| 1,000 \| no wiring \|[\s\S]*## Proposed/);
    assert.match(text, /## Proposed extensions[\s\S]*`pub\.big`[\s\S]*Candidates for manual review|Candidates for manual review[\s\S]*`pub\.big`/);
    assert.match(text, /## Bundles without a visible API\n\n`pub\.hidden`/);
    assert.match(text, /`window\.proposed` \| 1 \|/);
});

test("an empty survey still renders", () => {
    assert.match(renderMatrix({ ...inputs(), survey: { date: "d", top: 0, extensions: [] } }), /0 of 0 bundles \(0\.0%\)/);
});
