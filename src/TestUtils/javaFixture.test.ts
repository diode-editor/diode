import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { APP_JAVA_PATH, createMavenProject, type IMavenProject, JAVA_LANGUAGE_SERVICE } from "./javaFixture.ts";

// The network part (`installJava`) is covered by the extensionHost.javaLsp* suites.

describe("javaFixture — языковой сервис", () => {
    it(".java получает язык java, прочее — undefined", () => {
        expect(JAVA_LANGUAGE_SERVICE.getLanguageIdForResource("/tmp/App.java")).toBe("java");
        // If the service tagged pom.xml as `java`, the extension would get didOpen for an xml file.
        expect(JAVA_LANGUAGE_SERVICE.getLanguageIdForResource("/tmp/pom.xml")).toBeUndefined();
    });

    it("отображаемого имени языка обвязка не даёт", () => {
        expect(JAVA_LANGUAGE_SERVICE.getLanguageDisplayName("java")).toBeUndefined();
    });
});

describe("javaFixture — maven-проект", () => {
    let project: IMavenProject | undefined;

    afterEach(() => {
        project?.dispose();
        project = undefined;
    });

    it("раскладывает pom.xml и исходник в своём каталоге", () => {
        project = createMavenProject();
        expect(fs.existsSync(path.join(project.root, "pom.xml"))).toBe(true);
        expect(project.appPath).toBe(path.join(project.root, APP_JAVA_PATH));
        expect(fs.readFileSync(project.appPath, "utf-8")).toContain("int broken = message;");
    });

    it("каталог проекта СВОЙ, а не общий с чем-то ещё", () => {
        project = createMavenProject();
        const other = createMavenProject();
        try {
            expect(other.root).not.toBe(project.root);
        } finally {
            other.dispose();
        }
    });

    it("dispose убирает каталог целиком", () => {
        const disposable = createMavenProject();
        const root = disposable.root;
        disposable.dispose();
        expect(fs.existsSync(root)).toBe(false);
    });
});
