import { describe, expect, it } from "vitest";

import { compareSemver, type ISemver, parseSemver, satisfiesSemverRange } from "./semver.ts";

describe("parseSemver", () => {
    it.each([
        ["1.2.3", { major: 1, minor: 2, patch: 3, prerelease: undefined }],
        ["0.0.0", { major: 0, minor: 0, patch: 0, prerelease: undefined }],
        ["10.20.30", { major: 10, minor: 20, patch: 30, prerelease: undefined }],
        ["1.2.3-beta.1", { major: 1, minor: 2, patch: 3, prerelease: "beta.1" }],
        ["0.0.0-dev", { major: 0, minor: 0, patch: 0, prerelease: "dev" }],
        ["1.2.3+build.5", { major: 1, minor: 2, patch: 3, prerelease: undefined }],
        ["1.2.3+build.abc", { major: 1, minor: 2, patch: 3, prerelease: undefined }],
        ["1.2.3-rc.1+build", { major: 1, minor: 2, patch: 3, prerelease: "rc.1" }],
        ["1.2.3-beta-1", { major: 1, minor: 2, patch: 3, prerelease: "beta-1" }],
        ["  1.2.3  ", { major: 1, minor: 2, patch: 3, prerelease: undefined }],
    ] satisfies [string, ISemver][])("парсит %s", (input, expected) => {
        expect(parseSemver(input)).toEqual(expected);
    });

    it.each(["", "1", "1.2", "1.2.3.4", "v1.2.3", "^1.2.3", "1.2.x", "one.two.three", "1.2.3-", "1.2.3-бета"])(
        "отвергает %j",
        (input) => {
            expect(parseSemver(input)).toBeUndefined();
        },
    );
});

function cmp(a: string, b: string): number {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    if (pa === undefined || pb === undefined) throw new Error(`unparseable versions: ${a}, ${b}`);
    return compareSemver(pa, pb);
}

describe("compareSemver", () => {
    it.each([
        ["1.0.0", "2.0.0"],
        ["1.1.0", "1.2.0"],
        ["1.1.1", "1.1.2"],
        // Prerelease меньше релиза той же версии.
        ["1.0.0-rc.1", "1.0.0"],
        // Числовые идентификаторы сравниваются численно (2 < 10).
        ["1.0.0-beta.2", "1.0.0-beta.10"],
        // Многозначные числовые — тоже численно, хотя лексикографически порядок обратный.
        ["1.0.0-21", "1.0.0-103"],
        // Числовой идентификатор ниже буквенного.
        ["1.0.0-1", "1.0.0-alpha"],
        // Числовой ниже буквенного, даже когда буквенный начинается с цифры.
        ["1.0.0-2", "1.0.0-1a"],
        // Буквенные — лексикографически.
        ["1.0.0-alpha", "1.0.0-beta"],
        // Буквенные с цифрами на конце — всё ещё лексикографически, не численно.
        ["1.0.0-alpha1", "1.0.0-beta1"],
        // Меньший набор полей меньше.
        ["1.0.0-alpha", "1.0.0-alpha.1"],
    ])("%s < %s", (a, b) => {
        expect(cmp(a, b)).toBeLessThan(0);
        expect(cmp(b, a)).toBeGreaterThan(0);
    });

    it.each([
        ["1.2.3", "1.2.3"],
        ["1.0.0-rc.1", "1.0.0-rc.1"],
    ])("%s == %s", (a, b) => {
        expect(cmp(a, b)).toBe(0);
    });
});

describe("satisfiesSemverRange", () => {
    it.each([
        // Звёздочка и точная версия.
        ["1.2.3", "*", true],
        ["1.2.3", "1.2.3", true],
        ["1.2.3", "=1.2.3", true],
        ["1.2.4", "1.2.3", false],
        // Caret: до следующего major.
        ["1.5.0", "^1.2.3", true],
        ["1.2.3", "^1.2.3", true],
        ["2.0.0", "^1.2.3", false],
        ["1.2.2", "^1.2.3", false],
        // Caret с нулевой семантикой: ^0.y.z — до следующего minor.
        ["0.3.5", "^0.3.0", true],
        ["0.4.0", "^0.3.0", false],
        // ^0.0.z — только точный patch.
        ["0.0.3", "^0.0.3", true],
        ["0.0.4", "^0.0.3", false],
        // Тильда: до следующего minor.
        ["1.2.3", "~1.2.3", true],
        ["1.2.9", "~1.2.3", true],
        ["1.3.0", "~1.2.3", false],
        ["1.2.2", "~1.2.3", false],
        // Компараторы. Равенство на >= заодно закрепляет порядок операторов:
        // если бы ">" матчился раньше ">=", хвост "=1.85.0" не распарсился бы.
        ["1.85.0", ">=1.85.0", true],
        ["1.90.0", ">=1.85.0", true],
        // Другой major тоже проходит — >= не ограничен сверху (в отличие от caret).
        ["2.5.0", ">=1.85.0", true],
        ["1.80.0", ">=1.85.0", false],
        ["1.85.0", ">1.85.0", false],
        ["1.85.1", ">1.85.0", true],
        ["1.85.0", "<=1.85.0", true],
        ["1.85.1", "<=1.85.0", false],
        ["1.84.0", "<1.85.0", true],
        ["1.85.0", "<1.85.0", false],
        // Конъюнкция через пробел.
        ["1.5.0", ">=1.2.0 <2.0.0", true],
        ["2.1.0", ">=1.2.0 <2.0.0", false],
        ["1.1.0", ">=1.2.0 <2.0.0", false],
        // Пробелы по краям и несколько пробелов между компараторами не мешают.
        ["1.5.0", " >=1.2.0  <2.0.0 ", true],
        ["1.2.3", " * ", true],
        // Prerelease против границ.
        ["1.0.0-rc.1", "<1.0.0", true],
        ["1.0.0-rc.1", ">=1.0.0", false],
        // Осознанно неподдерживаемые формы → false.
        ["1.2.3", "1.2.x", false],
        ["1.2.3", "1.x", false],
        ["1.2.3", ">=1.0.0 || >=2.0.0", false],
        ["1.2.3", "1.0.0 - 2.0.0", false],
        ["1.2.3", "", false],
        ["1.2.3", "  ", false],
        // Неразбираемая версия → false.
        ["not-a-version", "*", false],
    ])("%s ∈ %j → %s", (version, range, expected) => {
        expect(satisfiesSemverRange(version, range)).toBe(expected);
    });
});
