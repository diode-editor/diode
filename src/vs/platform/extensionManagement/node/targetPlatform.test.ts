import { describe, expect, it } from "vitest";

import { currentTargetPlatform } from "./targetPlatform.ts";

describe("currentTargetPlatform", () => {
    it.each([
        ["win32", "x64", "win32-x64"],
        ["win32", "arm64", "win32-arm64"],
        ["linux", "x64", "linux-x64"],
        ["linux", "arm64", "linux-arm64"],
        ["linux", "arm", "linux-armhf"],
        ["darwin", "x64", "darwin-x64"],
        ["darwin", "arm64", "darwin-arm64"],
    ] satisfies [NodeJS.Platform, NodeJS.Architecture, string][])("%s/%s → %s", (platform, arch, expected) => {
        expect(currentTargetPlatform(platform, arch)).toBe(expected);
    });

    // Неизвестная комбинация — universal-only хост, а не выдуманный таргет.
    it.each([
        ["freebsd", "x64"],
        ["win32", "ia32"],
        ["linux", "ppc64"],
        ["darwin", "arm"],
    ] satisfies [NodeJS.Platform, NodeJS.Architecture][])("%s/%s → undefined", (platform, arch) => {
        expect(currentTargetPlatform(platform, arch)).toBeUndefined();
    });

    it("без аргументов отвечает за текущий процесс", () => {
        expect(currentTargetPlatform()).toBe(currentTargetPlatform(process.platform, process.arch));
    });
});
