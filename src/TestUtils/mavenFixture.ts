import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

export const MAVEN_ID = "vscjava.vscode-maven";

/** Packaging `pom`: a tree and a goal need no compiler plugin downloads, only `mvn` itself. */
export const PARENT_POM = [
    '<?xml version="1.0"?>',
    '<project xmlns="http://maven.apache.org/POM/4.0.0">',
    "  <modelVersion>4.0.0</modelVersion>",
    "  <groupId>a</groupId>",
    "  <artifactId>b</artifactId>",
    "  <version>1.0</version>",
    "  <packaging>pom</packaging>",
    "  <modules>",
    "    <module>child</module>",
    "  </modules>",
    "</project>",
    "",
].join("\n");

export const CHILD_POM = [
    '<?xml version="1.0"?>',
    '<project xmlns="http://maven.apache.org/POM/4.0.0">',
    "  <modelVersion>4.0.0</modelVersion>",
    "  <parent>",
    "    <groupId>a</groupId>",
    "    <artifactId>b</artifactId>",
    "    <version>1.0</version>",
    "  </parent>",
    "  <artifactId>child</artifactId>",
    "  <packaging>pom</packaging>",
    "</project>",
    "",
].join("\n");

export function writeMavenProject(root: string): string {
    fs.mkdirSync(path.join(root, "child"), { recursive: true });
    const pom = path.join(root, "pom.xml");
    fs.writeFileSync(pom, PARENT_POM);
    fs.writeFileSync(path.join(root, "child", "pom.xml"), CHILD_POM);
    return pom;
}

/** Goals need Maven from the machine, like `go` for golang.go; the runners have it. */
export function mavenMissing(): string | undefined {
    const probe = spawnSync("mvn", ["-v"], { shell: process.platform === "win32", stdio: "ignore" });
    return probe.status === 0 ? undefined : "mvn not found in PATH — Maven for Java goals skipped";
}

export interface IInstalledMaven {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

export async function installMaven(): Promise<IInstalledMaven> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(MAVEN_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
