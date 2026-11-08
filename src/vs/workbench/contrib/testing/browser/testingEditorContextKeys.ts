import type { Event } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { createPosition } from "../../../../editor/common/core/iPosition.ts";
import { type IRange, rangeContainsPosition } from "../../../../editor/common/core/iRange.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { type TestService, TestServiceDIToken } from "../common/testService.ts";

/** The active text editor as the keys read it: `TextEditorPane` matches structurally. */
export interface ITestingCursorEditor {
    readonly uri: Uri;
    readonly primaryCursorLine: number;
    readonly primaryCursorColumn: number;
}

/** `EditorService` matches structurally; the DI module does the binding. */
export interface ITestingActiveEditorSource {
    getActiveEditor(): ITestingCursorEditor | null;
    readonly onActiveEditorChanged: Event<unknown>;
    readonly onDidChangeActiveEditorSelection: Event<unknown>;
}

export const TestingActiveEditorSourceDIToken = token<ITestingActiveEditorSource>("TestingActiveEditorSource");
export const TestingEditorContextKeysDIToken = token<TestingEditorContextKeys>("TestingEditorContextKeys");

/**
 * Upstream `TestService.updateEditorContextKeys`: `testing.activeEditorHasTests` — the active text editor's file has
 * tests; and `testing.cursorInsideTestRange` — its cursor is inside one of their ranges (upstream declares the key and
 * never sets it).
 */
export class TestingEditorContextKeys extends Disposable {
    public static dependencies = [
        TestingActiveEditorSourceDIToken,
        TestServiceDIToken,
        ContextKeyServiceDIToken,
    ] as const;

    /** The active file's tests with a range. */
    // Stryker disable next-line ArrayDeclaration: equivalent, the constructor's refresh() replaces it before any read
    private ranges: readonly IRange[] = [];

    public constructor(
        private readonly editors: ITestingActiveEditorSource,
        private readonly tests: TestService,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        // A cursor move only checks the active file's tests; the file and the tests are looked up on their changes.
        const refresh = (): void => {
            this.refresh();
        };
        this.register(editors.onActiveEditorChanged(refresh));
        this.register(tests.onDidProcessDiff(refresh));
        this.register(
            editors.onDidChangeActiveEditorSelection(() => {
                this.updateCursor();
            }),
        );
        this.refresh();
    }

    private refresh(): void {
        const editor = this.editors.getActiveEditor();
        const tests = editor === null ? [] : this.tests.getNodesByUri(editor.uri.toString());
        this.contextKeys.set("testing.activeEditorHasTests", tests.length > 0);
        this.ranges = tests.flatMap((test) => test.item.range ?? []);
        this.updateCursor();
    }

    private updateCursor(): void {
        const editor = this.editors.getActiveEditor();
        const cursor = editor === null ? null : createPosition(editor.primaryCursorLine, editor.primaryCursorColumn);
        this.contextKeys.set(
            "testing.cursorInsideTestRange",
            cursor !== null && this.ranges.some((range) => rangeContainsPosition(range, cursor)),
        );
    }
}
