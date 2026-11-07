// Testing wire types (upstream `ExtHostTestingShape`/`MainThreadTestingShape` in `extHost.protocol.ts` and
// `contrib/testing/common/testTypes.ts`); the host parses them in `services/extensions/node/testingWireParsers.ts`.

import type { IRange } from "../../../editor/common/core/iRange.ts";

/** Upstream `TestIdPathParts.Delimiter`: a test id is the path of item ids from the controller id. */
export const TEST_ID_DELIMITER = "\0";

/** Upstream `TestId`'s string helpers. */
export const TestId = {
    joinToString: (base: string, id: string): string => base + TEST_ID_DELIMITER + id,
    /** The controller id. */
    root: (testId: string): string => testId.split(TEST_ID_DELIMITER, 1)[0],
    /** The test's own id: the last segment. */
    localId: (testId: string): string => testId.slice(testId.lastIndexOf(TEST_ID_DELIMITER) + 1),
    /** Upstream `isChild`: `maybeChild` is under `maybeParent`, at any depth. */
    isChild: (maybeParent: string, maybeChild: string): boolean =>
        maybeChild.startsWith(maybeParent + TEST_ID_DELIMITER),
    /** `undefined` for a controller root. */
    parentId: (testId: string): string | undefined => {
        const index = testId.lastIndexOf(TEST_ID_DELIMITER);
        return index === -1 ? undefined : testId.slice(0, index);
    },
};

/** Upstream `Convert.TestTag.namespace`: a tag id as the core sees it. */
export function namespaceTestTag(controllerId: string, tagId: string): string {
    return controllerId + TEST_ID_DELIMITER + tagId;
}

/** Upstream `TestItemExpandState`. */
export const TestItemExpandState = {
    NotExpandable: 0,
    Expandable: 1,
    BusyExpanding: 2,
    Expanded: 3,
} as const;
export type TestItemExpandState = (typeof TestItemExpandState)[keyof typeof TestItemExpandState];

/** Upstream `TestRunProfileBitset`: the profile's group. */
export const TestRunProfileBitset = {
    Run: 2,
    Debug: 4,
    Coverage: 8,
} as const;
export type TestRunProfileGroup = (typeof TestRunProfileBitset)[keyof typeof TestRunProfileBitset];

/** Upstream `ITestItem` as serialized: the `vscode.TestItem` fields without children. */
export interface IWireTestItem {
    /** The full test id: `<controller id>\0<id>\0<id>…`. */
    readonly extId: string;
    readonly label: string;
    /** Namespaced as upstream's `namespaceTestTag`: `<controller id>\0<tag id>`. */
    readonly tags: readonly string[];
    readonly busy: boolean;
    /** `uri.toString()`. */
    readonly uri?: string;
    readonly range: IRange | null;
    readonly description: string | null;
    /** A `MarkdownString` goes as its source. */
    readonly error: string | null;
    readonly sortText: string | null;
}

/** Upstream `InternalTestItem.Serialized`. */
export interface IWireInternalTestItem {
    readonly expand: TestItemExpandState;
    readonly item: IWireTestItem;
}

/** Upstream `ITestItemUpdate.Serialized`: a shallow patch. */
export interface IWireTestItemUpdate {
    readonly extId: string;
    readonly expand?: TestItemExpandState;
    readonly item?: Partial<Omit<IWireTestItem, "extId" | "uri">>;
}

/** Upstream `TestDiffOpType`: `Add` carries the test, `Update` a patch, `Remove` drops the test with its subtree. */
export const TestDiffOpType = {
    Add: 0,
    Update: 1,
    Remove: 3,
} as const;

export type WireTestsDiffOp =
    | { readonly op: typeof TestDiffOpType.Add; readonly item: IWireInternalTestItem }
    | { readonly op: typeof TestDiffOpType.Update; readonly item: IWireTestItemUpdate }
    | { readonly op: typeof TestDiffOpType.Remove; readonly itemId: string };

/**
 * Upstream `ITestItemContext` (`MarshalledId.TestItemContext`), by id: a Test Explorer row as a command argument, turned
 * back into the extension's `TestItem` before the command runs (`extHostTesting` `processArgument`).
 */
export interface IWireTestItemArg {
    /** The full test id. */
    readonly $testId: string;
}

/** Upstream `$registerTestController`; `canRefresh` is the `Refresh` capability. */
export interface IWireTestController {
    readonly controllerId: string;
    readonly label: string;
    readonly canRefresh: boolean;
}

/** Upstream `$updateController`: only the changed fields. */
export interface IWireTestControllerPatch {
    readonly controllerId: string;
    readonly label?: string;
    readonly canRefresh?: boolean;
}

export interface IWireTestControllerId {
    readonly controllerId: string;
}

/** Upstream `$publishDiff`. */
export interface IWireTestsDiff {
    readonly controllerId: string;
    readonly diff: readonly WireTestsDiffOp[];
}

/** Upstream `ITestRunProfile`. */
export interface IWireTestRunProfile {
    readonly controllerId: string;
    readonly profileId: number;
    readonly label: string;
    readonly group: TestRunProfileGroup;
    readonly isDefault: boolean;
    /** Namespaced, as {@link IWireTestItem.tags}. */
    readonly tag: string | null;
    readonly hasConfigurationHandler: boolean;
    readonly supportsContinuousRun: boolean;
}

/** Upstream `$updateTestRunConfig`. */
export interface IWireTestRunProfileUpdate {
    readonly controllerId: string;
    readonly profileId: number;
    readonly update: Partial<Omit<IWireTestRunProfile, "controllerId" | "profileId" | "group">>;
}

/** Upstream `$removeTestProfile`. */
export interface IWireTestRunProfileId {
    readonly controllerId: string;
    readonly profileId: number;
}

/** Upstream `$expandTest`: `levels` below the test; a negative number is "all". */
export interface IWireExpandTest {
    readonly testId: string;
    readonly levels: number;
}

/** Upstream `TestResultState`. */
export const TestResultState = {
    Unset: 0,
    Queued: 1,
    Running: 2,
    Passed: 3,
    Failed: 4,
    Skipped: 5,
    Errored: 6,
} as const;
export type TestResultState = (typeof TestResultState)[keyof typeof TestResultState];

/** Upstream `ICallProfileRunHandler` of `IStartControllerTests`: one controller's share of a run. */
export interface IWireStartControllerTests {
    readonly runId: string;
    readonly controllerId: string;
    readonly profileId: number;
    /** Full test ids; the controller's root id runs everything. */
    readonly testIds: readonly string[];
    readonly excludeExtIds: readonly string[];
}

/** Upstream `$runControllerTests`. */
export interface IWireRunControllerTests {
    readonly requests: readonly IWireStartControllerTests[];
}

/** Upstream `IStartControllerTestsResult`: the `runHandler`'s rejection as text. */
export interface IWireRunControllerTestsResult {
    readonly error?: string;
}

/** Upstream `$cancelExtensionTestRun`: without `runId` every run, without `taskId` the whole run. */
export interface IWireCancelTestRun {
    readonly runId?: string;
    readonly taskId?: string;
}

/** Upstream `ExtensionRunTestsRequest`: a run the extension started with `createTestRun` on its own. */
export interface IWireExtensionTestRun {
    readonly runId: string;
    readonly controllerId: string;
    /** Full test ids; the controller's root id when the request has no `include`. */
    readonly include: readonly string[];
    readonly exclude: readonly string[];
    readonly profileId: number | null;
    readonly preserveFocus: boolean;
    readonly persist: boolean;
    readonly continuous: boolean;
}

export interface IWireTestRunId {
    readonly runId: string;
}

/** Upstream `$startedTestRunTask`: a `TestRun` object of the run. */
export interface IWireTestRunTask {
    readonly runId: string;
    readonly taskId: string;
    readonly controllerId: string;
    readonly name: string;
}

/** Upstream `$finishedTestRunTask`. */
export interface IWireTestRunTaskId {
    readonly runId: string;
    readonly taskId: string;
}

/** Upstream `$addTestsToRun`: a chain from a test the run knows (or the root) down to the reported test. */
export interface IWireAddTestsToRun {
    readonly controllerId: string;
    readonly runId: string;
    readonly tests: readonly IWireTestItem[];
}

/** Upstream `$updateTestStateInRun`. */
export interface IWireTestStateInRun {
    readonly runId: string;
    readonly taskId: string;
    readonly testId: string;
    readonly state: TestResultState;
    readonly duration?: number;
}

/** Upstream `ILocationDto`. */
export interface IWireTestLocation {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly range: IRange;
}

/** Upstream `ITestMessageStackFrame`. */
export interface IWireTestMessageStackFrame {
    readonly label: string;
    readonly uri?: string;
    readonly position?: { readonly line: number; readonly character: number };
}

/** Upstream `ITestErrorMessage.Serialized`; a `MarkdownString` goes as its source. */
export interface IWireTestMessage {
    readonly message: string;
    readonly expected?: string;
    readonly actual?: string;
    readonly contextValue?: string;
    readonly location?: IWireTestLocation;
    readonly stackTrace?: readonly IWireTestMessageStackFrame[];
}

/** Upstream `$appendTestMessagesInRun`. */
export interface IWireTestMessagesInRun {
    readonly runId: string;
    readonly taskId: string;
    readonly testId: string;
    readonly messages: readonly IWireTestMessage[];
}

/** Upstream `$appendOutputToRun`: the text as it came. */
export interface IWireTestOutputInRun {
    readonly runId: string;
    readonly taskId: string;
    readonly output: string;
    readonly location?: IWireTestLocation;
    readonly testId?: string;
}
