import {
    type IWireAddTestsToRun,
    type IWireExtensionTestRun,
    type IWireTestController,
    type IWireTestControllerPatch,
    type IWireTestItem,
    type IWireTestItemUpdate,
    type IWireTestLocation,
    type IWireTestMessage,
    type IWireTestMessagesInRun,
    type IWireTestMessageStackFrame,
    type IWireTestOutputInRun,
    type IWireTestRunProfile,
    type IWireTestRunProfileId,
    type IWireTestRunProfileUpdate,
    type IWireTestRunTask,
    type IWireTestRunTaskId,
    type IWireTestsDiff,
    type IWireTestStateInRun,
    TestDiffOpType,
    type TestItemExpandState as ExpandState,
    TestItemExpandState,
    TestResultState,
    TestRunProfileBitset,
    type TestRunProfileGroup,
    type WireTestsDiffOp,
} from "../../../api/common/testingWireTypes.ts";
import { parseRange } from "../../../api/common/wireTypes.ts";

// Testing messages from the subprocess (`testing.*`); `null` — a malformed message, ignored.

type Fields = Readonly<Record<string, unknown>>;

function fields(raw: unknown): Fields | null {
    return typeof raw === "object" ? (raw as Fields | null) : null;
}

/** The message's fields, when it names a controller. */
function controllerEnvelope(raw: unknown): (Fields & { readonly controllerId: string }) | null {
    const p = fields(raw);
    return typeof p?.controllerId === "string" && p.controllerId !== ""
        ? (p as Fields & { readonly controllerId: string })
        : null;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function nullableString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

const EXPAND_STATES: readonly unknown[] = Object.values(TestItemExpandState);
const PROFILE_GROUPS: readonly unknown[] = Object.values(TestRunProfileBitset);

function expandState(value: unknown): ExpandState | undefined {
    return EXPAND_STATES.includes(value) ? (value as ExpandState) : undefined;
}

export function parseWireTestController(raw: unknown): IWireTestController | null {
    const p = controllerEnvelope(raw);
    if (p === null || typeof p.label !== "string") return null;
    return { controllerId: p.controllerId, label: p.label, canRefresh: p.canRefresh === true };
}

export function parseWireTestControllerPatch(raw: unknown): IWireTestControllerPatch | null {
    const p = controllerEnvelope(raw);
    if (p === null) return null;
    return { controllerId: p.controllerId, label: optionalString(p.label), canRefresh: optionalBoolean(p.canRefresh) };
}

export function parseWireTestControllerId(raw: unknown): string | null {
    return controllerEnvelope(raw)?.controllerId ?? null;
}

function parseTestItem(raw: unknown): IWireTestItem | null {
    const p = fields(raw);
    if (typeof p?.extId !== "string" || typeof p.label !== "string") return null;
    return {
        extId: p.extId,
        label: p.label,
        tags: strings(p.tags),
        busy: p.busy === true,
        uri: optionalString(p.uri),
        range: parseRange(p.range),
        description: nullableString(p.description),
        error: nullableString(p.error),
        sortText: nullableString(p.sortText),
    };
}

/** Only the fields the patch carries; a field of the wrong type is dropped. */
function parseItemPatch(raw: unknown): IWireTestItemUpdate["item"] {
    const p = fields(raw);
    if (p === null) return undefined;
    const patch: Record<string, unknown> = {};
    if (typeof p.label === "string") patch.label = p.label;
    if (Array.isArray(p.tags)) patch.tags = strings(p.tags);
    if (typeof p.busy === "boolean") patch.busy = p.busy;
    if ("range" in p) patch.range = parseRange(p.range);
    for (const key of ["description", "error", "sortText"] as const) {
        if (key in p) patch[key] = nullableString(p[key]);
    }
    return patch;
}

function parseDiffOp(raw: unknown): WireTestsDiffOp | null {
    const p = fields(raw);
    switch (p?.op) {
        case TestDiffOpType.Add: {
            const internal = fields(p.item);
            const item = parseTestItem(internal?.item);
            const expand = expandState(internal?.expand);
            return item === null || expand === undefined ? null : { op: TestDiffOpType.Add, item: { expand, item } };
        }
        case TestDiffOpType.Update: {
            const update = fields(p.item);
            if (typeof update?.extId !== "string") return null;
            return {
                op: TestDiffOpType.Update,
                item: { extId: update.extId, expand: expandState(update.expand), item: parseItemPatch(update.item) },
            };
        }
        case TestDiffOpType.Remove:
            return typeof p.itemId === "string" ? { op: TestDiffOpType.Remove, itemId: p.itemId } : null;
        default:
            return null;
    }
}

/** A malformed op is dropped, the rest of the diff applies. */
export function parseWireTestsDiff(raw: unknown): IWireTestsDiff | null {
    const p = controllerEnvelope(raw);
    if (p === null || !Array.isArray(p.diff)) return null;
    const diff: WireTestsDiffOp[] = [];
    for (const op of p.diff) {
        const parsed = parseDiffOp(op);
        if (parsed !== null) diff.push(parsed);
    }
    return { controllerId: p.controllerId, diff };
}

export function parseWireTestRunProfile(raw: unknown): IWireTestRunProfile | null {
    const p = controllerEnvelope(raw);
    if (p === null || typeof p.profileId !== "number" || typeof p.label !== "string") return null;
    if (!PROFILE_GROUPS.includes(p.group)) return null;
    return {
        controllerId: p.controllerId,
        profileId: p.profileId,
        label: p.label,
        group: p.group as TestRunProfileGroup,
        isDefault: p.isDefault === true,
        tag: nullableString(p.tag),
        hasConfigurationHandler: p.hasConfigurationHandler === true,
        supportsContinuousRun: p.supportsContinuousRun === true,
    };
}

export function parseWireTestRunProfileId(raw: unknown): IWireTestRunProfileId | null {
    const p = controllerEnvelope(raw);
    return p === null || typeof p.profileId !== "number"
        ? null
        : { controllerId: p.controllerId, profileId: p.profileId };
}

export function parseWireTestRunProfileUpdate(raw: unknown): IWireTestRunProfileUpdate | null {
    const id = parseWireTestRunProfileId(raw);
    if (id === null) return null;
    const update = fields((raw as Fields).update);
    if (update === null) return null;
    const parsed: Record<string, unknown> = {};
    if (typeof update.label === "string") parsed.label = update.label;
    if (typeof update.isDefault === "boolean") parsed.isDefault = update.isDefault;
    if ("tag" in update) parsed.tag = nullableString(update.tag);
    if (typeof update.supportsContinuousRun === "boolean") parsed.supportsContinuousRun = update.supportsContinuousRun;
    return { ...id, update: parsed };
}

const RESULT_STATES: readonly unknown[] = Object.values(TestResultState);

/** The message's fields, when it names a run. */
function runEnvelope(raw: unknown): (Fields & { readonly runId: string }) | null {
    const p = fields(raw);
    return typeof p?.runId === "string" && p.runId !== "" ? (p as Fields & { readonly runId: string }) : null;
}

/** The message's fields, when it names a run and a task of it. */
function taskEnvelope(raw: unknown): (Fields & { readonly runId: string; readonly taskId: string }) | null {
    const p = runEnvelope(raw);
    return typeof p?.taskId === "string" ? (p as Fields & { readonly runId: string; readonly taskId: string }) : null;
}

function parseLocation(raw: unknown): IWireTestLocation | undefined {
    const p = fields(raw);
    const range = parseRange(p?.range);
    return typeof p?.uri === "string" && range !== null ? { uri: p.uri, range } : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseWireExtensionTestRun(raw: unknown): IWireExtensionTestRun | null {
    const p = runEnvelope(raw);
    if (p === null || typeof p.controllerId !== "string") return null;
    return {
        runId: p.runId,
        controllerId: p.controllerId,
        include: strings(p.include),
        exclude: strings(p.exclude),
        profileId: typeof p.profileId === "number" ? p.profileId : null,
        preserveFocus: p.preserveFocus !== false,
        persist: p.persist !== false,
        continuous: p.continuous === true,
    };
}

export function parseWireTestRunId(raw: unknown): string | null {
    return runEnvelope(raw)?.runId ?? null;
}

export function parseWireTestRunTask(raw: unknown): IWireTestRunTask | null {
    const p = taskEnvelope(raw);
    if (p === null || typeof p.controllerId !== "string") return null;
    return { runId: p.runId, taskId: p.taskId, controllerId: p.controllerId, name: optionalString(p.name) ?? "" };
}

export function parseWireTestRunTaskId(raw: unknown): IWireTestRunTaskId | null {
    const p = taskEnvelope(raw);
    return p === null ? null : { runId: p.runId, taskId: p.taskId };
}

/** A malformed test cuts the chain there: its descendants have no parent the run knows. */
export function parseWireAddTestsToRun(raw: unknown): IWireAddTestsToRun | null {
    const p = runEnvelope(raw);
    if (p === null || typeof p.controllerId !== "string" || !Array.isArray(p.tests)) return null;
    const tests: IWireTestItem[] = [];
    for (const test of p.tests) {
        const parsed = parseTestItem(test);
        if (parsed === null) break;
        tests.push(parsed);
    }
    return { controllerId: p.controllerId, runId: p.runId, tests };
}

export function parseWireTestStateInRun(raw: unknown): IWireTestStateInRun | null {
    const p = taskEnvelope(raw);
    if (p === null || typeof p.testId !== "string" || !RESULT_STATES.includes(p.state)) return null;
    return {
        runId: p.runId,
        taskId: p.taskId,
        testId: p.testId,
        state: p.state as TestResultState,
        duration: optionalNumber(p.duration),
    };
}

function parseStackFrame(raw: unknown): IWireTestMessageStackFrame | null {
    const p = fields(raw);
    if (typeof p?.label !== "string") return null;
    const position = fields(p.position);
    return {
        label: p.label,
        uri: optionalString(p.uri),
        position:
            typeof position?.line === "number" && typeof position.character === "number"
                ? { line: position.line, character: position.character }
                : undefined,
    };
}

function parseTestMessage(raw: unknown): IWireTestMessage | null {
    const p = fields(raw);
    if (typeof p?.message !== "string") return null;
    return {
        message: p.message,
        expected: optionalString(p.expected),
        actual: optionalString(p.actual),
        contextValue: optionalString(p.contextValue),
        location: parseLocation(p.location),
        stackTrace: Array.isArray(p.stackTrace)
            ? p.stackTrace.flatMap((frame) => parseStackFrame(frame) ?? [])
            : undefined,
    };
}

/** A malformed message is dropped, the rest are kept. */
export function parseWireTestMessagesInRun(raw: unknown): IWireTestMessagesInRun | null {
    const p = taskEnvelope(raw);
    if (p === null || typeof p.testId !== "string" || !Array.isArray(p.messages)) return null;
    return {
        runId: p.runId,
        taskId: p.taskId,
        testId: p.testId,
        messages: p.messages.flatMap((message) => parseTestMessage(message) ?? []),
    };
}

export function parseWireTestOutputInRun(raw: unknown): IWireTestOutputInRun | null {
    const p = taskEnvelope(raw);
    if (p === null || typeof p.output !== "string") return null;
    return {
        runId: p.runId,
        taskId: p.taskId,
        output: p.output,
        location: parseLocation(p.location),
        testId: optionalString(p.testId),
    };
}
