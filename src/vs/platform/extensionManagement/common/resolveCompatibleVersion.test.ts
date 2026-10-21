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
        ["engines.diode matches", { diode: "^0.3.0" }, HOST, true],
        ["engines.diode does not match", { diode: "^0.4.0" }, HOST, false],
        ["engines.vscode matches", { vscode: "^1.90.0" }, HOST, true],
        ["engines.vscode does not match", { vscode: "^2.0.0" }, HOST, false],
        ["both set and matching", { diode: "^0.3.0", vscode: "^1.90.0" }, HOST, true],
        ["both set, diode does not match", { diode: "^0.4.0", vscode: "^1.90.0" }, HOST, false],
        ["both set, vscode does not match", { diode: "^0.3.0", vscode: "^2.0.0" }, HOST, false],
        // A dev Diode version passes the diode channel...
        ["dev host skips the diode channel", { diode: "^99.0.0" }, DEV_HOST, true],
        // ...but not the vscode channel: the shim version is always real.
        ["dev host does not skip the vscode channel", { diode: "^99.0.0", vscode: "^2.0.0" }, DEV_HOST, false],
        // Nightly (`nightly-<sha>`) behaves like dev: there is no release version.
        ["nightly host skips the diode channel", { diode: "^99.0.0" }, NIGHTLY_HOST, true],
        ["nightly host does not skip the vscode channel", { vscode: "^2.0.0" }, NIGHTLY_HOST, false],
        // Full node-semver range language: we don't write proxy extensions' engines.
        ["range with ||", { vscode: "^1.60.0 || ^2.0.0" }, HOST, true],
        ["x-range", { vscode: "1.x" }, HOST, true],
        ["x-range of another major", { vscode: "2.x" }, HOST, false],
        ["hyphen range", { vscode: "1.90.0 - 1.130.0" }, HOST, true],
        ["hyphen range miss", { vscode: "1.0.0 - 1.90.0" }, HOST, false],
        // A prerelease host version doesn't match a range that didn't ask for it...
        ["prerelease host outside a regular range", { vscode: "^1.128.0" }, PRERELEASE_HOST, false],
        // ...and matches when the range asks for it explicitly.
        ["prerelease host in a range with prerelease", { vscode: "^1.128.0-insider" }, PRERELEASE_HOST, true],
        // A garbage range doesn't throw; it yields "incompatible".
        ["unparsable range", { vscode: "not-a-range" }, HOST, false],
    ] satisfies [string, IRegistryEngines, IHostVersions, boolean][])("%s", (_label, engines, host, expected) => {
        expect(isVersionCompatible(version("1.0.0", engines), host, semver)).toBe(expected);
    });
});

/** Host with a platform target: the platform-specific vsix path (charliermarsh.ruff). */
const LINUX_HOST: IHostVersions = { diode: "0.3.0", vscode: "1.127.0", targetPlatform: "linux-x64" };

describe("isVersionCompatible: targetPlatform", () => {
    it.each([
        ["universal is compatible with a platform host", undefined, LINUX_HOST, true],
        ["target matches", "linux-x64", LINUX_HOST, true],
        ["target does not match", "darwin-arm64", LINUX_HOST, false],
        // A host without a target (exotic platform) must not get a foreign native binary.
        ["platform entry with a host without a target", "linux-x64", HOST, false],
        ["universal with a host without a target", undefined, HOST, true],
    ] satisfies [string, string | undefined, IHostVersions, boolean][])("%s", (_label, target, host, expected) => {
        expect(isVersionCompatible(version("1.0.0", { vscode: "*" }, target), host, semver)).toBe(expected);
    });

    it("a platform mismatch drops the entry even with matching engines", () => {
        expect(isVersionCompatible(version("1.0.0", { vscode: "^1.90.0" }, "win32-x64"), LINUX_HOST, semver)).toBe(
            false,
        );
    });
});

describe("resolveCompatibleVersion", () => {
    it("picks the highest compatible regardless of list order", () => {
        const versions = [
            version("1.0.0", { vscode: "^1.90.0" }),
            version("1.2.0", { vscode: "^1.90.0" }),
            version("1.1.0", { vscode: "^1.90.0" }),
        ];
        expect(resolveCompatibleVersion(versions, HOST, semver)?.version).toBe("1.2.0");
    });

    it("an incompatible highest is skipped for a lower compatible one", () => {
        const versions = [version("2.0.0", { vscode: "^99.0.0" }), version("1.2.0", { vscode: "^1.90.0" })];
        expect(resolveCompatibleVersion(versions, HOST, semver)?.version).toBe("1.2.0");
    });

    it("no compatible ones returns undefined", () => {
        expect(resolveCompatibleVersion([version("1.0.0", { vscode: "^99.0.0" })], HOST, semver)).toBeUndefined();
    });

    it("an empty list returns undefined", () => {
        expect(resolveCompatibleVersion([], HOST, semver)).toBeUndefined();
    });

    // Both orders: a non-semver record must neither win nor break the comparison
    // with an already chosen candidate.
    it.each([
        ["before a valid one", ["latest", "1.0.0"]],
        ["after a valid one", ["1.0.0", "latest"]],
    ] satisfies [string, string[]][])(
        "an entry with a non-semver version (built programmatically, bypassing the parser) is skipped: %s",
        (_label, order) => {
            const versions = order.map((v) => version(v, { vscode: "*" }));
            expect(resolveCompatibleVersion(versions, HOST, semver)?.version).toBe("1.0.0");
        },
    );

    it("with equal versions the first entry wins", () => {
        const first = version("1.0.0", { vscode: "*" });
        const duplicate = version("1.0.0", { vscode: "*" });
        expect(resolveCompatibleVersion([first, duplicate], HOST, semver)).toBe(first);
    });

    it("prerelease is lower than the release of the same version", () => {
        const versions = [version("1.2.0-rc.1", { vscode: "*" }), version("1.2.0", { vscode: "*" })];
        expect(resolveCompatibleVersion(versions, HOST, semver)?.version).toBe("1.2.0");
    });

    // Both permutations: the platform record must win by the "more specific wins"
    // rule, not by list order.
    it.each([
        ["universal first", [undefined, "linux-x64"]],
        ["platform first", ["linux-x64", undefined]],
    ] satisfies [string, (string | undefined)[]][])(
        "with an equal version a platform entry beats universal: %s",
        (_label, order) => {
            const versions = order.map((target) => version("1.0.0", { vscode: "*" }, target));
            expect(resolveCompatibleVersion(versions, LINUX_HOST, semver)?.targetPlatform).toBe("linux-x64");
        },
    );

    // Both permutations: specificity must not override semver, even when the platform
    // record is compared against an already chosen higher universal one.
    it.each([
        ["platform first", ["linux-x64", undefined]],
        ["universal first", [undefined, "linux-x64"]],
    ] satisfies [string, (string | undefined)[]][])(
        "a higher universal version beats a lower platform one: %s",
        (_label, order) => {
            const [firstTarget, secondTarget] = order;
            const versions = [
                version(firstTarget === undefined ? "1.1.0" : "1.0.0", { vscode: "*" }, firstTarget),
                version(secondTarget === undefined ? "1.1.0" : "1.0.0", { vscode: "*" }, secondTarget),
            ];
            expect(resolveCompatibleVersion(versions, LINUX_HOST, semver)?.version).toBe("1.1.0");
        },
    );

    it("with equal platform entries for one target the first wins", () => {
        const first = version("1.0.0", { vscode: "*" }, "linux-x64");
        const duplicate = version("1.0.0", { vscode: "*" }, "linux-x64");
        expect(resolveCompatibleVersion([first, duplicate], LINUX_HOST, semver)).toBe(first);
    });

    it("a platform set without universal: the host takes its target, others are ignored", () => {
        const versions = [
            version("1.0.0", { vscode: "*" }, "darwin-arm64"),
            version("1.0.0", { vscode: "*" }, "linux-x64"),
            version("1.0.0", { vscode: "*" }, "win32-x64"),
        ];
        expect(resolveCompatibleVersion(versions, LINUX_HOST, semver)?.targetPlatform).toBe("linux-x64");
    });

    it("a host without a target takes only universal among platform entries", () => {
        const versions = [version("1.1.0", { vscode: "*" }, "linux-x64"), version("1.0.0", { vscode: "*" })];
        expect(resolveCompatibleVersion(versions, HOST, semver)?.version).toBe("1.0.0");
    });

    it("no entry for the host target and no universal returns undefined", () => {
        expect(
            resolveCompatibleVersion([version("1.0.0", { vscode: "*" }, "darwin-x64")], LINUX_HOST, semver),
        ).toBeUndefined();
    });
});
