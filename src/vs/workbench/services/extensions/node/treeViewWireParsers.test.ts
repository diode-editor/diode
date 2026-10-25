import { describe, expect, it } from "vitest";

import {
    parseWireTreeItems,
    parseWireTreeViewId,
    parseWireTreeViewMessage,
    parseWireTreeViewRefresh,
    parseWireTreeViewRegistration,
    parseWireTreeViewReveal,
    parseWireTreeViewTitle,
} from "./treeViewWireParsers.ts";

describe("treeViewWireParsers", () => {
    it("registration: flags are true only when true, the owner only when a string", () => {
        expect(
            parseWireTreeViewRegistration({
                viewId: "v",
                showCollapseAll: true,
                canSelectMany: true,
                extensionId: "p.e",
            }),
        ).toEqual({
            viewId: "v",
            showCollapseAll: true,
            canSelectMany: true,
            extensionId: "p.e",
        });
        expect(parseWireTreeViewRegistration({ viewId: "v", showCollapseAll: 1, extensionId: 5 })).toEqual({
            viewId: "v",
            showCollapseAll: false,
            canSelectMany: false,
        });
        expect(parseWireTreeViewRegistration({ viewId: "" })).toBeNull();
        expect(parseWireTreeViewRegistration(null)).toBeNull();
        expect(parseWireTreeViewRegistration({ viewId: 3 })).toBeNull();
    });

    it("view id", () => {
        expect(parseWireTreeViewId({ viewId: "v" })).toBe("v");
        expect(parseWireTreeViewId(undefined)).toBeNull();
    });

    it("refresh: no items is the root, an array is the rows, anything else is malformed", () => {
        expect(parseWireTreeViewRefresh({ viewId: "v" })).toEqual({ viewId: "v" });
        expect(
            parseWireTreeViewRefresh({ viewId: "v", items: [{ handle: "h", label: "l", collapsibleState: 1 }] }),
        ).toEqual({
            viewId: "v",
            items: [{ handle: "h", label: "l", collapsibleState: 1 }],
        });
        expect(parseWireTreeViewRefresh({ viewId: "v", items: "x" })).toBeNull();
        expect(parseWireTreeViewRefresh({})).toBeNull();
    });

    it("message and title", () => {
        expect(parseWireTreeViewMessage({ viewId: "v", message: "m" })).toEqual({ viewId: "v", message: "m" });
        expect(parseWireTreeViewMessage({ viewId: "v", message: 1 })).toBeNull();
        expect(parseWireTreeViewMessage({ message: "m" })).toBeNull();
        expect(parseWireTreeViewTitle({ viewId: "v", title: "T", description: "d" })).toEqual({
            viewId: "v",
            title: "T",
            description: "d",
        });
        expect(parseWireTreeViewTitle({ viewId: "v", title: 1, description: null })).toEqual({ viewId: "v" });
        expect(parseWireTreeViewTitle({})).toBeNull();
    });

    it("reveal: defaults select, no focus, no expand; a malformed item rejects the message", () => {
        const row = { handle: "h", label: "l", collapsibleState: 0 };
        expect(
            parseWireTreeViewReveal({
                viewId: "v",
                item: row,
                parentChain: [row],
                select: false,
                focus: true,
                expand: 3,
            }),
        ).toEqual({
            viewId: "v",
            item: row,
            parentChain: [row],
            select: false,
            focus: true,
            expand: 3,
        });
        expect(parseWireTreeViewReveal({ viewId: "v", expand: true })).toEqual({
            viewId: "v",
            parentChain: [],
            select: true,
            focus: false,
            expand: true,
        });
        expect(parseWireTreeViewReveal({ viewId: "v", expand: "yes", focus: 1, parentChain: "x" })).toMatchObject({
            expand: false,
            focus: false,
            parentChain: [],
        });
        expect(parseWireTreeViewReveal({ viewId: "v", item: { label: "no handle" } })).toBeNull();
        expect(parseWireTreeViewReveal({})).toBeNull();
    });

    it("items: every field is checked, rows without a handle are dropped", () => {
        expect(
            parseWireTreeItems([
                {
                    handle: "h",
                    parentHandle: "p",
                    label: "l",
                    description: "d",
                    collapsibleState: 2,
                    themeIcon: { id: "package", color: "c" },
                    resourceUri: "file:///a",
                    contextValue: "ctx",
                    command: { id: "x", title: "X" },
                },
                {
                    handle: "g",
                    parentHandle: 1,
                    label: 2,
                    description: true,
                    collapsibleState: 7,
                    themeIcon: { id: "play", color: 1 },
                    resourceUri: 3,
                    contextValue: 4,
                    command: { id: "y" },
                },
                { handle: "k", description: false, themeIcon: { color: "c" }, command: { title: "no id" } },
                { handle: "" },
                null,
                "x",
            ]),
        ).toEqual([
            {
                handle: "h",
                parentHandle: "p",
                label: "l",
                description: "d",
                collapsibleState: 2,
                themeIcon: { id: "package", color: "c" },
                resourceUri: "file:///a",
                contextValue: "ctx",
                command: { id: "x", title: "X" },
            },
            {
                handle: "g",
                label: "",
                description: true,
                collapsibleState: 0,
                themeIcon: { id: "play" },
                command: { id: "y", title: "" },
            },
            { handle: "k", label: "", collapsibleState: 0 },
        ]);
        expect(parseWireTreeItems([{ handle: "c", collapsibleState: 1 }])[0].collapsibleState).toBe(1);
        expect(parseWireTreeItems("nope")).toEqual([]);
    });
});
