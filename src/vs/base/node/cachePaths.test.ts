import { describe, expect, it } from "vitest";

import { userCacheDir } from "./cachePaths.ts";

describe("cachePaths — userCacheDir", () => {
    it("linux/mac: XDG_CACHE_HOME приоритетнее ~/.cache; пустая переменная игнорируется", () => {
        expect(userCacheDir({ XDG_CACHE_HOME: "/xdg" }, "linux", "/home/u")).toBe("/xdg/vexx");
        expect(userCacheDir({}, "linux", "/home/u")).toBe("/home/u/.cache/vexx");
        expect(userCacheDir({ XDG_CACHE_HOME: "" }, "darwin", "/Users/u")).toBe("/Users/u/.cache/vexx");
    });

    it("windows: LOCALAPPDATA, иначе AppData/Local от home", () => {
        expect(userCacheDir({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32", "C:\\Users\\u")).toMatch(
            /vexx[\\/]cache$/,
        );
        expect(userCacheDir({}, "win32", "/home/u")).toContain("AppData");
    });
});
