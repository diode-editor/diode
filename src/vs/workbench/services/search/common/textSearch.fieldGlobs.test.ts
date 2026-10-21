import { describe, expect, it } from "vitest";

import { parseSearchFieldGlobs } from "./textSearch.ts";

// Expectations follow upstream `parseSearchPaths` (`queryBuilder.ts`) for a single folder.
describe("parseSearchFieldGlobs", () => {
    it.each<[string, string, string[]]>([
        ["пустое поле", "", []],
        ["одни пробелы и запятые", " , ,", []],
        ["имя — на любой глубине и всё под ним", "common", ["**/common/**", "**/common"]],
        ["путь со слэшем — тоже на любой глубине", "nci/common", ["**/nci/common/**", "**/nci/common"]],
        ["маска файла", "*.ts", ["**/*.ts/**", "**/*.ts"]],
        ["`.js` — сокращение `*.js`", ".js", ["**/*.js/**", "**/*.js"]],
        ["ведущий `**` не удваивается", "**/gen", ["**/gen/**", "**/gen"]],
        ["хвостовой `**` не удваивается", "out/**", ["**/out/**", "**/out/**"]],
        ["хвостовой `/` срезается", "dist/", ["**/dist/**", "**/dist"]],
        ["хвостовой `\\` срезается", "dist\\", ["**/dist/**", "**/dist"]],
        ["`./x` — путь от корня", "./common", ["common", "common/**"]],
        ["`.\\x` — путь от корня в windows-форме", ".\\nci\\common", ["nci/common", "nci/common/**"]],
        ["`./x/` — хвост срезается", "./common/", ["common", "common/**"]],
        // `**` would override `.gitignore` (rg's `--glob` beats ignore files)
        ["`.` — сам корень, шаблона не даёт", ".", []],
        ["`./` — сам корень, шаблона не даёт", "./", []],
        ["`..` — вне корня, пропускается", "..", []],
        ["`../x` — вне корня, пропускается", "../other", []],
        ["абсолютный posix-путь пропускается", "/abs/path", []],
        ["абсолютный windows-путь пропускается", "C:\\abs", []],
        ["UNC-путь пропускается", "\\\\server\\share", []],
    ])("%s: %j", (_name, value, expected) => {
        expect(parseSearchFieldGlobs(value)).toEqual(expected);
    });

    it("список через запятую, пробелы вокруг срезаются", () => {
        expect(parseSearchFieldGlobs(" *.ts ,  ./src ")).toEqual(["**/*.ts/**", "**/*.ts", "src", "src/**"]);
    });

    it("запятая внутри `{…}` не делит поле", () => {
        expect(parseSearchFieldGlobs("*.{ts,js}, out")).toEqual([
            "**/*.{ts,js}/**",
            "**/*.{ts,js}",
            "**/out/**",
            "**/out",
        ]);
    });

    it("пропущенный сегмент не роняет соседей", () => {
        expect(parseSearchFieldGlobs("../x, common")).toEqual(["**/common/**", "**/common"]);
    });
});
