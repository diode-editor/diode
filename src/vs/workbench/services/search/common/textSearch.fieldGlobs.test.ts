import { describe, expect, it } from "vitest";

import { parseSearchFieldGlobs } from "./textSearch.ts";

// Expectations follow upstream `parseSearchPaths` (`queryBuilder.ts`) for a single folder.
describe("parseSearchFieldGlobs", () => {
    it.each<[string, string, string[]]>([
        ["empty field", "", []],
        ["only spaces and commas", " , ,", []],
        ["a name: at any depth and everything under it", "common", ["**/common/**", "**/common"]],
        ["a path with a slash: also at any depth", "nci/common", ["**/nci/common/**", "**/nci/common"]],
        ["file mask", "*.ts", ["**/*.ts/**", "**/*.ts"]],
        ["`.js` is short for `*.js`", ".js", ["**/*.js/**", "**/*.js"]],
        ["a leading `**` is not doubled", "**/gen", ["**/gen/**", "**/gen"]],
        ["a trailing `**` is not doubled", "out/**", ["**/out/**", "**/out/**"]],
        ["a trailing `/` is stripped", "dist/", ["**/dist/**", "**/dist"]],
        ["a trailing `\\` is stripped", "dist\\", ["**/dist/**", "**/dist"]],
        ["`./x` is a path from the root", "./common", ["common", "common/**"]],
        ["`.\\x` is a path from the root in windows form", ".\\nci\\common", ["nci/common", "nci/common/**"]],
        ["`./x/`: the tail is stripped", "./common/", ["common", "common/**"]],
        // `**` would override `.gitignore` (rg's `--glob` beats ignore files)
        ["`.` is the root itself, gives no pattern", ".", []],
        ["`./` is the root itself, gives no pattern", "./", []],
        ["`..` is outside the root, skipped", "..", []],
        ["`../x` is outside the root, skipped", "../other", []],
        ["an absolute posix path is skipped", "/abs/path", []],
        ["an absolute windows path is skipped", "C:\\abs", []],
        ["a UNC path is skipped", "\\\\server\\share", []],
    ])("%s: %j", (_name, value, expected) => {
        expect(parseSearchFieldGlobs(value)).toEqual(expected);
    });

    it("a comma-separated list, surrounding spaces are stripped", () => {
        expect(parseSearchFieldGlobs(" *.ts ,  ./src ")).toEqual(["**/*.ts/**", "**/*.ts", "src", "src/**"]);
    });

    it("a comma inside `{…}` does not split the field", () => {
        expect(parseSearchFieldGlobs("*.{ts,js}, out")).toEqual([
            "**/*.{ts,js}/**",
            "**/*.{ts,js}",
            "**/out/**",
            "**/out",
        ]);
    });

    it("a skipped segment does not break its neighbors", () => {
        expect(parseSearchFieldGlobs("../x, common")).toEqual(["**/common/**", "**/common"]);
    });
});
