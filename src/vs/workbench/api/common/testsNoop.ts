import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { CancellationTokenSource, EventEmitter } from "./vscodeTypes.ts";

/**
 * Stub until the Testing view exists: nobody calls the handlers, but the collections work — `golang.go`
 * adds items when a test file opens and would trip over its own tree otherwise.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

class InertTestItemCollection implements vscode.TestItemCollection {
    private readonly items = new Map<string, InertTestItem>();

    public constructor(private readonly owner: InertTestItem | undefined) {}

    public get size(): number {
        return this.items.size;
    }

    public replace(items: readonly vscode.TestItem[]): void {
        this.items.clear();
        for (const item of items) this.add(item);
    }

    public forEach(
        callback: (item: vscode.TestItem, collection: vscode.TestItemCollection) => unknown,
        thisArg?: unknown,
    ): void {
        for (const item of this.items.values()) callback.call(thisArg, item, this);
    }

    public add(item: vscode.TestItem): void {
        const own = item as InertTestItem;
        own.parent = this.owner;
        this.items.set(own.id, own);
    }

    public delete(itemId: string): void {
        this.items.delete(itemId);
    }

    public get(itemId: string): vscode.TestItem | undefined {
        return this.items.get(itemId);
    }

    public *[Symbol.iterator](): Iterator<[id: string, testItem: vscode.TestItem]> {
        yield* this.items.entries();
    }
}

class InertTestItem implements vscode.TestItem {
    public readonly children: vscode.TestItemCollection = new InertTestItemCollection(this);
    public parent: vscode.TestItem | undefined = undefined;
    public tags: readonly vscode.TestTag[] = [];
    public canResolveChildren = false;
    public busy = false;
    public description?: string;
    public sortText?: string | undefined;
    public range: vscode.Range | undefined = undefined;
    public error: string | vscode.MarkdownString | undefined = undefined;

    public constructor(
        public readonly id: string,
        public label: string,
        public readonly uri: vscode.Uri | undefined,
    ) {}
}

function createInertRunProfile(
    label: string,
    kind: vscode.TestRunProfileKind,
    runHandler: (request: vscode.TestRunRequest, token: vscode.CancellationToken) => Thenable<void> | void,
    isDefault: boolean,
    tag: vscode.TestTag | undefined,
    supportsContinuousRun: boolean,
): vscode.TestRunProfile {
    return {
        label,
        kind,
        isDefault,
        onDidChangeDefault: new EventEmitter<boolean>().event,
        supportsContinuousRun,
        tag,
        configureHandler: undefined,
        runHandler,
        dispose: (): void => undefined,
    };
}

function createInertTestRun(name: string | undefined, persist: boolean): vscode.TestRun {
    const onDidDispose = new EventEmitter<void>();
    return {
        name,
        token: new CancellationTokenSource().token,
        isPersisted: persist,
        enqueued: (): void => undefined,
        started: (): void => undefined,
        skipped: (): void => undefined,
        failed: (): void => undefined,
        errored: (): void => undefined,
        passed: (): void => undefined,
        appendOutput: (): void => undefined,
        addCoverage: (): void => undefined,
        end: (): void => {
            onDidDispose.fire();
            onDidDispose.dispose();
        },
        onDidDispose: onDidDispose.event,
    };
}

export function createTestsNoop(rpc: SubprocessRpc): typeof vscode.tests {
    const reported = new Set<string>();

    // The key part first: the Output line is cut off at the panel width.
    function reportUnsupported(id: string): void {
        if (reported.has(id)) return;
        reported.add(id);
        rpc.notify("output.append", {
            channel: OUTPUT_CHANNEL,
            label: OUTPUT_LABEL,
            level: "warn",
            value: `тесты "${id}" в TUI пока не показываются — view Testing не будет, остальное расширение работает`,
        });
    }

    return {
        createTestController: (id: string, label: string): vscode.TestController => {
            reportUnsupported(id);
            return {
                id,
                label,
                items: new InertTestItemCollection(undefined),
                createRunProfile: (
                    profileLabel,
                    kind,
                    runHandler,
                    isDefault = false,
                    tag,
                    supportsContinuousRun = false,
                ) => createInertRunProfile(profileLabel, kind, runHandler, isDefault, tag, supportsContinuousRun),
                resolveHandler: undefined,
                refreshHandler: undefined,
                createTestRun: (_request, name, persist = true) => createInertTestRun(name, persist),
                createTestItem: (itemId, itemLabel, uri) => new InertTestItem(itemId, itemLabel, uri),
                invalidateTestResults: (): void => undefined,
                dispose: (): void => undefined,
            };
        },
    };
}
