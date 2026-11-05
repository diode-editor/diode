import {
    type IWireTestController,
    type IWireTestControllerPatch,
    type IWireTestItem,
    type IWireTestItemUpdate,
    type IWireTestRunProfile,
    type IWireTestRunProfileId,
    type IWireTestRunProfileUpdate,
    type IWireTestsDiff,
    TestDiffOpType,
    type TestItemExpandState as ExpandState,
    TestItemExpandState,
    TestRunProfileBitset,
    type TestRunProfileGroup,
    type WireTestsDiffOp,
} from "../../../api/common/testingWireTypes.ts";
import { parseRange } from "../../../api/common/wireTypes.ts";

// Testing messages from the subprocess (`testing.*`); `null` — a malformed message, ignored.

type Fields = Readonly<Record<string, unknown>>;

function fields(raw: unknown): Fields | null {
    return typeof raw === "object" && raw !== null ? (raw as Fields) : null;
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
