import { afterEach, describe, expect, it } from "vitest";

import { currentOperatingSystem, OperatingSystem } from "./platform.ts";

describe("currentOperatingSystem", () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform");

    afterEach(() => {
        if (original !== undefined) Object.defineProperty(process, "platform", original);
    });

    it.each([
        ["win32", OperatingSystem.Windows],
        ["darwin", OperatingSystem.Macintosh],
        ["linux", OperatingSystem.Linux],
        ["freebsd", OperatingSystem.Linux],
    ] as const)("%s → %i, read on every call", (platform, expected) => {
        Object.defineProperty(process, "platform", { value: platform, configurable: true });
        expect(currentOperatingSystem()).toBe(expected);
    });
});
