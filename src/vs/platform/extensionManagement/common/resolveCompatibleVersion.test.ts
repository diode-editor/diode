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

    it("запись с не-semver версией (собрана программно, мимо парсера) пропускается", () => {
        const versions = [
            version("latest", { vscode: "*" }),
            version("1.0.0", { vscode: "*" }),
        ];
        expect(resolveCompatibleVersion(versions, HOST)?.version).toBe("1.0.0");
    });

    it("prerelease ниже релиза той же версии", () => {
        const versions = [
            version("1.2.0-rc.1", { vscode: "*" }),
            version("1.2.0", { vscode: "*" }),
        ];
        expect(resolveCompatibleVersion(versions, HOST)?.version).toBe("1.2.0");
    });
});
