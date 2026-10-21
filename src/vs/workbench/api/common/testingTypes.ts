import type * as vscode from "vscode";

export enum TestRunProfileKind {
    Run = 1,
    Debug = 2,
    Coverage = 3,
}

export class TestTag implements vscode.TestTag {
    public constructor(public readonly id: string) {}
}

export class TestRunRequest implements vscode.TestRunRequest {
    // Не параметр-свойство `include?`: у `vscode.TestRunRequest` поля обязательные (со значением `undefined`).
    public readonly include: readonly vscode.TestItem[] | undefined;
    public readonly exclude: readonly vscode.TestItem[] | undefined;
    public readonly profile: vscode.TestRunProfile | undefined;

    public constructor(
        include?: readonly vscode.TestItem[],
        exclude?: readonly vscode.TestItem[],
        profile?: vscode.TestRunProfile,
        public readonly continuous = false,
        public readonly preserveFocus = true,
    ) {
        this.include = include;
        this.exclude = exclude;
        this.profile = profile;
    }
}

export class TestMessageStackFrame implements vscode.TestMessageStackFrame {
    public constructor(
        public label: string,
        public uri?: vscode.Uri,
        public position?: vscode.Position,
    ) {}
}

export class TestMessage implements vscode.TestMessage {
    public expectedOutput?: string;
    public actualOutput?: string;
    public location?: vscode.Location;
    public contextValue?: string;
    public stackTrace?: TestMessageStackFrame[];

    public static diff(message: string | vscode.MarkdownString, expected: string, actual: string): TestMessage {
        const msg = new TestMessage(message);
        msg.expectedOutput = expected;
        msg.actualOutput = actual;
        return msg;
    }

    public constructor(public message: string | vscode.MarkdownString) {}
}

export class TestCoverageCount implements vscode.TestCoverageCount {
    public constructor(
        public covered: number,
        public total: number,
    ) {
        if (covered > total) {
            throw new Error(
                `The total number of covered items (${String(covered)}) cannot be greater than the total (${String(total)})`,
            );
        }
        if (total < 0) {
            throw new Error(`The number of covered items (${String(total)}) cannot be negative`);
        }
    }
}

export class StatementCoverage implements vscode.StatementCoverage {
    public constructor(
        public executed: number | boolean,
        public location: vscode.Position | vscode.Range,
        public branches: vscode.BranchCoverage[] = [],
    ) {}
}

export class BranchCoverage implements vscode.BranchCoverage {
    public constructor(
        public executed: number | boolean,
        public location?: vscode.Position | vscode.Range,
        public label?: string,
    ) {}
}

export class DeclarationCoverage implements vscode.DeclarationCoverage {
    public constructor(
        public readonly name: string,
        public executed: number | boolean,
        public location: vscode.Position | vscode.Range,
    ) {}
}

export class FileCoverage implements vscode.FileCoverage {
    public static fromDetails(uri: vscode.Uri, details: readonly vscode.FileCoverageDetail[]): FileCoverage {
        let statements = 0;
        let statementsCovered = 0;
        let branches = 0;
        let branchesCovered = 0;
        let declarations = 0;
        let declarationsCovered = 0;
        for (const detail of details) {
            if ("branches" in detail) {
                statements += 1;
                statementsCovered += detail.executed ? 1 : 0;
                for (const branch of detail.branches) {
                    branches += 1;
                    branchesCovered += branch.executed ? 1 : 0;
                }
            } else {
                declarations += 1;
                declarationsCovered += detail.executed ? 1 : 0;
            }
        }
        return new FileCoverage(
            uri,
            new TestCoverageCount(statementsCovered, statements),
            branches > 0 ? new TestCoverageCount(branchesCovered, branches) : undefined,
            declarations > 0 ? new TestCoverageCount(declarationsCovered, declarations) : undefined,
        );
    }

    public constructor(
        public readonly uri: vscode.Uri,
        public statementCoverage: vscode.TestCoverageCount,
        public branchCoverage?: vscode.TestCoverageCount,
        public declarationCoverage?: vscode.TestCoverageCount,
        public includesTests: vscode.TestItem[] = [],
    ) {}
}
