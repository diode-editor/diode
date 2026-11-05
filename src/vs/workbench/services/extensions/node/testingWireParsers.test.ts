import { describe, expect, it } from "vitest";

import {
    parseWireTestController,
    parseWireTestControllerId,
    parseWireTestControllerPatch,
    parseWireTestRunProfile,
    parseWireTestRunProfileId,
    parseWireTestRunProfileUpdate,
    parseWireTestsDiff,
} from "./testingWireParsers.ts";

const ITEM = {
    extId: "c\0a",
    label: "A",
    tags: ["c\0t", 5],
    busy: true,
    uri: "file:///a.ts",
    range: { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } },
    description: "d",
    error: "e",
    sortText: "s",
};

describe("testing wire parsers", () => {
    it("a controller needs a non-empty id and a label; canRefresh is true only when true", () => {
        expect(parseWireTestController({ controllerId: "c", label: "C", canRefresh: true })).toEqual({
            controllerId: "c",
            label: "C",
            canRefresh: true,
        });
        expect(parseWireTestController({ controllerId: "c", label: "C", canRefresh: "yes" })?.canRefresh).toBe(false);
        expect(parseWireTestController({ controllerId: "c" })).toBeNull();
        expect(parseWireTestController({ controllerId: "", label: "C" })).toBeNull();
        expect(parseWireTestController({ controllerId: 1, label: "C" })).toBeNull();
        expect(parseWireTestController(null)).toBeNull();
        expect(parseWireTestController("c")).toBeNull();
    });

    it("a controller patch keeps only well-typed fields; the id alone is a valid message", () => {
        expect(parseWireTestControllerPatch({ controllerId: "c", label: "L", canRefresh: false })).toEqual({
            controllerId: "c",
            label: "L",
            canRefresh: false,
        });
        expect(parseWireTestControllerPatch({ controllerId: "c", label: 1, canRefresh: "no" })).toEqual({
            controllerId: "c",
            label: undefined,
            canRefresh: undefined,
        });
        expect(parseWireTestControllerPatch({})).toBeNull();
        expect(parseWireTestControllerId({ controllerId: "c" })).toBe("c");
        expect(parseWireTestControllerId({})).toBeNull();
    });

    it("a diff keeps its well-formed ops and drops the rest", () => {
        const diff = parseWireTestsDiff({
            controllerId: "c",
            diff: [
                { op: 0, item: { expand: 1, item: ITEM } },
                { op: 0, item: { expand: 9, item: ITEM } },
                { op: 0, item: { expand: 1, item: { extId: "c\0b" } } },
                { op: 0, item: { expand: 1 } },
                { op: 0 },
                { op: 1, item: { extId: "c\0a", expand: 3 } },
                { op: 1, item: { expand: 3 } },
                { op: 1 },
                { op: 3, itemId: "c\0a" },
                { op: 3, itemId: 7 },
                { op: 5 },
                null,
            ],
        });
        expect(diff).toEqual({
            controllerId: "c",
            diff: [
                {
                    op: 0,
                    item: {
                        expand: 1,
                        item: { ...ITEM, tags: ["c\0t"] },
                    },
                },
                { op: 1, item: { extId: "c\0a", expand: 3, item: undefined } },
                { op: 3, itemId: "c\0a" },
            ],
        });
        expect(parseWireTestsDiff({ controllerId: "c", diff: "x" })).toBeNull();
        expect(parseWireTestsDiff({ diff: [] })).toBeNull();
    });

    it("an added test without optional fields gets upstream nulls", () => {
        const diff = parseWireTestsDiff({
            controllerId: "c",
            diff: [{ op: 0, item: { expand: 0, item: { extId: "c", label: "C", tags: "x", range: "bad" } } }],
        });
        expect(diff?.diff[0]).toEqual({
            op: 0,
            item: {
                expand: 0,
                item: {
                    extId: "c",
                    label: "C",
                    tags: [],
                    busy: false,
                    uri: undefined,
                    range: null,
                    description: null,
                    error: null,
                    sortText: null,
                },
            },
        });
    });

    it("an update patch carries only the fields it sent; a cleared field is null, a wrong-typed one is dropped", () => {
        const update = (item: unknown) =>
            parseWireTestsDiff({ controllerId: "c", diff: [{ op: 1, item: { extId: "c", item } }] })?.diff[0];
        expect(update({ label: "L", tags: ["t"], busy: false, range: ITEM.range, description: "d" })).toEqual({
            op: 1,
            item: {
                extId: "c",
                expand: undefined,
                item: { label: "L", tags: ["t"], busy: false, range: ITEM.range, description: "d" },
            },
        });
        expect(update({ range: null, description: null, error: 5, sortText: "s" })).toMatchObject({
            item: { item: { range: null, description: null, error: null, sortText: "s" } },
        });
        expect(update({ label: 1, tags: "x", busy: "y" })).toEqual({
            op: 1,
            item: { extId: "c", expand: undefined, item: {} },
        });
        expect(update("x")).toEqual({ op: 1, item: { extId: "c", expand: undefined, item: undefined } });
        expect(update(null)).toEqual({ op: 1, item: { extId: "c", expand: undefined, item: undefined } });
    });

    it("a profile needs an id, a label and a known group", () => {
        const raw = {
            controllerId: "c",
            profileId: 7,
            label: "Run",
            group: 2,
            isDefault: true,
            tag: "c\0t",
            hasConfigurationHandler: true,
            supportsContinuousRun: true,
        };
        expect(parseWireTestRunProfile(raw)).toEqual(raw);
        expect(parseWireTestRunProfile({ controllerId: "c", profileId: 7, label: "Run", group: 8 })).toEqual({
            controllerId: "c",
            profileId: 7,
            label: "Run",
            group: 8,
            isDefault: false,
            tag: null,
            hasConfigurationHandler: false,
            supportsContinuousRun: false,
        });
        expect(parseWireTestRunProfile({ ...raw, group: 3 })).toBeNull();
        expect(parseWireTestRunProfile({ ...raw, profileId: "7" })).toBeNull();
        expect(parseWireTestRunProfile({ ...raw, label: undefined })).toBeNull();
        expect(parseWireTestRunProfile({ ...raw, controllerId: undefined })).toBeNull();
    });

    it("a profile id and update; the update keeps only well-typed fields", () => {
        expect(parseWireTestRunProfileId({ controllerId: "c", profileId: 1 })).toEqual({
            controllerId: "c",
            profileId: 1,
        });
        expect(parseWireTestRunProfileId({ controllerId: "c" })).toBeNull();
        expect(parseWireTestRunProfileId({ profileId: 1 })).toBeNull();
        expect(
            parseWireTestRunProfileUpdate({
                controllerId: "c",
                profileId: 1,
                update: { label: "L", isDefault: false, tag: null, supportsContinuousRun: true, group: 4 },
            }),
        ).toEqual({
            controllerId: "c",
            profileId: 1,
            update: { label: "L", isDefault: false, tag: null, supportsContinuousRun: true },
        });
        expect(
            parseWireTestRunProfileUpdate({
                controllerId: "c",
                profileId: 1,
                update: { label: 1, isDefault: "x", tag: 3, supportsContinuousRun: "y" },
            }),
        ).toEqual({ controllerId: "c", profileId: 1, update: { tag: null } });
        expect(parseWireTestRunProfileUpdate({ controllerId: "c", profileId: 1 })).toBeNull();
        expect(parseWireTestRunProfileUpdate({ controllerId: "c", update: {} })).toBeNull();
    });
});
