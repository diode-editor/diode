import { describe, expect, it } from "vitest";

import type { IRegistryEngines, IRegistryVersion } from "./registryFormat.ts";
import { isVersionCompatible, resolveCompatibleVersion, type IHostVersions } from "./resolveCompatibleVersion.ts";

function version(v: string, engines: IRegistryEngines): IRegistryVersion {
    return {
        version: v,
        engines,
        artifact: { type: "path", path: `artifacts/x-${v}.vsix` },
        sha256: "a".repeat(64),
    };
}

const HOST: IHostVersions = { diode: "0.3.0", vscode: "1.127.0" };
const DEV_HOST: IHostVersions = { diode: "0.0.0-dev", vscode: "1.127.0" };
/** Ночная сборка: версия вида `nightly-<sha>` — не semver. */
const NIGHTLY_HOST: IHostVersions = { diode: "nightly-8263528d", vscode: "1.127.0" };
/** Хост с prerelease-версией шима — проверяет семантику prerelease в диапазонах. */
const PRERELEASE_HOST: IHostVersions = { diode: "0.3.0", vscode: "1.128.0-insider" };

describe("isVersionCompatible", () => {
    it.each([
        ["engines.diode проходит", { diode: "^0.3.0" }, HOST, true],
        ["engines.diode не проходит", { diode: "^0.4.0" }, HOST, false],
        ["engines.vscode проходит", { vscode: "^1.90.0" }, HOST, true],
        ["engines.vscode не проходит", { vscode: "^2.0.0" }, HOST, false],
        ["оба заданы и проходят", { diode: "^0.3.0", vscode: "^1.90.0" }, HOST, true],
        ["оба заданы, diode не проходит", { diode: "^0.4.0", vscode: "^1.90.0" }, HOST, false],
        ["оба заданы, vscode не проходит", { diode: "^0.3.0", vscode: "^2.0.0" }, HOST, false],
        // Dev-версия Diode пропускает diode-канал…
        ["dev-хост пропускает diode-канал", { diode: "^99.0.0" }, DEV_HOST, true],
        // …но не vscode-канал — версия шима всегда реальна.
        ["dev-хост не пропускает vscode-канал", { diode: "^99.0.0", vscode: "^2.0.0" }, DEV_HOST, false],
        // Ночная сборка (`nightly-<sha>`) — та же логика, что у dev: релизной версии нет.
        ["nightly-хост пропускает diode-канал", { diode: "^99.0.0" }, NIGHTLY_HOST, true],
        ["nightly-хост не пропускает vscode-канал", { vscode: "^2.0.0" }, NIGHTLY_HOST, false],
        // Полный язык диапазонов node-semver: engines прокси-расширений пишем не мы.
        ["диапазон с ||", { vscode: "^1.60.0 || ^2.0.0" }, HOST, true],
        ["x-диапазон", { vscode: "1.x" }, HOST, true],
        ["x-диапазон другого major", { vscode: "2.x" }, HOST, false],
        ["дефисный диапазон", { vscode: "1.90.0 - 1.130.0" }, HOST, true],
        ["дефисный диапазон мимо", { vscode: "1.0.0 - 1.90.0" }, HOST, false],
        // Prerelease-версия хоста в диапазон без явного запроса не попадает…
        ["prerelease-хост вне обычного диапазона", { vscode: "^1.128.0" }, PRERELEASE_HOST, false],
        // …и попадает, когда диапазон её запросил явно.
        ["prerelease-хост в диапазоне с prerelease", { vscode: "^1.128.0-insider" }, PRERELEASE_HOST, true],
        // Мусорный диапазон не бросает исключение, а даёт «несовместимо».
        ["неразбираемый диапазон", { vscode: "не-диапазон" }, HOST, false],
    ] satisfies [string, IRegistryEngines, IHostVersions, boolean][])("%s", (_label, engines, host, expected) => {
        expect(isVersionCompatible(version("1.0.0", engines), host)).toBe(expected);
    });
});

describe("resolveCompatibleVersion", () => {
    it("выбирает наивысшую совместимую независимо от порядка в списке", () => {
        const versions = [
            version("1.0.0", { vscode: "^1.90.0" }),
            version("1.2.0", { vscode: "^1.90.0" }),
            version("1.1.0", { vscode: "^1.90.0" }),
        ];
        expect(resolveCompatibleVersion(versions, HOST)?.version).toBe("1.2.0");
    });

    it("несовместимая наивысшая пропускается в пользу совместимой ниже", () => {
        const versions = [
            version("2.0.0", { vscode: "^99.0.0" }),
            version("1.2.0", { vscode: "^1.90.0" }),
        ];
        expect(resolveCompatibleVersion(versions, HOST)?.version).toBe("1.2.0");
    });

    it("нет совместимых — undefined", () => {
        expect(resolveCompatibleVersion([version("1.0.0", { vscode: "^99.0.0" })], HOST)).toBeUndefined();
    });

    it("пустой список — undefined", () => {
        expect(resolveCompatibleVersion([], HOST)).toBeUndefined();
    });

    // Оба порядка: не-semver запись не должна ни выигрывать, ни ломать сравнение
    // с уже выбранным кандидатом.
    it.each([
        ["перед валидной", ["latest", "1.0.0"]],
        ["после валидной", ["1.0.0", "latest"]],
    ] satisfies [string, string[]][])(
        "запись с не-semver версией (собрана программно, мимо парсера) пропускается — %s",
        (_label, order) => {
            const versions = order.map((v) => version(v, { vscode: "*" }));
            expect(resolveCompatibleVersion(versions, HOST)?.version).toBe("1.0.0");
        },
    );

    it("при равных версиях побеждает первая запись", () => {
        const first = version("1.0.0", { vscode: "*" });
        const duplicate = version("1.0.0", { vscode: "*" });
        expect(resolveCompatibleVersion([first, duplicate], HOST)).toBe(first);
    });

    it("prerelease ниже релиза той же версии", () => {
        const versions = [
            version("1.2.0-rc.1", { vscode: "*" }),
            version("1.2.0", { vscode: "*" }),
        ];
        expect(resolveCompatibleVersion(versions, HOST)?.version).toBe("1.2.0");
    });
});
