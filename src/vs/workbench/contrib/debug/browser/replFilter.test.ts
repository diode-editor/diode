import { describe, expect, it } from "vitest";

import { TestVariable } from "../../../../../TestUtils/debugViewsFixture.ts";
import { mockSession } from "../../../../../TestUtils/mockDebug.ts";
import type { IReplElementSource } from "../common/debug.ts";
import { ReplEvaluationInput, ReplEvaluationResult, ReplGroup, ReplOutputElement } from "../common/replModel.ts";

import { ReplFilter } from "./replFilter.ts";

const session = mockSession();

function output(value: string): ReplOutputElement {
    return new ReplOutputElement(session, value, value, "info");
}

function filterOf(query: string): ReplFilter {
    const filter = new ReplFilter();
    filter.filterQuery = query;
    return filter;
}

describe("ReplFilter", () => {
    it("shows everything without a query, or with only commas and spaces", () => {
        expect(filterOf("").filter(output("a"))).toBe(true);
        expect(filterOf(" , ,").filter(output("a"))).toBe(true);
    });

    it("an inclusion shows what matches any of them, case-insensitive, with * as a wildcard", () => {
        const filter = filterOf("err, Warn*ing");
        expect(filter.filter(output("ERROR: x"))).toBe(true);
        expect(filter.filter(output("warn: the warning"))).toBe(true);
        expect(filter.filter(output("info"))).toBe(false);
        // The wildcard spans characters; the parts are trimmed.
        expect(filterOf("  e*x  ").filter(output("error x"))).toBe(true);
        expect(filterOf("  e*x  ").filter(output("error"))).toBe(false);
    });

    it("an empty part between commas is no inclusion that matches everything", () => {
        expect(filterOf("x, ,").filter(output("y"))).toBe(false);
    });

    it("an exclusion hides what it matches over any inclusion; a backslash escapes the `!`", () => {
        const filter = filterOf("line, !secret");
        expect(filter.filter(output("a line"))).toBe(true);
        expect(filter.filter(output("a secret line"))).toBe(false);
        expect(filterOf("\\!bang").filter(output("a !bang"))).toBe(true);
        expect(filterOf("\\!bang").filter(output("a bang"))).toBe(false);
    });

    it("takes regex characters literally", () => {
        const filter = filterOf("a.b(c)[d]{e}|f+g?^$/\\h");
        expect(filter.filter(output("x a.b(c)[d]{e}|f+g?^$/\\h y"))).toBe(true);
        expect(filter.filter(output("aXb(c)[d]{e}|f+g?^$/\\h"))).toBe(false);
    });

    it("leaves evaluations and variables visible", () => {
        const filter = filterOf("nothing");
        expect(filter.filter(new ReplEvaluationInput("x"))).toBe(true);
        expect(filter.filter(new ReplEvaluationResult("x"))).toBe(true);
        expect(filter.filter(new TestVariable("v", "1"))).toBe(true);
    });

    it("without an inclusion an element is shown unless excluded; the source is matched too", () => {
        const filter = filterOf("!hidden");
        expect(filter.filter(output("shown"))).toBe(true);
        const source = { source: { name: "hidden.ts" }, lineNumber: 1, column: 1 } as unknown as IReplElementSource;
        const group = new ReplGroup(session, "group", true, source);
        expect(filter.filter(group)).toBe(false);
    });
});
