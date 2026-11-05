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
    /** `undefined` for a controller root. */
    parentId: (testId: string): string | undefined => {
        const index = testId.lastIndexOf(TEST_ID_DELIMITER);
        return index === -1 ? undefined : testId.slice(0, index);
    },
};

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
