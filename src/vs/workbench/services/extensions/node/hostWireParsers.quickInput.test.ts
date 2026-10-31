import { describe, expect, it } from "vitest";

import {
    parseWireInputBoxRequest,
    parseWireQuickInputCancel,
    parseWireQuickPickItems,
    parseWireQuickPickRequest,
    parseWireValidationMessage,
} from "./hostWireParsers.ts";

describe("parseWireQuickPickItems", () => {
    it("garbage gives null", () => {
        expect(parseWireQuickPickItems(null)).toBeNull();
        expect(parseWireQuickPickItems({ items: [] })).toBeNull();
    });
});

describe("parseWireInputBoxRequest", () => {
    it("parses a full request", () => {
        expect(
            parseWireInputBoxRequest({
                handle: 3,
                title: "Your name",
                prompt: "How should we address you",
                placeHolder: "name",
                value: "Ada",
                password: true,
                validates: true,
            }),
        ).toEqual({
            handle: 3,
            title: "Your name",
            prompt: "How should we address you",
            placeHolder: "name",
            value: "Ada",
            password: true,
            validates: true,
        });
    });

    it("optional fields are absent rather than arriving as undefined", () => {
        expect(parseWireInputBoxRequest({ handle: 1 })).toEqual({ handle: 1, password: false, validates: false });
    });

    it("non-string options are dropped", () => {
        expect(parseWireInputBoxRequest({ handle: 1, title: 7, prompt: null, value: {} })).toEqual({
            handle: 1,
            password: false,
            validates: false,
        });
    });

    it("no numeric handle gives null", () => {
        expect(parseWireInputBoxRequest({ handle: "three" })).toBeNull();
        expect(parseWireInputBoxRequest({})).toBeNull();
        expect(parseWireInputBoxRequest(null)).toBeNull();
        expect(parseWireInputBoxRequest("string")).toBeNull();
    });

    it("validates is strictly boolean: anything but true means `no validator`", () => {
        expect(parseWireInputBoxRequest({ handle: 1, validates: "yes" })?.validates).toBe(false);
        expect(parseWireInputBoxRequest({ handle: 1, validates: true })?.validates).toBe(true);
    });

    it("password is strictly boolean: only a real true enables the mask", () => {
        expect(parseWireInputBoxRequest({ handle: 1, password: true })?.password).toBe(true);
        // A non-empty string is truthy in JavaScript, but it doesn't turn the password
        // field on: otherwise garbage on the wire would blind a regular field.
        expect(parseWireInputBoxRequest({ handle: 1, password: "yes" })?.password).toBe(false);
        expect(parseWireInputBoxRequest({ handle: 1, password: 0 })?.password).toBe(false);
    });
});

describe("parseWireQuickPickRequest", () => {
    it("parses a list with descriptions", () => {
        expect(
            parseWireQuickPickRequest({
                handle: 2,
                title: "Who",
                placeHolder: "Pick one",
                canPickMany: true,
                items: [{ label: "a" }, { label: "b", description: "second" }],
                picked: [1],
            }),
        ).toEqual({
            handle: 2,
            title: "Who",
            placeHolder: "Pick one",
            canPickMany: true,
            items: [{ label: "a" }, { label: "b", description: "second" }],
            picked: [1],
        });
    });

    it("an item without a label stays an empty string, otherwise the answer indices would shift", () => {
        const parsed = parseWireQuickPickRequest({ handle: 1, items: [{ label: 7 }, { label: "b" }], picked: [] });
        expect(parsed?.items).toEqual([{ label: "" }, { label: "b" }]);
    });

    it("non-object items are dropped", () => {
        const parsed = parseWireQuickPickRequest({ handle: 1, items: ["a", null, { label: "b" }], picked: [] });
        expect(parsed?.items).toEqual([{ label: "b" }]);
    });

    it("out-of-range preselections are dropped", () => {
        const parsed = parseWireQuickPickRequest({
            handle: 1,
            canPickMany: true,
            items: [{ label: "a" }, { label: "b" }],
            picked: [-1, 0, 5, 1.5, "x"],
        });
        expect(parsed?.picked).toEqual([0]);
    });

    it("an index equal to the list length is already out of range", () => {
        const parsed = parseWireQuickPickRequest({
            handle: 1,
            canPickMany: true,
            items: [{ label: "a" }, { label: "b" }],
            picked: [1, 2],
        });
        expect(parsed?.picked).toEqual([1]);
    });

    it("without canPickMany preselections are dropped", () => {
        const parsed = parseWireQuickPickRequest({ handle: 1, items: [{ label: "a" }], picked: [0] });
        expect(parsed?.picked).toEqual([]);
        expect(parsed?.canPickMany).toBe(false);
    });

    it("non-array picked gives empty preselections", () => {
        const parsed = parseWireQuickPickRequest({ handle: 1, canPickMany: true, items: [{ label: "a" }], picked: 7 });
        expect(parsed?.picked).toEqual([]);
    });

    it("no handle or no items array gives null", () => {
        expect(parseWireQuickPickRequest({ items: [] })).toBeNull();
        expect(parseWireQuickPickRequest({ handle: 1 })).toBeNull();
        expect(parseWireQuickPickRequest(null)).toBeNull();
    });
});

describe("parseWireQuickInputCancel", () => {
    it("parses the handle", () => {
        expect(parseWireQuickInputCancel({ handle: 9 })).toBe(9);
    });

    it("garbage gives null", () => {
        expect(parseWireQuickInputCancel({})).toBeNull();
        expect(parseWireQuickInputCancel({ handle: "nine" })).toBeNull();
        expect(parseWireQuickInputCancel(null)).toBeNull();
    });
});

describe("parseWireValidationMessage", () => {
    it("parses a message with severity", () => {
        expect(parseWireValidationMessage({ message: "oops", severity: "warning" })).toEqual({
            message: "oops",
            severity: "warning",
        });
        expect(parseWireValidationMessage({ message: "for your information", severity: "info" })).toEqual({
            message: "for your information",
            severity: "info",
        });
    });

    it("unknown or missing severity means error", () => {
        expect(parseWireValidationMessage({ message: "x" })).toEqual({ message: "x", severity: "error" });
        expect(parseWireValidationMessage({ message: "x", severity: "fatal" })).toEqual({
            message: "x",
            severity: "error",
        });
    });

    it("silence or garbage means the value is fine", () => {
        expect(parseWireValidationMessage(null)).toBeNull();
        expect(parseWireValidationMessage({})).toBeNull();
        expect(parseWireValidationMessage({ message: 7 })).toBeNull();
    });
});
