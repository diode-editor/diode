import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHILD_POM, mavenMissing, PARENT_POM, writeMavenProject } from "./mavenFixture.ts";

// The network part (`installMaven`) is covered by the extensionHost.javaLsp.maven* suites.

const SKIP_REASON = "mvn not found in PATH — Maven for Java goals skipped";

describe("mavenFixture — project", () => {
    let root = "";

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-maven-project-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("lays out the parent pom and the child module it lists", () => {
        const pom = writeMavenProject(root);
        expect(pom).toBe(path.join(root, "pom.xml"));
        expect(fs.readFileSync(pom, "utf-8")).toBe(PARENT_POM);
        expect(PARENT_POM).toContain("<module>child</module>");
        expect(fs.readFileSync(path.join(root, "child", "pom.xml"), "utf-8")).toBe(CHILD_POM);
    });
});

describe.skipIf(process.platform === "win32")("mavenFixture — mvn detection", () => {
    let root = "";

    /** A `mvn` that exits with the given code; its own directory, so PATH holds nothing else. */
    const fakeMvn = (code: number): string => {
        const bin = fs.mkdtempSync(path.join(root, "mvn-"));
        const script = path.join(bin, "mvn");
        fs.writeFileSync(script, `#!/bin/sh\nexit ${String(code)}\n`);
        fs.chmodSync(script, 0o755);
        return bin;
    };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-mvn-detect-"));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("an `mvn` on PATH that answers `-v` counts", () => {
        expect(mavenMissing({ PATH: fakeMvn(0) }, "linux")).toBeUndefined();
    });

    it("no `mvn` on PATH, or one that fails, is the skip reason", () => {
        expect(mavenMissing({ PATH: root }, "linux")).toBe(SKIP_REASON);
        expect(mavenMissing({ PATH: fakeMvn(1) }, "linux")).toBe(SKIP_REASON);
    });

    it("without arguments it probes this process's PATH", () => {
        vi.stubEnv("PATH", fakeMvn(0));
        expect(mavenMissing()).toBeUndefined();
    });
});
