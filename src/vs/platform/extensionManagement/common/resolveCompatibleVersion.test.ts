import * as semver from "semver";
import { describe, expect, it } from "vitest";

import type { IRegistryEngines, IRegistryVersion } from "./registryFormat.ts";
import { type IHostVersions, isVersionCompatible, resolveCompatibleVersion } from "./resolveCompatibleVersion.ts";

function version(v: string, engines: IRegistryEngines, targetPlatform?: string): IRegistryVersion {
    return {
        version: v,
        engines,
        artifact: { type: "path", path: `artifacts/x-${v}.vsix` },
        sha256: "a".repeat(64),
        targetPlatform,
    };
}

const HOST: IHostVersions = { diode: "0.3.0", vscode: "1.127.0" };
const DEV_HOST: IHostVersions = { diode: "0.0.0-dev", vscode: "1.127.0" };
/** Nightly build: a `nightly-<sha>` version is not semver. */
const NIGHTLY_HOST: IHostVersions = { diode: "nightly-8263528d", vscode: "1.127.0" };
/** Host with a prerelease shim version, for prerelease semantics in ranges. */
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
        // A dev Diode version passes the diode channel...
        ["dev-хост пропускает diode-канал", { diode: "^99.0.0" }, DEV_HOST, true],
        // ...but not the vscode channel: the shim version is always real.
        ["dev-хост не пропускает vscode-канал", { diode: "^99.0.0", vscode: "^2.0.0" }, DEV_HOST, false],
        // Nightly (`nightly-<sha>`) behaves like dev: there is no release version.
        ["nightly-хост пропускает diode-канал", { diode: "^99.0.0" }, NIGHTLY_HOST, true],
        ["nightly-хост не пропускает vscode-канал", { vscode: "^2.0.0" }, NIGHTLY_HOST, false],
        // Full node-semver range language: we don't write proxy extensions' engines.
        ["диапазон с ||", { vscode: "^1.60.0 || ^2.0.0" }, HOST, true],
        ["x-диапазон", { vscode: "1.x" }, HOST, true],
        ["x-диапазон другого major", { vscode: "2.x" }, HOST, false],
        ["дефисный диапазон", { vscode: "1.90.0 - 1.130.0" }, HOST, true],
        ["дефисный диапазон мимо", { vscode: "1.0.0 - 1.90.0" }, HOST, false],
        // A prerelease host version doesn't match a range that didn't ask for it...
        ["prerelease-хост вне обычного диапазона", { vscode: "^1.128.0" }, PRERELEASE_HOST, false],
        // ...and matches when the range asks for it explicitly.
        ["prerelease-хост в диапазоне с prerelease", { vscode: "^1.128.0-insider" }, PRERELEASE_HOST, true],
        // A garbage range doesn't throw; it yields "incompatible".
        ["неразбираемый диапазон", { vscode: "не-диапазон" }, HOST, false],
    ] satisfies [string, IRegistryEngines, IHostVersions, boolean][])("%s", (_label, engines, host, expected) => {
        expect(isVersionCompatible(version("1.0.0", engines), host, semver)).toBe(expected);
    });
});

/** Host with a platform target: the platform-specific vsix path (charliermarsh.ruff). */
const LINUX_HOST: IHostVersions = { diode: "0.3.0", vscode: "1.127.0", targetPlatform: "linux-x64" };

describe("isVersionCompatible: targetPlatform", () => {
    it.each([
        ["universal совместима с платформенным хостом", undefined, LINUX_HOST, true],
        ["таргет совпал", "linux-x64", LINUX_HOST, true],
        ["таргет не совпал", "darwin-arm64", LINUX_HOST, false],
        // A host without a target (exotic platform) must not get a foreign native binary.
        ["платформенная запись при хосте без таргета", "linux-x64", HOST, false],
        ["universal при хосте без таргета", undefined, HOST, true],
    ] satisfies [string, string | undefined, IHostVersions, boolean][])("%s", (_label, target, host, expected) => {
        expect(isVersionCompatible(version("1.0.0", { vscode: "*" }, target), host, semver)).toBe(expected);
    });

    it("платформенное несовпадение режет запись даже с проходящими engines", () => {
        expect(isVersionCompatible(version("1.0.0", { vscode: "^1.90.0" }, "win32-x64"), LINUX_HOST, semver)).toBe(
            false,
        );
    });
});

describe("resolveCompatibleVersion", () => {
    it("выбирает наивысшую совместимую независимо от порядка в списке", () => {
        const versions = [
            version("1.0.0", { vscode: "^1.90.0" }),
            version("1.2.0", { vscode: "^1.90.0" }),
            version("1.1.0", { vscode: "^1.90.0" }),
        ];
        expect(resolveCompatibleVersion(versions, HOST, semver)?.version).toBe("1.2.0");
    });

    it("несовместимая наивысшая пропускается в пользу совместимой ниже", () => {
        const versions = [version("2.0.0", { vscode: "^99.0.0" }), version("1.2.0", { vscode: "^1.90.0" })];
        expect(resolveCompatibleVersion(versions, HOST, semver)?.version).toBe("1.2.0");
    });

    it("нет совместимых — undefined", () => {
        expect(resolveCompatibleVersion([version("1.0.0", { vscode: "^99.0.0" })], HOST, semver)).toBeUndefined();
    });

    it("пустой список — undefined", () => {
        expect(resolveCompatibleVersion([], HOST, semver)).toBeUndefined();
    });

    // Both orders: a non-semver record must neither win nor break the comparison
    // with an already chosen candidate.
    it.each([
        ["перед валидной", ["latest", "1.0.0"]],
        ["после валидной", ["1.0.0", "latest"]],
    ] satisfies [string, string[]][])(
        "запись с не-semver версией (собрана программно, мимо парсера) пропускается — %s",
        (_label, order) => {
            const versions = order.map((v) => version(v, { vscode: "*" }));
            expect(resolveCompatibleVersion(versions, HOST, semver)?.version).toBe("1.0.0");
        },
    );

    it("при равных версиях побеждает первая запись", () => {
        const first = version("1.0.0", { vscode: "*" });
        const duplicate = version("1.0.0", { vscode: "*" });
        expect(resolveCompatibleVersion([first, duplicate], HOST, semver)).toBe(first);
    });

    it("prerelease ниже релиза той же версии", () => {
        const versions = [version("1.2.0-rc.1", { vscode: "*" }), version("1.2.0", { vscode: "*" })];
        expect(resolveCompatibleVersion(versions, HOST, semver)?.version).toBe("1.2.0");
    });

    // Both permutations: the platform record must win by the "more specific wins"
    // rule, not by list order.
    it.each([
        ["universal раньше", [undefined, "linux-x64"]],
        ["платформенная раньше", ["linux-x64", undefined]],
    ] satisfies [string, (string | undefined)[]][])(
        "при равной версии платформенная запись побеждает universal — %s",
        (_label, order) => {
            const versions = order.map((target) => version("1.0.0", { vscode: "*" }, target));
            expect(resolveCompatibleVersion(versions, LINUX_HOST, semver)?.targetPlatform).toBe("linux-x64");
        },
    );

    // Both permutations: specificity must not override semver, even when the platform
    // record is compared against an already chosen higher universal one.
    it.each([
        ["платформенная раньше", ["linux-x64", undefined]],
        ["universal раньше", [undefined, "linux-x64"]],
    ] satisfies [string, (string | undefined)[]][])(
        "более высокая universal-версия побеждает платформенную ниже — %s",
        (_label, order) => {
            const [firstTarget, secondTarget] = order;
            const versions = [
                version(firstTarget === undefined ? "1.1.0" : "1.0.0", { vscode: "*" }, firstTarget),
                version(secondTarget === undefined ? "1.1.0" : "1.0.0", { vscode: "*" }, secondTarget),
            ];
            expect(resolveCompatibleVersion(versions, LINUX_HOST, semver)?.version).toBe("1.1.0");
        },
    );

    it("при равных платформенных записях одного таргета побеждает первая", () => {
        const first = version("1.0.0", { vscode: "*" }, "linux-x64");
        const duplicate = version("1.0.0", { vscode: "*" }, "linux-x64");
        expect(resolveCompatibleVersion([first, duplicate], LINUX_HOST, semver)).toBe(first);
    });

    it("платформенный набор без universal: хост берёт свой таргет, чужие не участвуют", () => {
        const versions = [
            version("1.0.0", { vscode: "*" }, "darwin-arm64"),
            version("1.0.0", { vscode: "*" }, "linux-x64"),
            version("1.0.0", { vscode: "*" }, "win32-x64"),
        ];
        expect(resolveCompatibleVersion(versions, LINUX_HOST, semver)?.targetPlatform).toBe("linux-x64");
    });

    it("хост без таргета среди платформенных записей берёт только universal", () => {
        const versions = [version("1.1.0", { vscode: "*" }, "linux-x64"), version("1.0.0", { vscode: "*" })];
        expect(resolveCompatibleVersion(versions, HOST, semver)?.version).toBe("1.0.0");
    });

    it("нет записи под таргет хоста и нет universal — undefined", () => {
        expect(
            resolveCompatibleVersion([version("1.0.0", { vscode: "*" }, "darwin-x64")], LINUX_HOST, semver),
        ).toBeUndefined();
    });
});
