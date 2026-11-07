import type { Event } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { createPosition } from "../../../../editor/common/core/iPosition.ts";
import { rangeContainsPosition } from "../../../../editor/common/core/iRange.ts";
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
    public static dependencies = [TestingActiveEditorSourceDIToken, TestServiceDIToken, ContextKeyServiceDIToken] as const;

    public constructor(
        private readonly editors: ITestingActiveEditorSource,
        private readonly tests: TestService,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        const update = (): void => {
            this.update();
        };
        this.register(editors.onActiveEditorChanged(update));
        this.register(editors.onDidChangeActiveEditorSelection(update));
        this.register(tests.onDidProcessDiff(update));
        this.update();
    }

    private update(): void {
        const editor = this.editors.getActiveEditor();
        const tests = editor === null ? [] : this.tests.getNodesByUri(editor.uri.toString());
        this.contextKeys.set("testing.activeEditorHasTests", tests.length > 0);
        const cursor = editor === null ? null : createPosition(editor.primaryCursorLine, editor.primaryCursorColumn);
        this.contextKeys.set(
            "testing.cursorInsideTestRange",
            cursor !== null && tests.some((test) => test.item.range !== null && rangeContainsPosition(test.item.range, cursor)),
        );
    }
}
