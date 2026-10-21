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
 * Стоковый vsix redhat.java из магазина. В vitest `DIODE_VERSION` — `0.0.0-dev`,
 * гейт `engines.diode` не блокирует, и резолв отдаёт платформенную запись со
 * вшитым JRE: своего JDK машине не нужно.
 */

export const JAVA_ID = "redhat.java";

export const JAVA_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".java") ? "java" : undefined),
    getLanguageDisplayName: () => undefined,
};

/**
 * `onLanguage:java` у redhat.java нет — только `workspaceContains:`; одиночный
 * `.java` без build-файла не заводит расширение и в VS Code.
 */
export const JAVA_ACTIVATION_EVENT = "workspaceContains:pom.xml";

/** Без зависимостей: внешний jar тянется в `~/.m2` по сети и добавляет минуты; classpath проверяет отдельный сьют. */
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

/** `broken` — ошибка типов и заодно сигнал готовности: диагностика jdt.ls приходит только после импорта и сборки. */
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
 * Свой каталог, а не `tmpDir` харнесса: там же лежит `globalStorage`, куда jdt.ls
 * кладёт eclipse-конфигурацию, и проект, содержащий её, он не импортирует —
 * «App.java is a non-project file», ни одной семантической диагностики до таймаута.
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
