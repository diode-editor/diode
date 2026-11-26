import { describe, expect, it } from "vitest";

import { testId } from "../../../../../TestUtils/testTree.ts";
import { type IWireTestItem, TestResultState } from "../../../api/common/testingWireTypes.ts";

import {
    FilterResult,
    filterTest,
    parseTestExplorerFilter,
    TestFilterTerm,
    toggleFilterTerm,
} from "./testExplorerFilter.ts";

function item(label: string, tags: readonly string[] = []): IWireTestItem {
    return {
        extId: testId("vitest", label),
        label,
        tags,
        busy: false,
        range: null,
        description: null,
        error: null,
        sortText: null,
    };
}

const FILE = item("math.test.ts");
const SUITE = item("Math");
const ADDS = item("adds", [testId("vitest", "fast")]);
const SLOW = item("slow sum", [testId("vitest", "slow")]);

const result = (text: string, ...lineage: IWireTestItem[]): FilterResult =>
    filterTest(parseTestExplorerFilter(text), lineage, TestResultState.Unset);

describe("parseTestExplorerFilter (upstream TestExplorerFilterState.setText)", () => {
    it("splits globs by comma, lower-cases them, `!` excludes, empty parts are dropped", () => {
        expect(parseTestExplorerFilter("  Adds , !Slow,, ").globList).toEqual([
            { include: true, text: "adds" },
            { include: false, text: "slow" },
        ]);
        expect(parseTestExplorerFilter("").globList).toEqual([]);
    });

    it("a comma inside braces or brackets does not split", () => {
        expect(parseTestExplorerFilter("{a,b}").globList).toEqual([{ include: true, text: "{a,b}" }]);
    });

    it("`@ctrl:tag` and `!@ctrl:tag` are namespaced tags, quoted with escapes; they leave the text", () => {
        const filter = parseTestExplorerFilter(`adds @vitest:fast !@vitest:"very \\"slow\\"" sum`);
        expect([...filter.includeTags]).toEqual([testId("vitest", "fast")]);
        expect([...filter.excludeTags]).toEqual([testId("vitest", 'very "slow"')]);
        expect(filter.globList).toEqual([{ include: true, text: "adds sum" }]);
        expect([...parseTestExplorerFilter("@go:'unit'").includeTags]).toEqual([testId("go", "unit")]);
    });

    it("a filter term is taken out of the text, a plain `@word` is searched as text", () => {
        expect(parseTestExplorerFilter("@failed adds").globList).toEqual([{ include: true, text: "adds" }]);
        expect(parseTestExplorerFilter("adds @hidden").globList).toEqual([{ include: true, text: "adds" }]);
        expect(parseTestExplorerFilter("@smoke").globList).toEqual([{ include: true, text: "@smoke" }]);
    });

    it("a tag at the very end runs to the end of the text", () => {
        expect([...parseTestExplorerFilter("@vitest:fa").includeTags]).toEqual([testId("vitest", "fa")]);
        expect(parseTestExplorerFilter("@vitest:fa").globList).toEqual([]);
    });
});

describe("filterTest (upstream TestsFilter)", () => {
    it("no filter includes everything", () => {
        expect(result("", ADDS)).toBe(FilterResult.Include);
    });

    it("a substring of the label, case-insensitive, includes; a miss inherits from the descendants", () => {
        expect(result("ADD", ADDS, SUITE, FILE)).toBe(FilterResult.Include);
        expect(result("add", SUITE, FILE)).toBe(FilterResult.Inherit);
    });

    it("a match of an ancestor includes the test", () => {
        expect(result("math", ADDS, SUITE, FILE)).toBe(FilterResult.Include);
    });

    it("the nearest deciding label wins: an excluded test under an included ancestor is excluded", () => {
        expect(result("math, !slow", SLOW, SUITE)).toBe(FilterResult.Exclude);
        // The test itself decides first: an excluded ancestor hides it in the tree, not here.
        expect(result("!math", SUITE)).toBe(FilterResult.Exclude);
        expect(result("!math", ADDS, SUITE)).toBe(FilterResult.Include);
    });

    it("a leading negation shows what it does not match", () => {
        expect(result("!slow", ADDS, SUITE, FILE)).toBe(FilterResult.Include);
        expect(result("!slow", SLOW)).toBe(FilterResult.Exclude);
    });

    it("the later glob overrides the earlier one on the same label", () => {
        expect(result("!sum, slow", SLOW)).toBe(FilterResult.Include);
        expect(result("slow, !sum", SLOW)).toBe(FilterResult.Exclude);
    });

    it("an included tag includes the tests that have it; others inherit", () => {
        expect(result("@vitest:fast", ADDS)).toBe(FilterResult.Include);
        expect(result("@vitest:fast", SLOW)).toBe(FilterResult.Inherit);
        expect(result("@go:fast", ADDS)).toBe(FilterResult.Inherit);
    });

    it("an excluded tag keeps its tests out unless a descendant is in", () => {
        expect(result("!@vitest:slow", SLOW)).toBe(FilterResult.Inherit);
        expect(result("!@vitest:slow", ADDS)).toBe(FilterResult.Include);
    });

    it("one included tag of several is enough; one excluded tag of several is too many", () => {
        const both = item("both", [testId("vitest", "fast"), testId("vitest", "slow")]);
        expect(result("@vitest:fast", both)).toBe(FilterResult.Include);
        expect(result("!@vitest:slow", both)).toBe(FilterResult.Inherit);
    });

    it("text and tags both have to hold", () => {
        expect(result("adds @vitest:fast", ADDS)).toBe(FilterResult.Include);
        expect(result("sum @vitest:fast", SLOW)).toBe(FilterResult.Inherit);
        expect(result("!adds @vitest:fast", ADDS)).toBe(FilterResult.Exclude);
    });
});

describe("toggleFilterTerm (upstream toggleFilteringFor)", () => {
    it("appends the term after the text, takes out only its own token", () => {
        expect(toggleFilterTerm("", TestFilterTerm.Failed)).toBe("@failed");
        expect(toggleFilterTerm(" adds ", TestFilterTerm.Failed)).toBe("adds @failed");
        expect(toggleFilterTerm("adds @failed  !slow", TestFilterTerm.Failed)).toBe("adds !slow");
        expect(toggleFilterTerm("@failed", TestFilterTerm.Failed)).toBe("");
    });

    it("@failed keeps failed and errored tests, @executed every test with a state", () => {
        const failed = parseTestExplorerFilter("@failed");
        const executed = parseTestExplorerFilter("@executed");
        expect(filterTest(failed, [ADDS], TestResultState.Errored)).toBe(FilterResult.Include);
        expect(filterTest(failed, [ADDS], TestResultState.Passed)).toBe(FilterResult.Inherit);
        expect(filterTest(executed, [ADDS], TestResultState.Skipped)).toBe(FilterResult.Include);
        expect(filterTest(executed, [ADDS], TestResultState.Unset)).toBe(FilterResult.Inherit);
    });
});
