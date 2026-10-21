import { describe, expect, it } from "vitest";

import { parseTreeWatcherRequest, parseTreeWatcherResponse } from "./treeWatcherProtocol.ts";

describe("parseTreeWatcherRequest", () => {
    it("parses watch with all fields", () => {
        expect(
            parseTreeWatcherRequest({
                t: "watch",
                id: 7,
                rootPath: "/repo",
                options: { recursive: true, excludes: ["**/node_modules"] },
            }),
        ).toEqual({
            t: "watch",
            id: 7,
            rootPath: "/repo",
            options: { recursive: true, excludes: ["**/node_modules"] },
        });
    });

    it("parses unwatch", () => {
        expect(parseTreeWatcherRequest({ t: "unwatch", id: 3 })).toEqual({ t: "unwatch", id: 3 });
    });

    it("a non-recursive request does not turn recursive", () => {
        const parsed = parseTreeWatcherRequest({
            t: "watch",
            id: 1,
            rootPath: "/repo/.git",
            options: { recursive: false, excludes: [] },
        });
        expect(parsed).toEqual({
            t: "watch",
            id: 1,
            rootPath: "/repo/.git",
            options: { recursive: false, excludes: [] },
        });
    });

    it.each([
        ["not an object", "watch"],
        ["null", null],
        ["no id", { t: "watch", rootPath: "/repo", options: { recursive: true, excludes: [] } }],
        ["id not a number", { t: "watch", id: "7", rootPath: "/repo", options: { recursive: true, excludes: [] } }],
        ["unknown type", { t: "sniff", id: 1 }],
        // The discriminant is actually read: in every other respect this is a valid watch.
        [
            "foreign type with valid watch fields",
            { t: "sniff", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } },
        ],
        ["no rootPath", { t: "watch", id: 1, options: { recursive: true, excludes: [] } }],
        ["no options", { t: "watch", id: 1, rootPath: "/repo" }],
        ["options not an object", { t: "watch", id: 1, rootPath: "/repo", options: 42 }],
        ["recursive not a boolean", { t: "watch", id: 1, rootPath: "/repo", options: { recursive: 1, excludes: [] } }],
        ["excludes not an array", { t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: {} } }],
    ])("rejects garbage: %s", (_name, raw) => {
        expect(parseTreeWatcherRequest(raw)).toBeNull();
    });
});

describe("parseTreeWatcherResponse", () => {
    it("parses an event batch", () => {
        const changes = [{ type: "created", path: "/repo/a.ts" }];
        expect(parseTreeWatcherResponse({ t: "changes", id: 2, changes })).toEqual({ t: "changes", id: 2, changes });
    });

    it("an empty batch is a valid message (not a missing message)", () => {
        expect(parseTreeWatcherResponse({ t: "changes", id: 2, changes: [] })).toEqual({
            t: "changes",
            id: 2,
            changes: [],
        });
    });

    it("parses a log entry with its trailing arguments", () => {
        expect(
            parseTreeWatcherResponse({
                t: "log",
                level: "warn",
                message: "tree watcher error",
                args: [{ code: "ENOSPC" }],
            }),
        ).toEqual({ t: "log", level: "warn", message: "tree watcher error", args: [{ code: "ENOSPC" }] });
    });

    it.each(["trace", "debug", "info", "warn", "error"])("parses level %s", (level) => {
        expect(parseTreeWatcherResponse({ t: "log", level, message: "hi", args: [] })).toEqual({
            t: "log",
            level,
            message: "hi",
            args: [],
        });
    });

    it.each([
        ["not an object", 12],
        ["null", null],
        ["unknown type", { t: "hello" }],
        // In every other respect this is a valid log: it's the discriminant that rejects it.
        ["foreign type with valid log fields", { t: "hello", level: "warn", message: "hi", args: [] }],
        ["changes without id", { t: "changes", changes: [] }],
        ["changes not an array", { t: "changes", id: 1, changes: "a.ts" }],
        ["log without level", { t: "log", message: "hi", args: [] }],
        ["log with a foreign level", { t: "log", level: "fatal", message: "hi", args: [] }],
        ["log without message", { t: "log", level: "warn", args: [] }],
        ["log without args", { t: "log", level: "warn", message: "hi" }],
    ])("rejects garbage: %s", (_name, raw) => {
        expect(parseTreeWatcherResponse(raw)).toBeNull();
    });
});
