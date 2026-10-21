import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

/**
 * The stock redhat.java vsix from the marketplace. Under vitest `DIODE_VERSION` is `0.0.0-dev`,
 * the `engines.diode` gate does not block, and resolution returns the platform entry with an
 * embedded JRE: the machine needs no JDK of its own.
 */

export const JAVA_ID = "redhat.java";

export const JAVA_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".java") ? "java" : undefined),
    getLanguageDisplayName: () => undefined,
};

/**
 * redhat.java has no `onLanguage:java` — only `workspaceContains:`; a lone `.java`
 * without a build file does not start the extension in VS Code either.
 */
export const JAVA_ACTIVATION_EVENT = "workspaceContains:pom.xml";

/** No dependencies: an external jar downloads into `~/.m2` and adds minutes; a separate suite covers classpath. */
export const POM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>diode.test</groupId>
  <artifactId>java-lsp</artifactId>
  <version>1.0</version>
  <properties>
    <maven.compiler.source>21</maven.compiler.source>
    <maven.compiler.target>21</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
</project>
`;

/** `broken` is a type error and the readiness signal: jdt.ls diagnostics arrive only after import and build. */
export const APP_JAVA = `package demo;

public class App {
    static String greet(String who) {
        return "hello, " + who;
    }

    public static void main(String[] args) {
        String message = greet("world");
        int broken = message;
        System.out.println(broken);
    }
}
`;

export const APP_JAVA_PATH = path.join("src", "main", "java", "demo", "App.java");

export interface IMavenProject {
    readonly root: string;
    readonly appPath: string;
    dispose(): void;
}

/**
 * A dedicated directory, not the harness `tmpDir`: `globalStorage` lives there, where jdt.ls
 * puts its eclipse configuration, and jdt.ls won't import a project containing it —
 * "App.java is a non-project file", and no semantic diagnostics until the timeout.
 */
export function createMavenProject(): IMavenProject {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-java-proj-"));
    const appPath = path.join(root, APP_JAVA_PATH);
    fs.mkdirSync(path.dirname(appPath), { recursive: true });
    fs.writeFileSync(path.join(root, "pom.xml"), POM_XML, "utf-8");
    fs.writeFileSync(appPath, APP_JAVA, "utf-8");
    return {
        root,
        appPath,
        dispose: (): void => {
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

export interface IInstalledJava {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

export async function installJava(): Promise<IInstalledJava> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(JAVA_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
