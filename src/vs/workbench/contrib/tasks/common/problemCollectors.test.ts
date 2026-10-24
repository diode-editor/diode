import { afterEach, describe, expect, it, vi } from "vitest";

import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { type IMarkerData, MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerService } from "../../../../platform/markers/common/markerService.ts";

import { StartStopProblemCollector } from "./problemCollectors.ts";
import { getBuiltinProblemMatcher, type IProblemMatcher } from "./problemMatcher.ts";

const A = Uri.file("/ws/a.ts").toString();
const B = Uri.file("/ws/b.ts").toString();
const C = Uri.file("/ws/c.ts").toString();

/** `/ws/a.ts(line,col): error|warning CODE: message` */
function matcher(overrides: Partial<IProblemMatcher> = {}): IProblemMatcher {
    return { ...getBuiltinProblemMatcher("$msCompile")!, ...overrides };
}

function marker(line: number, message = "old"): IMarkerData {
    return { severity: MarkerSeverity.Error, range: createRange(line, 0, line, 0), message };
}

function build(matchers: readonly IProblemMatcher[], open: readonly string[] = []) {
    const markers = new MarkerService();
    const changeOne = vi.spyOn(markers, "changeOne");
    const make = () =>
        new StartStopProblemCollector(matchers, {
            markers,
            isOpen: (resource) => open.includes(resource),
            files: { exists: () => Promise.resolve(false), resolve: () => Promise.reject(new Error("no fs")) },
        });
    const messages = (owner: string, resource: string): string[] =>
        markers.read({ owner, resource }).map((m) => m.message);
    return { markers, changeOne, make, messages };
}

/** Lines are matched in order, each after the previous one's resource resolved. */
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
    setUnexpectedErrorHandler((e) => {
        console.error(e);
    });
});

describe("StartStopProblemCollector", () => {
    it("markers of a resource are delivered once the output moves on; the last ones by done()", async () => {
        const h = build([matcher()]);
        const collector = h.make();
        collector.processLine("/ws/a.ts(1,2): error E1: one");
        collector.processLine("/ws/a.ts(3,4): warning W2: two");
        collector.processLine("unrelated output");
        await settle();
        expect(h.changeOne).not.toHaveBeenCalled();
        collector.processLine("/ws/b.ts(5,6): error E3: three");
        await settle();
        expect(h.messages("msCompile", A)).toStrictEqual(["one", "two"]);
        expect(h.messages("msCompile", B)).toStrictEqual([]);
        await collector.done();
        expect(h.messages("msCompile", B)).toStrictEqual(["three"]);
        expect(h.markers.read({ owner: "msCompile", resource: A })[0]).toMatchObject({
            severity: MarkerSeverity.Error,
            range: createRange(0, 1, 0, 1),
            code: "E1",
            source: "cpp",
        });
        expect(collector.numberOfMatches).toBe(3);
        expect(collector.maxMarkerSeverity).toBe(MarkerSeverity.Error);
    });

    it("max severity is the highest found; nothing found leaves it undefined", async () => {
        const h = build([matcher()]);
        const warnings = h.make();
        warnings.processLine("/ws/a.ts(1,1): info I1: i");
        warnings.processLine("/ws/a.ts(2,1): warning W1: w");
        warnings.processLine("/ws/a.ts(3,1): info I2: i2");
        await warnings.done();
        expect(warnings.maxMarkerSeverity).toBe(MarkerSeverity.Warning);
        const none = h.make();
        none.processLine("all good");
        await none.done();
        expect(none.numberOfMatches).toBe(0);
        expect(none.maxMarkerSeverity).toBeUndefined();
    });

    it("clean: a mentioned resource gets the new set, an unmentioned one is cleared; other owners stay", async () => {
        const h = build([matcher()]);
        h.markers.changeOne("msCompile", A, [marker(0), marker(1)]);
        h.markers.changeOne("msCompile", B, [marker(0)]);
        h.markers.changeOne("typescript", B, [marker(4, "lsp")]);
        const collector = h.make();
        collector.processLine("/ws/a.ts(9,1): error E1: fresh");
        await collector.done();
        expect(h.messages("msCompile", A)).toStrictEqual(["fresh"]);
        expect(h.messages("msCompile", B)).toStrictEqual([]);
        expect(h.messages("typescript", B)).toStrictEqual(["lsp"]);
    });

    it("a resource mentioned with problems that applyTo filters out is still not cleaned", async () => {
        const h = build([matcher({ applyTo: "closedDocuments" })], [A]);
        h.markers.changeOne("msCompile", A, [marker(0)]);
        const collector = h.make();
        collector.processLine("/ws/a.ts(1,1): error E1: skipped");
        await collector.done();
        expect(h.messages("msCompile", A)).toStrictEqual(["old"]);
    });

    it("applyTo openDocuments: only open files get markers, only open files are cleaned", async () => {
        const h = build([matcher({ applyTo: "openDocuments" })], [A, C]);
        h.markers.changeOne("msCompile", B, [marker(0)]);
        h.markers.changeOne("msCompile", C, [marker(0)]);
        const collector = h.make();
        collector.processLine("/ws/a.ts(1,1): error E1: open");
        collector.processLine("/ws/b.ts(1,1): error E1: closed");
        await collector.done();
        expect(h.messages("msCompile", A)).toStrictEqual(["open"]);
        expect(h.messages("msCompile", B)).toStrictEqual(["old"]);
        expect(h.messages("msCompile", C)).toStrictEqual([]);
    });

    it("applyTo closedDocuments: the opposite", async () => {
        const h = build([matcher({ applyTo: "closedDocuments" })], [A, C]);
        h.markers.changeOne("msCompile", B, [marker(0)]);
        h.markers.changeOne("msCompile", C, [marker(0)]);
        const collector = h.make();
        collector.processLine("/ws/a.ts(1,1): error E1: open");
        await collector.done();
        expect(h.messages("msCompile", A)).toStrictEqual([]);
        expect(h.messages("msCompile", B)).toStrictEqual([]);
        expect(h.messages("msCompile", C)).toStrictEqual(["old"]);
    });

    it("an owner's matchers with different applyTo clean all documents; the same applyTo keeps it", async () => {
        const mixed = build([matcher({ applyTo: "openDocuments" }), matcher({ applyTo: "closedDocuments" })], [A]);
        mixed.markers.changeOne("msCompile", A, [marker(0)]);
        mixed.markers.changeOne("msCompile", B, [marker(0)]);
        await mixed.make().done();
        expect(mixed.markers.read({ owner: "msCompile" })).toStrictEqual([]);
        const same = build([matcher({ applyTo: "openDocuments" }), matcher({ applyTo: "openDocuments" })], [A]);
        same.markers.changeOne("msCompile", A, [marker(0)]);
        same.markers.changeOne("msCompile", B, [marker(0)]);
        await same.make().done();
        expect(same.markers.read({ owner: "msCompile" }).map((m) => m.resource)).toStrictEqual([B]);
    });

    it("the same problem twice (another message) is one marker, the first", async () => {
        const h = build([matcher()]);
        const collector = h.make();
        collector.processLine("/ws/a.ts(1,1): error E1: first");
        collector.processLine("/ws/a.ts(1,1): error E1: second");
        collector.processLine("/ws/a.ts(1,1): error E2: other code");
        collector.processLine("/ws/a.ts(1,1): warning E1: other severity");
        await collector.done();
        expect(h.messages("msCompile", A)).toStrictEqual(["first", "other code", "other severity"]);
        expect(collector.numberOfMatches).toBe(4);
    });

    it("thousands of lines: one delivery per resource, not per line", async () => {
        const h = build([matcher()]);
        const collector = h.make();
        for (const file of ["a", "b", "c"]) {
            for (let line = 1; line <= 1000; line++)
                collector.processLine(`/ws/${file}.ts(${line},1): error E1: m${line}`);
        }
        await collector.done();
        expect(h.changeOne.mock.calls.map(([, resource, list]) => [resource, list.length])).toStrictEqual([
            [A, 1000],
            [B, 1000],
            [C, 1000],
        ]);
    });

    it("done() delivers again only what grew since the last delivery", async () => {
        const h = build([matcher()]);
        const collector = h.make();
        collector.processLine("/ws/a.ts(1,1): error E1: one");
        collector.processLine("/ws/b.ts(1,1): error E1: two");
        collector.processLine("/ws/a.ts(1,1): error E1: duplicate");
        collector.processLine("/ws/b.ts(2,1): error E1: three");
        await collector.done();
        expect(h.changeOne.mock.calls.map(([, resource, list]) => [resource, list.length])).toStrictEqual([
            [A, 1],
            [B, 1],
            [B, 2],
        ]);
    });

    it("single-line and multi-line matchers together: the longer pattern is tried first", async () => {
        const stylish = getBuiltinProblemMatcher("$eslint-stylish")!;
        const h = build([matcher(), stylish]);
        const collector = h.make();
        for (const line of [
            "/ws/a.ts(1,1): error E1: ms",
            "/ws/b.ts",
            "  2:3  warning  Unexpected console statement  no-console",
            "  4:5  error  Missing semicolon  semi",
            "/ws/a.ts(7,1): error E2: ms again",
        ]) {
            collector.processLine(line);
        }
        await collector.done();
        expect(h.messages("msCompile", A)).toStrictEqual(["ms", "ms again"]);
        expect(h.messages("eslint", B)).toStrictEqual(["Unexpected console statement", "Missing semicolon"]);
    });

    it("a file name that can't be resolved is reported and skipped; later lines still match", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        const noPrefix = matcher({
            fileLocation: "relative",
            pattern: { regexp: /^REL (\S+):(\d+) (.*)$/, file: 1, line: 2, message: 3 },
        });
        const h = build([noPrefix, matcher({ owner: "other" })]);
        const collector = h.make();
        collector.processLine("REL a.ts:1 no prefix");
        collector.processLine("/ws/b.ts(1,1): error E1: fine");
        await collector.done();
        expect(errors).toHaveLength(1);
        expect(h.markers.read().map((m) => [m.owner, m.message])).toStrictEqual([["other", "fine"]]);
    });
});
