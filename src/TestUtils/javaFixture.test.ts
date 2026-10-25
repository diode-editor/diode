import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { APP_JAVA_PATH, createMavenProject, hasJdk, type IMavenProject, JAVA_LANGUAGE_SERVICE } from "./javaFixture.ts";

// The network part (`installJava`) is covered by the extensionHost.javaLsp* suites.

describe("javaFixture — language service", () => {
    it(".java gets the java language, anything else undefined", () => {
        expect(JAVA_LANGUAGE_SERVICE.getLanguageIdForResource("/tmp/App.java")).toBe("java");
        // If the service tagged pom.xml as `java`, the extension would get didOpen for an xml file.
        expect(JAVA_LANGUAGE_SERVICE.getLanguageIdForResource("/tmp/pom.xml")).toBeUndefined();
    });

    it("the fixture provides no language display name", () => {
        expect(JAVA_LANGUAGE_SERVICE.getLanguageDisplayName("java")).toBeUndefined();
    });
});

describe("javaFixture — JDK detection", () => {
    it("JAVA_HOME or JDK_HOME counts as a JDK", () => {
        expect(hasJdk({ JAVA_HOME: "/opt/jdk", PATH: "" }, "linux")).toBe(true);
        expect(hasJdk({ JDK_HOME: "/opt/jdk", PATH: "" }, "linux")).toBe(true);
    });

    it("an empty JAVA_HOME and no javac on PATH is no JDK", () => {
        expect(hasJdk({ JAVA_HOME: "", PATH: os.tmpdir() }, "linux")).toBe(false);
        expect(hasJdk({}, "linux")).toBe(false);
    });

    it("javac on PATH counts, javac.exe only on windows", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-jdk-"));
        try {
            fs.writeFileSync(path.join(dir, "javac"), "");
            expect(hasJdk({ PATH: `${path.delimiter}${dir}` }, "linux")).toBe(true);
            expect(hasJdk({ PATH: dir }, "win32")).toBe(false);
            fs.writeFileSync(path.join(dir, "javac.exe"), "");
            expect(hasJdk({ PATH: dir }, "win32")).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("javaFixture — maven project", () => {
    let project: IMavenProject | undefined;

    afterEach(() => {
        project?.dispose();
        project = undefined;
    });

    it("lays out pom.xml and the source in its own directory", () => {
        project = createMavenProject();
        expect(fs.existsSync(path.join(project.root, "pom.xml"))).toBe(true);
        expect(project.appPath).toBe(path.join(project.root, APP_JAVA_PATH));
        expect(fs.readFileSync(project.appPath, "utf-8")).toContain("int broken = message;");
    });

    it("the project directory is its OWN, not shared with anything else", () => {
        project = createMavenProject();
        const other = createMavenProject();
        try {
            expect(other.root).not.toBe(project.root);
        } finally {
            other.dispose();
        }
    });

    it("dispose removes the whole directory", () => {
        const disposable = createMavenProject();
        const root = disposable.root;
        disposable.dispose();
        expect(fs.existsSync(root)).toBe(false);
    });
});
