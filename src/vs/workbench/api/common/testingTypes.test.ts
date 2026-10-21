import { describe, expect, it } from "vitest";

import {
    BranchCoverage,
    DeclarationCoverage,
    FileCoverage,
    StatementCoverage,
    TestCoverageCount,
    TestMessage,
    TestMessageStackFrame,
    TestRunProfileKind,
    TestRunRequest,
    TestTag,
} from "./testingTypes.ts";
import { MarkdownString, Position, Range, Uri } from "./vscodeTypes.ts";

const uri = Uri.file("/w/a_test.go");
const at = new Position(1, 0);

describe("Test API value types — per upstream", () => {
    it("TestRunProfileKind", () => {
        expect([TestRunProfileKind.Run, TestRunProfileKind.Debug, TestRunProfileKind.Coverage]).toEqual([1, 2, 3]);
    });

    it("TestTag and TestRunRequest with upstream defaults", () => {
        expect(new TestTag("unit").id).toBe("unit");
        expect(new TestRunRequest()).toEqual({
            include: undefined,
            exclude: undefined,
            profile: undefined,
            continuous: false,
            preserveFocus: true,
        });
        const item = { id: "A" } as never;
        expect(new TestRunRequest([item], [], undefined, true, false)).toMatchObject({
            include: [item],
            exclude: [],
            continuous: true,
            preserveFocus: false,
        });
    });

    it("TestMessage and diff, stack frame", () => {
        const message = new TestMessage(new MarkdownString("**bad**"));
        expect(message.message).toBeInstanceOf(MarkdownString);
        expect(message.expectedOutput).toBeUndefined();
        const diff = TestMessage.diff("mismatch", "1", "2");
        expect(diff).toBeInstanceOf(TestMessage);
        expect(diff).toMatchObject({ message: "mismatch", expectedOutput: "1", actualOutput: "2" });
        expect(new TestMessageStackFrame("main", uri, at)).toEqual({ label: "main", uri, position: at });
    });

    it("TestCoverageCount checks bounds with upstream messages", () => {
        expect(new TestCoverageCount(2, 2)).toEqual({ covered: 2, total: 2 });
        expect(new TestCoverageCount(0, 0)).toEqual({ covered: 0, total: 0 });
        expect(() => new TestCoverageCount(3, 2)).toThrow(
            "The total number of covered items (3) cannot be greater than the total (2)",
        );
        expect(() => new TestCoverageCount(-2, -1)).toThrow("The number of covered items (-1) cannot be negative");
    });

    it("statement, branch and declaration coverage carry what was passed", () => {
        const range = new Range(0, 0, 1, 0);
        expect(new StatementCoverage(3, range)).toEqual({ executed: 3, location: range, branches: [] });
        expect(new BranchCoverage(true)).toEqual({ executed: true, location: undefined, label: undefined });
        expect(new BranchCoverage(0, at, "else")).toEqual({ executed: 0, location: at, label: "else" });
        expect(new DeclarationCoverage("main", false, at)).toEqual({ name: "main", executed: false, location: at });
        const file = new FileCoverage(uri, new TestCoverageCount(1, 2));
        expect(file).toMatchObject({
            uri,
            branchCoverage: undefined,
            declarationCoverage: undefined,
            includesTests: [],
        });
    });

    it("FileCoverage.fromDetails counts statements, branches and declarations", () => {
        const details = [
            new StatementCoverage(1, at, [new BranchCoverage(true), new BranchCoverage(0)]),
            new StatementCoverage(0, at),
            new DeclarationCoverage("f", 2, at),
            new DeclarationCoverage("g", false, at),
            new DeclarationCoverage("h", true, at),
        ];
        const file = FileCoverage.fromDetails(uri, details);
        expect(file.uri).toBe(uri);
        expect(file.statementCoverage).toEqual({ covered: 1, total: 2 });
        expect(file.branchCoverage).toEqual({ covered: 1, total: 2 });
        expect(file.declarationCoverage).toEqual({ covered: 2, total: 3 });
    });

    it("FileCoverage.fromDetails without branches and declarations leaves their counters unset", () => {
        const file = FileCoverage.fromDetails(uri, [new StatementCoverage(true, at)]);
        expect(file.statementCoverage).toEqual({ covered: 1, total: 1 });
        expect(file.branchCoverage).toBeUndefined();
        expect(file.declarationCoverage).toBeUndefined();
    });
});
