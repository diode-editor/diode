// Запуск: npm run test:scripts (node --test).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
    applyMutant,
    blockingVerdicts,
    buildReverseImportGraph,
    countClasses,
    coveringTestFiles,
    equivalentHint,
    importSpecifiers,
    isCandidate,
    killers,
    offsetOf,
    parseVitestJson,
    relatedTestFiles,
    resolveSpecifier,
    runtimeErrorExcerpt,
    siblingTestFiles,
} from "./mutation-inject.mjs";

const at = (line, column, endLine, endColumn) => ({
    start: { line, column },
    end: { line: endLine, column: endColumn },
});

test("applyMutant: ровно диапазон [start, end) — левый операнд `||`, а не всё условие", () => {
    const source = 'x;\nif (typeof v !== "object" || v === null) return;\n';
    // Колонки Stryker'а 1-based: `typeof` начинается с 5-й.
    const mutated = applyMutant(source, { location: at(2, 5, 2, 26), replacement: "false" });
    assert.equal(mutated, "x;\nif (false || v === null) return;\n");
});

test("applyMutant: многострочный мутант (вырезанное тело)", () => {
    const source = "function f() {\n    a();\n    b();\n}\n";
    assert.equal(applyMutant(source, { location: at(1, 14, 4, 2), replacement: "{}" }), "function f() {}\n");
});

test("offsetOf: конец сразу за последним символом строки допустим, дальше — ошибка", () => {
    assert.equal(offsetOf("ab\ncd", { line: 2, column: 3 }), 5);
    assert.throws(() => offsetOf("ab\ncd", { line: 2, column: 4 }), /колонки/);
    assert.throws(() => offsetOf("ab", { line: 3, column: 1 }), /строки/);
});

test("isCandidate: всё, что Stryker не записал убитым и не погасил", () => {
    for (const status of ["Survived", "NoCoverage", "RuntimeError"]) assert.ok(isCandidate({ status }), status);
    for (const status of ["Killed", "Timeout", "Ignored", "CompileError", "Pending"])
        assert.ok(!isCandidate({ status }), status);
});

test("coveringTestFiles: id тестов из coveredBy → их файлы", () => {
    const report = {
        testFiles: {
            "src/a.test.ts": { tests: [{ id: "1" }, { id: "2" }] },
            "src/b.test.ts": { tests: [{ id: "3" }] },
            "src/c.test.ts": { tests: [{ id: "4" }] },
        },
    };
    assert.deepEqual(coveringTestFiles(report, { coveredBy: ["2", "4"] }), ["src/a.test.ts", "src/c.test.ts"]);
    assert.deepEqual(coveringTestFiles(report, {}), []);
});

test("siblingTestFiles: свой каталог, своё имя, подразделы — но не тёзки-префиксы", () => {
    const all = [
        "src/x/a.test.ts",
        "src/x/a.events.test.ts",
        "src/x/ab.test.ts",
        "src/x/sub/a.test.ts",
        "src/y/a.test.ts",
    ];
    assert.deepEqual(siblingTestFiles("src/x/a.ts", all), ["src/x/a.events.test.ts", "src/x/a.test.ts"]);
});

test("importSpecifiers: многострочный import, export from, side-effect, dynamic, vi.mock; пакеты — нет", () => {
    const text = `import {\n  a,\n  b,\n} from "./a.js";\nimport type { T } from "../t.js";\nexport * from "./re.js";\nimport "./side.js";\nconst m = await import("./lazy.js");\nvi.mock("./mocked.js");\nimport { x } from "vitest";\n`;
    assert.deepEqual(importSpecifiers(text).sort(), [
        "../t.js",
        "./a.js",
        "./lazy.js",
        "./mocked.js",
        "./re.js",
        "./side.js",
    ]);
});

test("resolveSpecifier: .js → .ts, без расширения, index, выход вверх", () => {
    const known = new Set(["src/a/b.ts", "src/c/index.ts", "src/d.ts"]);
    assert.equal(resolveSpecifier("src/a/x.ts", "./b.js", known), "src/a/b.ts");
    assert.equal(resolveSpecifier("src/a/x.ts", "../c", known), "src/c/index.ts");
    assert.equal(resolveSpecifier("src/a/x.ts", "../d", known), "src/d.ts");
    assert.equal(resolveSpecifier("src/a/x.ts", "./nope.js", known), null);
});

test("relatedTestFiles: транзитивно через нетестовые модули, без циклов", () => {
    const sources = new Map([
        ["src/core.ts", 'import { w } from "./wrap.js";'], // цикл
        ["src/wrap.ts", 'import { c } from "./core.js";'],
        ["src/ui/view.ts", 'import { w } from "../wrap.js";'],
        ["src/ui/view.test.ts", 'import { v } from "./view.js";'],
        ["src/other.test.ts", 'import { o } from "./other.js";'],
        ["src/other.ts", ""],
    ]);
    const graph = buildReverseImportGraph(sources);
    assert.deepEqual(relatedTestFiles("src/core.ts", graph), ["src/ui/view.test.ts"]);
});

const vitestJson = (results) => ({
    numTotalTests: 0,
    testResults: results.map(([name, status, assertions]) => ({
        name,
        status,
        assertionResults: assertions.map(([fullName, s]) => ({ fullName, status: s })),
    })),
});

test("killers: улика — только тест, зелёный без мутанта; файл целиком — если без мутанта он грузился", () => {
    const base = parseVitestJson(
        vitestJson([
            [
                "/p/a.test.ts",
                "failed",
                [
                    ["t1", "passed"],
                    ["t2", "failed"],
                ],
            ],
            ["/p/b.test.ts", "passed", [["t3", "passed"]]],
        ]),
    );
    const mutated = parseVitestJson(
        vitestJson([
            [
                "/p/a.test.ts",
                "failed",
                [
                    ["t1", "failed"],
                    ["t2", "failed"],
                ],
            ],
            ["/p/b.test.ts", "failed", []],
        ]),
    );
    const found = killers(base, mutated);
    assert.deepEqual(found.tests, ["/p/a.test.ts > t1"]);
    assert.deepEqual(found.files, ["/p/b.test.ts"]);
    assert.ok(found.any);
    // Красное и без мутанта — не улика.
    assert.ok(!killers(base, parseVitestJson(vitestJson([["/p/a.test.ts", "failed", [["t2", "failed"]]]]))).any);
});

test("runtimeErrorExcerpt: вырезает блок Unhandled Errors без ANSI, нет маркера — null", () => {
    const output =
        "ok\n\u001b[31m⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯\u001b[39m\n\nVitest caught 1 unhandled error during the test run.\nThis might cause false positive tests.\n⎯⎯⎯⎯ Uncaught Exception ⎯⎯⎯⎯\nTypeError: Cannot read properties of null\n at later (src/calc.ts:11)\n";
    assert.equal(
        runtimeErrorExcerpt(output),
        "Unhandled Errors\nUncaught Exception\nTypeError: Cannot read properties of null\nat later (src/calc.ts:11)",
    );
    assert.equal(runtimeErrorExcerpt("Test Files 1 passed"), null);
});

test("equivalentHint: граница, человекочитаемая строка, охраняющее условие с убитым соседом", () => {
    const source = 'if (i < n) log("готово к работе");\nif (ready) go();\n';
    assert.match(
        equivalentHint(
            source,
            { mutatorName: "EqualityOperator", replacement: "i <= n", location: at(1, 5, 1, 10) },
            [],
        ),
        /граничный/,
    );
    assert.equal(
        equivalentHint(
            source,
            { mutatorName: "EqualityOperator", replacement: "i >= n", location: at(1, 5, 1, 10) },
            [],
        ),
        null,
    );
    assert.match(
        equivalentHint(source, { mutatorName: "StringLiteral", replacement: '""', location: at(1, 16, 1, 33) }, []),
        /человекочитаемая/,
    );
    const self = {
        mutatorName: "ConditionalExpression",
        replacement: "true",
        status: "Survived",
        location: at(2, 5, 2, 10),
    };
    const killed = {
        mutatorName: "ConditionalExpression",
        replacement: "false",
        status: "Killed",
        location: at(2, 5, 2, 10),
    };
    assert.match(equivalentHint(source, self, [self, killed]), /охраняющее условие/);
    assert.equal(equivalentHint(source, self, [self, { ...killed, status: "Survived" }]), null);
});

test("countClasses/blockingVerdicts: real и phantom гейт сами не красят — красят балл и Killed", () => {
    const verdicts = ["real", "phantom", "phantom", "stale", "timeout", "inconclusive", "runtime-error"].map((cls) => ({
        class: cls,
    }));
    assert.deepEqual(countClasses(verdicts), {
        real: 1,
        "runtime-error": 1,
        inconclusive: 1,
        timeout: 1,
        stale: 1,
        phantom: 2,
    });
    assert.deepEqual(
        blockingVerdicts(verdicts)
            .map((v) => v.class)
            .sort(),
        ["inconclusive", "runtime-error", "stale", "timeout"],
    );
});
