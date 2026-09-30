import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { APP_JAVA_PATH, createMavenProject, type IMavenProject, JAVA_LANGUAGE_SERVICE } from "./javaFixture.ts";

// Обвязка java-сьютов сама по себе: её сетевую часть (`installJava`) закрывают
// сьюты extensionHost.javaLsp*, а здесь — то, что от сети не зависит.

describe("javaFixture — языковой сервис", () => {
    it(".java получает язык java, прочее — undefined", () => {
        expect(JAVA_LANGUAGE_SERVICE.getLanguageIdForResource("/tmp/App.java")).toBe("java");
        // Отрицательная ветка важна: сервис отдаёт язык ВСЕМУ, что откроет
        // харнесс, и пометь он `java` на pom.xml — расширение получило бы
        // didOpen на xml-файле.
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
            // Два вызова не должны делить корень: иначе параллельные сьюты
            // перетирали бы друг другу проект.
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
