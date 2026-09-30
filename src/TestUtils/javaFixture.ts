import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import { flattenConfigDefaults } from "../vs/platform/extensions/common/configDefaults.ts";
import type { IExtensionManifest } from "../vs/platform/extensions/common/iExtensionManifest.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { fetchStockVsix } from "./stockVsix.ts";

/**
 * Общая обвязка сьютов extensionHost.javaLsp*: НАСТОЯЩИЙ сторонний vsix
 * redhat.java, установленный штатным `installVsix`, — ни строчки нашего кода
 * расширения. Расширение поднимает Eclipse JDT LS (`java -jar
 * org.eclipse.equinox.launcher`) и говорит с ним через стоковый
 * vscode-languageclient по unix-сокету (`TransportKind.pipe`).
 *
 * Vsix приезжает ИЗ МАГАЗИНА (политика — docs/TESTING.md). В vitest
 * `DIODE_VERSION` — `0.0.0-dev`, dev-канал гейт `engines.diode` не блокирует,
 * поэтому резолв отдаёт ПЛАТФОРМЕННУЮ запись со вшитым JRE: своего JDK машине
 * не нужно. Близнецы обвязки — ruffFixture.ts и basedpyrightFixture.ts (оттуда
 * же `until` и `CLIENT_CRASH_PATTERNS`).
 */

/** id записи в реестре; e2e-сьюты ставят его напрямую через `--install-extension`. */
export const JAVA_ID = "redhat.java";

export const JAVA_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".java") ? "java" : undefined),
    getLanguageDisplayName: () => undefined,
};

/**
 * Событие активации, которым расширение поднимается: `activationEvents` у
 * redhat.java — только двенадцать `workspaceContains:` и два `onCommand:`, ни
 * `*`, ни `onLanguage:java` там НЕТ. Это не наша особенность: одиночный
 * `.java`-файл без build-файла не заводит расширение и в VS Code.
 */
export const JAVA_ACTIVATION_EVENT = "workspaceContains:pom.xml";

/**
 * Проект БЕЗ зависимостей — осознанно. Classpath с внешним jar-ом тянет артефакт
 * в `~/.m2` по сети и добавляет к прогону минуты; базовому сьюту достаточно
 * импорта m2e, а classpath проверяет отдельный (и отдельно помеченный) сьют.
 */
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

/**
 * Каноническая фикстура: `greet` — цель для definition/references, `broken` —
 * ошибка типов, она же readiness-сигнал (диагностика от jdt.ls приходит только
 * после того, как проект импортирован и собран).
 */
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

/** Путь исходника внутри проекта — раскладка maven, её ждёт m2e. */
export const APP_JAVA_PATH = path.join("src", "main", "java", "demo", "App.java");

export interface IMavenProject {
    /** Корень проекта — он же папка воркспейса, её отдают харнессу. */
    readonly root: string;
    readonly appPath: string;
    dispose(): void;
}

/**
 * Раскладывает maven-проект в СВОЁМ каталоге, а не в `tmpDir` харнесса, и
 * создаётся ДО харнесса — его `workspaceFolders` принимает путь.
 *
 * Своя папка тут обязательна, и это не вкусовщина. По умолчанию харнесс держит
 * в `tmpDir` и папку воркспейса, и приватные каталоги расширения
 * (`globalStorage/…`), а jdt.ls разворачивает в `globalStorage` своё
 * eclipse-хозяйство (`-configuration`) и отказывается импортировать проект,
 * внутри которого оно лежит: «Failed to create linked resource … to the
 * invisible project», затем «Invalid project description for project», и файл
 * получает `App.java is a non-project file, only syntax errors are reported` —
 * то есть НИ ОДНОЙ семантической диагностики, молча и до самого таймаута.
 *
 * Отдельная функция, а не `harness.writeFile`, ещё и потому, что тот пишет плоско
 * и родительских каталогов не создаёт, а без `src/main/java/<пакет>/` maven
 * проект не импортирует.
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

/**
 * Устанавливает vsix в изолированный каталог и собирает регистрацию из
 * УСТАНОВЛЕННОГО манифеста той же логикой, что приложение (`main.ts`):
 * flattenConfigDefaults + курируемый дефолт `lombokSupport.enabled: false`
 * (манифестный `true` на связке jdt.ls 1.57 + современный JDK ломает
 * компиляцию насмерть и подменяет диагностики внутренней ошибкой компилятора,
 * см. curatedConfigInjection).
 */
export async function installJava(): Promise<IInstalledJava> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(JAVA_ID)).vsixPath, extensionsDir);
    const installRoot = path.join(extensionsDir, `${id}-${version}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(installRoot, "package.json"), "utf8")) as IExtensionManifest;
    /* v8 ignore start -- у стокового vsix main есть всегда; ветка достижима только на битом манифесте */
    if (manifest.main === undefined) throw new Error(`${installRoot}: в манифесте нет main`);
    /* v8 ignore stop */
    return {
        registration: {
            id,
            manifest: { name: manifest.name, publisher: manifest.publisher, version: manifest.version },
            mainPath: path.resolve(installRoot, manifest.main),
            extensionPath: installRoot,
            configDefaults: {
                ...flattenConfigDefaults(manifest.contributes?.configuration),
                "java.jdt.ls.lombokSupport.enabled": false,
            },
            activationEvents: manifest.activationEvents,
        },
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
