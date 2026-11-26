import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import { comparePositions, createPosition, type IPosition } from "../../../../editor/common/core/iPosition.ts";
import { type IRange, rangeContainsPosition, rangesEqual } from "../../../../editor/common/core/iRange.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { TestId, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import {
    CAPABILITY_CONTEXT_KEY,
    type OfferedTestRunGroup,
    TestProfileServiceDIToken,
} from "../common/testProfileService.ts";
import { type ITestNode, TestServiceDIToken } from "../common/testService.ts";

import { TestingMessageDecorationsDIToken } from "./testingMessageDecorations.ts";
import { messageOf } from "./testMessageView.ts";

// Upstream `testExplorerActions.ts` (`RunAtCursor`, `RunCurrentFile`, `OpenOutputPeek`, `ToggleInlineTestOutput`) and
// `testingOutputPeek.ts` (`GoToNextMessageAction`, `GoToPreviousMessageAction`), with the Debug variants. Deviations:
// no Coverage variants; "No tests found here" is a notification, as the editor has no inline message (upstream's
// `MessageController`); with no peek, Go to Next/Previous Test Failure move the cursor between the failures shown in
// the file, round, and choose the message in TEST RESULTS if it is shown — upstream walks the peek's messages.

const EDITOR_TEXT_FOCUS = "editorTextFocus";
const HAS_RESULTS = "testing.hasAnyResults";
/** Upstream `EditorContextOrder`. */
const EditorContextOrder = { RunAtCursor: 0, DebugAtCursor: 1, RunInFile: 2, DebugInFile: 3 } as const;

function editorContextWhen(group: OfferedTestRunGroup): string {
    return `testing.activeEditorHasTests && ${CAPABILITY_CONTEXT_KEY[group]}`;
}

function notify(accessor: ServiceAccessor, message: string): void {
    accessor.get(NotificationServiceDIToken).show({ severity: "info", message, modal: false, items: [] });
}

/**
 * Upstream `getTestsAtCursor`: the tests whose range is the innermost one holding the position (all of them, but not
 * one under another of the set); without such, those of the nearest range that starts before the position.
 */
export function getTestsAtCursor(tests: readonly ITestNode[], position: IPosition): ITestNode[] {
    let best: ITestNode[] = [];
    let bestRange: IRange | undefined;
    let before: ITestNode[] = [];
    let beforeRange: IRange | undefined;
    const isUnder = (set: readonly ITestNode[], test: ITestNode): boolean =>
        set.some((other) => TestId.isChild(other.item.extId, test.item.extId));
    for (const test of tests) {
        const range = test.item.range;
        if (range === null) continue;
        if (rangeContainsPosition(range, position)) {
            if (bestRange !== undefined && rangesEqual(range, bestRange)) {
                if (!isUnder(best, test)) best.push(test);
            } else {
                bestRange = range;
                best = [test];
            }
        } else if (
            // Stryker disable next-line EqualityOperator: equivalent, a range starting at the position contains it
            comparePositions(range.start, position) < 0
        ) {
            if (beforeRange === undefined || comparePositions(beforeRange.start, range.start) < 0) {
                beforeRange = range;
                before = [test];
            } else if (rangesEqual(range, beforeRange) && !isUnder(before, test)) {
                before.push(test);
            }
        }
    }
    return best.length > 0 ? best : before;
}

/** Upstream `ExecuteTestAtCursor`: the tests at the cursor of the active editor that can run in the group. */
function testAtCursorAction(
    group: OfferedTestRunGroup,
    id: string,
    label: string,
    key: string,
    order: number,
): CommandAction {
    return {
        id,
        title: `Test: ${label}`,
        shortTitle: label,
        keybinding: { keys: parseChord(key), when: EDITOR_TEXT_FOCUS, weight: KeybindingWeight.WorkbenchContrib },
        menus: [
            { menuId: MenuId.CommandPalette, when: "testing.providerCount > 0" },
            { menuId: MenuId.EditorContext, group: "testing", order, when: editorContextWhen(group) },
        ],
        async run(accessor) {
            const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
            if (editor === null) return;
            const profiles = accessor.get(TestProfileServiceDIToken);
            const service = accessor.get(TestServiceDIToken);
            const runnable = service
                .getNodesByUri(editor.uri.toString())
                .filter((test) => profiles.getDefaultProfileForTest(group, test) !== undefined);
            const tests = getTestsAtCursor(
                runnable,
                createPosition(editor.primaryCursorLine, editor.primaryCursorColumn),
            );
            if (tests.length === 0) {
                notify(accessor, "No tests found here");
                return;
            }
            await service.runTests({ tests, group });
        },
    };
}

/** Upstream `RunAtCursor`. */
export const runAtCursorAction = testAtCursorAction(
    TestRunProfileBitset.Run,
    "testing.runAtCursor",
    "Run Test at Cursor",
    "mod+; c",
    EditorContextOrder.RunAtCursor,
);

/** Upstream `DebugAtCursor`. */
export const debugAtCursorAction = testAtCursorAction(
    TestRunProfileBitset.Debug,
    "testing.debugAtCursor",
    "Debug Test at Cursor",
    "mod+; mod+c",
    EditorContextOrder.DebugAtCursor,
);

/**
 * Upstream `ExecuteTestsInCurrentFile`: from the roots down, each test of the active editor's file with what is under
 * it, with the group's defaults.
 */
function testsInCurrentFileAction(
    group: OfferedTestRunGroup,
    id: string,
    label: string,
    key: string,
    order: number,
): CommandAction {
    return {
        id,
        title: `Test: ${label}`,
        shortTitle: label,
        keybinding: { keys: parseChord(key), when: EDITOR_TEXT_FOCUS, weight: KeybindingWeight.WorkbenchContrib },
        menus: [
            { menuId: MenuId.CommandPalette, when: CAPABILITY_CONTEXT_KEY[group] },
            { menuId: MenuId.EditorContext, group: "testing", order, when: editorContextWhen(group) },
        ],
        async run(accessor) {
            const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
            if (editor === null) return;
            const service = accessor.get(TestServiceDIToken);
            const uri = editor.uri.toString();
            const tests: ITestNode[] = [];
            const queue = [...service.rootItems];
            for (let test = queue.pop(); test !== undefined; test = queue.pop()) {
                if (test.item.uri === uri) {
                    tests.push(test);
                    continue;
                }
                for (const childId of test.children) queue.push(assertReturnsDefined(service.getNodeById(childId)));
            }
            if (tests.length === 0) {
                notify(accessor, "No tests found in this file");
                return;
            }
            await service.runTests({ tests, group });
        },
    };
}

/** Upstream `RunCurrentFile`. */
export const runCurrentFileAction = testsInCurrentFileAction(
    TestRunProfileBitset.Run,
    "testing.runCurrentFile",
    "Run Tests in Current File",
    "mod+; f",
    EditorContextOrder.RunInFile,
);

/** Upstream `DebugCurrentFile`. */
export const debugCurrentFileAction = testsInCurrentFileAction(
    TestRunProfileBitset.Debug,
    "testing.debugCurrentFile",
    "Debug Tests in Current File",
    "mod+; mod+f",
    EditorContextOrder.DebugInFile,
);

/** The failure shown in the active editor next to the cursor in the direction, round; the cursor goes to it. */
function goToFailure(accessor: ServiceAccessor, direction: 1 | -1): void {
    const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
    // Stryker disable next-line ConditionalExpression: equivalent, failuresIn(null) is empty and the next guard returns
    if (editor === null) return;
    const decorations = accessor.get(TestingMessageDecorationsDIToken);
    const failures = decorations.failuresIn(editor);
    if (failures.length === 0) return;
    const line = editor.primaryCursorLine;
    const target =
        direction === 1
            ? (failures.find((failure) => failure.line > line) ?? failures[0])
            : (failures.findLast((failure) => failure.line < line) ?? failures[failures.length - 1]);
    const { location } = messageOf(target.subject);
    const character = location?.uri === editor.uri.toString() ? location.range.start.character : 0;
    editor.goToPosition(target.line, character);
    decorations.select(target.subject);
}

/** Upstream `GoToNextMessageAction` / `GoToPreviousMessageAction` without the peek. */
function goToFailureAction(id: string, label: string, key: string, direction: 1 | -1): CommandAction {
    return {
        id,
        title: `Test: ${label}`,
        shortTitle: label,
        keybinding: { keys: parseKeybinding(key), when: EDITOR_TEXT_FOCUS, weight: KeybindingWeight.EditorContrib + 1 },
        menus: [{ menuId: MenuId.CommandPalette, when: EDITOR_TEXT_FOCUS }],
        run(accessor) {
            goToFailure(accessor, direction);
        },
    };
}

export const goToNextMessageAction = goToFailureAction(
    "testing.goToNextMessage",
    "Go to Next Test Failure",
    "alt+f8",
    1,
);

export const goToPreviousMessageAction = goToFailureAction(
    "testing.goToPreviousMessage",
    "Go to Previous Test Failure",
    "shift+alt+f8",
    -1,
);

/** Upstream `OpenOutputPeek`: TEST RESULTS with the failure nearest to the cursor, the keyboard goes there. */
export const openOutputPeekAction: CommandAction = {
    id: "testing.openOutputPeek",
    title: "Test: Peek Output",
    shortTitle: "Peek Output",
    keybinding: { keys: parseChord("mod+; mod+m"), weight: KeybindingWeight.WorkbenchContrib },
    menus: [{ menuId: MenuId.CommandPalette, when: HAS_RESULTS }],
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        accessor.get(TestingMessageDecorationsDIToken).showNearest(editor ?? undefined, editor?.primaryCursorLine ?? 0);
    },
};

/** Upstream `ToggleInlineTestOutput`: the logged output with a location after the lines' ends. */
export const toggleInlineTestOutputAction: CommandAction = {
    id: "testing.toggleInlineTestOutput",
    title: "Test: Toggle Inline Test Output",
    shortTitle: "Toggle Inline Test Output",
    keybinding: { keys: parseChord("mod+; mod+i"), weight: KeybindingWeight.WorkbenchContrib },
    menus: [{ menuId: MenuId.CommandPalette, when: HAS_RESULTS }],
    run(accessor) {
        accessor.get(TestingMessageDecorationsDIToken).toggleInlineOutput();
    },
};

export const TESTING_EDITOR_ACTIONS: readonly CommandAction[] = [
    debugAtCursorAction,
    debugCurrentFileAction,
    goToNextMessageAction,
    goToPreviousMessageAction,
    openOutputPeekAction,
    runAtCursorAction,
    runCurrentFileAction,
    toggleInlineTestOutputAction,
];
