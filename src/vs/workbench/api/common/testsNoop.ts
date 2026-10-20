import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { CancellationTokenSource, EventEmitter } from "./vscodeTypes.ts";

/**
 * `vscode.tests` как заглушка до view Testing (docs/arch/StockExtensions.md, golang.go).
 * Тот же принцип, что у комментариев (commentsNoop.ts): контроллер, профили,
 * элементы и прогоны — настоящие объекты эталонной формы, присваивания полей
 * проходят, но ничего не рисуется и обработчики (`runHandler`,
 * `resolveHandler`, `refreshHandler`) никто не зовёт.
 *
 * `golang.go` заводит контроллер в `activate()` (`go.testExplorer.enable` по
 * умолчанию включён), создаёт три профиля и на открытии тест-файла ищет и
 * добавляет элементы — коллекции поэтому рабочие (`items.get` после
 * `items.add` находит элемент, `parent` выставляется), иначе расширение
 * спотыкалось бы на собственном дереве. Прогон тестов у Go идёт мимо Test API
 * (`Go: Test File`, задачи `go: test`) — он и остаётся рабочим путём.
 *
 * Человеку — одна warn-строка в Output на id контроллера за жизнь субпроцесса.
 */

/** Канал панели Output для отказа: `extensions` уже в реестре ядра (label «Extensions»). */
const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

/**
 * Коллекция элементов: у корня контроллера `parent` детей — `undefined`, у
 * детей элемента — сам элемент. Тот же id в одной коллекции заменяет прежний
 * элемент (контракт `TestItemCollection.add`).
 */
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

/** Элемент с эталонными дефолтами (`TestItemImpl`): без тегов, не busy, детей не резолвит. */
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

/** Прогон, который некому показать: отчёты о тестах принимаются и забываются. */
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
        // Как у эталона: `end` завершает прогон один раз, подписчики узнают о его
        // конце; снятый эмиттер повторный `end` уже никому не доставит.
        end: (): void => {
            onDidDispose.fire();
            onDidDispose.dispose();
        },
        onDidDispose: onDidDispose.event,
    };
}

export function createTestsNoop(rpc: SubprocessRpc): typeof vscode.tests {
    const reported = new Set<string>();

    // Главное — первым: строка Output обрезается шириной панели.
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
