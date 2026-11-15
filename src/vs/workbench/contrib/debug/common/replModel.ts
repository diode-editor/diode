/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/replModel.ts
// What a session writes into the Debug Console: output with its collapsing of identical lines, groups, evaluated
// expressions. The view of it is #1146. Deviations: the two `debug.console.*` settings come in through a getter
// rather than the configuration service; `RawObjectReplElement` (objects the extension host logs) comes with its
// producer.

import { Emitter, type Event } from "../../../../base/common/event.ts";
import { generateUuid } from "../../../../base/common/uuid.ts";

import type {
    IDebugSession,
    IExpression,
    INestingReplElement,
    INewReplElementData,
    IReplElement,
    IReplElementSource,
    IStackFrame,
    ReplSeverity,
} from "./debug.ts";
import { ExpressionContainer } from "./debugModel.ts";

let topReplElementCounter = 0;
const getUniqueId = (): string => `topReplElement:${String(topReplElementCounter++)}`;

/**
 * General case of data from DAP the `output` event. {@link ReplVariableElement}
 * is used instead only if there is a `variablesReference` with no `output` text.
 */
export class ReplOutputElement implements INestingReplElement {
    private countValue = 1;
    private readonly onDidChangeCountEmitter = new Emitter<void>();

    public constructor(
        public session: IDebugSession,
        private readonly id: string,
        public value: string,
        public severity: ReplSeverity,
        public sourceData?: IReplElementSource,
        public readonly expression?: IExpression,
    ) {}

    public toString(includeSource = false): string {
        let valueRespectCount = this.value;
        for (let i = 1; i < this.count; i++) {
            valueRespectCount += (valueRespectCount.endsWith("\n") ? "" : "\n") + this.value;
        }
        const sourceStr = this.sourceData && includeSource ? ` ${this.sourceData.source.name}` : "";
        return valueRespectCount + sourceStr;
    }

    public getId(): string {
        return this.id;
    }

    public getChildren(): Promise<IReplElement[]> {
        return this.expression?.getChildren() ?? Promise.resolve([]);
    }

    public set count(value: number) {
        this.countValue = value;
        this.onDidChangeCountEmitter.fire();
    }

    public get count(): number {
        return this.countValue;
    }

    public get onDidChangeCount(): Event<void> {
        return this.onDidChangeCountEmitter.event;
    }

    public get hasChildren(): boolean {
        return !!this.expression?.hasChildren;
    }
}

/** Top-level variable logged via DAP output when there's no `output` string */
export class ReplVariableElement implements INestingReplElement {
    public readonly hasChildren: boolean;
    private readonly id = generateUuid();

    public constructor(
        private readonly session: IDebugSession,
        public readonly expression: IExpression,
        public readonly severity: ReplSeverity,
        public readonly sourceData?: IReplElementSource,
    ) {
        this.hasChildren = expression.hasChildren;
    }

    public getSession(): IDebugSession {
        return this.session;
    }

    public getChildren(): Promise<IReplElement[]> {
        return this.expression.getChildren();
    }

    public toString(): string {
        // Every expression of the model (`ExpressionContainer`) writes itself as `name = value`.
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        return this.expression.toString();
    }

    public getId(): string {
        return this.id;
    }
}

export class ReplEvaluationInput implements IReplElement {
    private readonly id = generateUuid();

    public constructor(public value: string) {}

    public toString(): string {
        return this.value;
    }

    public getId(): string {
        return this.id;
    }
}

export class ReplEvaluationResult extends ExpressionContainer implements IReplElement {
    private availableValue = true;

    public get available(): boolean {
        return this.availableValue;
    }

    public constructor(public readonly originalExpression: string) {
        super(undefined, undefined, 0, generateUuid());
    }

    public override async evaluateExpression(
        expression: string,
        session: IDebugSession | undefined,
        stackFrame: IStackFrame | undefined,
        context: string,
    ): Promise<boolean> {
        const result = await super.evaluateExpression(expression, session, stackFrame, context);
        this.availableValue = result;
        return result;
    }

    public override toString(): string {
        return this.value;
    }
}

export class ReplGroup implements INestingReplElement {
    private readonly children: IReplElement[] = [];
    private readonly id: string;
    private ended = false;
    public static COUNTER = 0;

    public constructor(
        public readonly session: IDebugSession,
        public name: string,
        public autoExpand: boolean,
        public sourceData?: IReplElementSource,
    ) {
        this.id = `replGroup:${String(ReplGroup.COUNTER++)}`;
    }

    public readonly hasChildren = true;

    public getId(): string {
        return this.id;
    }

    public toString(includeSource = false): string {
        const sourceStr = includeSource && this.sourceData ? ` ${this.sourceData.source.name}` : "";
        return this.name + sourceStr;
    }

    public addChild(child: IReplElement): void {
        const lastElement = this.children.at(-1);
        if (lastElement instanceof ReplGroup && !lastElement.hasEnded) {
            lastElement.addChild(child);
        } else {
            this.children.push(child);
        }
    }

    public getChildren(): IReplElement[] {
        return this.children;
    }

    public end(): void {
        const lastElement = this.children.at(-1);
        if (lastElement instanceof ReplGroup && !lastElement.hasEnded) {
            lastElement.end();
        } else {
            this.ended = true;
        }
    }

    public get hasEnded(): boolean {
        return this.ended;
    }
}

function areSourcesEqual(first: IReplElementSource | undefined, second: IReplElementSource | undefined): boolean {
    if (!first && !second) {
        return true;
    }
    if (first && second) {
        return (
            first.column === second.column &&
            first.lineNumber === second.lineNumber &&
            first.source.uri.toString() === second.source.uri.toString()
        );
    }
    return false;
}

/** `debug.console.collapseIdenticalLines` and `debug.console.maximumLines`, read on every append. */
export interface IReplConsoleConfiguration {
    readonly collapseIdenticalLines: boolean;
    readonly maximumLines: number;
}

export class ReplModel {
    private replElements: IReplElement[] = [];
    private readonly onDidChangeElementsEmitter = new Emitter<IReplElement | undefined>();
    public readonly onDidChangeElements = this.onDidChangeElementsEmitter.event;

    public constructor(private readonly configuration: () => IReplConsoleConfiguration) {}

    public getReplElements(): IReplElement[] {
        return this.replElements;
    }

    public async addReplExpression(
        session: IDebugSession,
        stackFrame: IStackFrame | undefined,
        expression: string,
    ): Promise<void> {
        this.addReplElement(new ReplEvaluationInput(expression));
        const result = new ReplEvaluationResult(expression);
        await result.evaluateExpression(expression, session, stackFrame, "repl");
        this.addReplElement(result);
    }

    public appendToRepl(session: IDebugSession, { output, expression, sev, source }: INewReplElementData): void {
        const clearAnsiSequence = "\u001b[2J";
        const clearAnsiIndex = output.lastIndexOf(clearAnsiSequence);
        if (clearAnsiIndex !== -1) {
            // [2J is the ansi escape sequence for clearing the display http://ascii-table.com/ansi-escape-sequences.php
            this.removeReplExpressions();
            this.appendToRepl(session, { output: "Console was cleared", sev: "ignore" });
            output = output.substring(clearAnsiIndex + clearAnsiSequence.length);
        }

        if (expression) {
            // if there is an output string, prefer to show that, since the DA could
            // have formatted it nicely e.g. with ANSI color codes.
            this.addReplElement(
                output
                    ? new ReplOutputElement(session, getUniqueId(), output, sev, source, expression)
                    : new ReplVariableElement(session, expression, sev, source),
            );
            return;
        }

        this.appendOutputToRepl(session, output, sev, source);
    }

    private appendOutputToRepl(
        session: IDebugSession,
        output: string,
        sev: ReplSeverity,
        source?: IReplElementSource,
    ): void {
        const config = this.configuration();
        const previousElement = this.replElements.at(-1);

        // Handle concatenation of incomplete lines first
        if (
            previousElement instanceof ReplOutputElement &&
            previousElement.severity === sev &&
            areSourcesEqual(previousElement.sourceData, source) &&
            // Upstream also asks for a count of 1: an element without a line break is never collapsed into.
            !previousElement.value.endsWith("\n")
        ) {
            // Concatenate with previous incomplete line
            const combinedOutput = previousElement.value + output;
            this.replElements[this.replElements.length - 1] = new ReplOutputElement(
                session,
                getUniqueId(),
                combinedOutput,
                sev,
                source,
            );
            this.onDidChangeElementsEmitter.fire(undefined);

            // If collapsing is enabled, check if the combined output can be collapsed with previous elements:
            // only a complete line can (upstream asks for it explicitly; the element before always is one)
            if (config.collapseIdenticalLines) {
                this.tryCollapseCompleteLine(sev, source);
            }

            // If the combined output contains multiple lines, apply line-level collapsing
            if (config.collapseIdenticalLines && this.splitIntoLines(combinedOutput).length > 1) {
                this.applyLineLevelCollapsing(session, sev, source);
            }
            return;
        }

        // If collapsing is enabled and the output contains line breaks, parse and collapse at line level
        if (config.collapseIdenticalLines && output.includes("\n")) {
            this.processMultiLineOutput(session, output, sev, source);
            return;
        }

        // Upstream collapses output without a line break into an identical previous element here; such an
        // element is either complete (it ends with a line break, the output does not) or incomplete (and taken
        // by the concatenation above), so the case never comes.
        this.addReplElement(new ReplOutputElement(session, getUniqueId(), output, sev, source));
    }

    private tryCollapseCompleteLine(sev: ReplSeverity, source?: IReplElementSource): void {
        // Try to collapse the last element with the second-to-last if they are identical complete lines
        const lastElement = this.replElements.at(-1);
        const secondToLastElement = this.replElements.at(-2);

        if (
            lastElement instanceof ReplOutputElement &&
            secondToLastElement instanceof ReplOutputElement &&
            secondToLastElement.severity === sev &&
            areSourcesEqual(secondToLastElement.sourceData, source) &&
            lastElement.value === secondToLastElement.value
        ) {
            // Collapse the last element into the second-to-last
            secondToLastElement.count += lastElement.count;
            this.replElements.pop();
            this.onDidChangeElementsEmitter.fire(undefined);
        }
    }

    /** Each line of `lines` collapses into the previous element when it is the same output. */
    private appendLines(session: IDebugSession, lines: string[], sev: ReplSeverity, source?: IReplElementSource): void {
        for (const line of lines) {
            const previousElement = this.replElements.at(-1);

            // Check if this line can be collapsed with the previous one
            if (
                previousElement instanceof ReplOutputElement &&
                previousElement.severity === sev &&
                areSourcesEqual(previousElement.sourceData, source) &&
                previousElement.value === line
            ) {
                previousElement.count++;
                // No need to fire an event, just the count updates and badge will adjust automatically
            } else {
                this.addReplElement(new ReplOutputElement(session, getUniqueId(), line, sev, source));
            }
        }
    }

    private processMultiLineOutput(
        session: IDebugSession,
        output: string,
        sev: ReplSeverity,
        source?: IReplElementSource,
    ): void {
        this.appendLines(session, this.splitIntoLines(output), sev, source);
    }

    /** Split text into lines while preserving line endings; no empty line comes out. */
    private splitIntoLines(text: string): string[] {
        const lines: string[] = [];
        let start = 0;

        while (start < text.length) {
            const nextLF = text.indexOf("\n", start);
            if (nextLF === -1) {
                lines.push(text.substring(start));
                break;
            }
            lines.push(text.substring(start, nextLF + 1));
            start = nextLF + 1;
        }

        return lines;
    }

    private applyLineLevelCollapsing(session: IDebugSession, sev: ReplSeverity, source?: IReplElementSource): void {
        // The last element is the combined output of `appendOutputToRepl`, of this severity and source
        const lastElement = this.replElements.pop() as ReplOutputElement;
        // Process each line and try to collapse with existing elements
        this.appendLines(session, this.splitIntoLines(lastElement.value), sev, source);
        this.onDidChangeElementsEmitter.fire(undefined);
    }

    public startGroup(
        session: IDebugSession,
        name: string,
        autoExpand: boolean,
        sourceData?: IReplElementSource,
    ): void {
        const group = new ReplGroup(session, name, autoExpand, sourceData);
        this.addReplElement(group);
    }

    public endGroup(): void {
        const lastElement = this.replElements.at(-1);
        if (lastElement instanceof ReplGroup) {
            lastElement.end();
        }
    }

    private addReplElement(newElement: IReplElement): void {
        const lastElement = this.replElements.at(-1);
        if (lastElement instanceof ReplGroup && !lastElement.hasEnded) {
            lastElement.addChild(newElement);
        } else {
            this.replElements.push(newElement);
            const { maximumLines } = this.configuration();
            // Nothing goes while there is room: a negative count removes nothing.
            this.replElements.splice(0, this.replElements.length - maximumLines);
        }
        this.onDidChangeElementsEmitter.fire(newElement);
    }

    public removeReplExpressions(): void {
        if (this.replElements.length > 0) {
            this.replElements = [];
            this.onDidChangeElementsEmitter.fire(undefined);
        }
    }

    /** Returns a new REPL model that's a copy of this one. */
    public clone(): ReplModel {
        const newRepl = new ReplModel(this.configuration);
        newRepl.replElements = this.replElements.slice();
        return newRepl;
    }
}
