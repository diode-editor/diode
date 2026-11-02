import { CancellationTokenNone } from "../vs/base/common/cancellation.ts";
import { Uri } from "../vs/base/common/uri.ts";
import type { TextEditorPane } from "../vs/workbench/browser/parts/editor/textEditorPane.ts";

import { until } from "./basedpyrightFixture.ts";
import { createExtensionTestHarness, documentVersion, type IExtensionHarness } from "./ExtensionTestHarness.ts";
import {
    createMavenProject,
    type IMavenProject,
    installJava,
    JAVA_ACTIVATION_EVENT,
    JAVA_LANGUAGE_SERVICE,
} from "./javaFixture.ts";

/** Separate from `javaFixture.ts`: the marketplace checks import that one and must not pull in the harness. */

export interface IJavaRequest {
    readonly uri: string;
    readonly languageId: string;
    readonly versionId: number;
    readonly line: number;
    readonly character: number;
}

export interface IJavaSuite {
    readonly harness: IExtensionHarness;
    readonly project: IMavenProject;
    /** The request at a position of an open source file. */
    at(name: string, line: number, character: number): IJavaRequest;
    editorOf(name: string): TextEditorPane;
    frame(): string;
    dispose(): Promise<void>;
}

export interface IJavaSuiteOptions {
    readonly sources: Readonly<Record<string, string>>;
    /** The last one is the active editor. */
    readonly open: readonly string[];
    readonly configuration?: Record<string, unknown>;
}

/** The stock redhat.java activated over a project: two JVMs, the server is not ready yet. */
export async function openJavaSuite(options: IJavaSuiteOptions): Promise<IJavaSuite> {
    const installed = await installJava();
    const project = createMavenProject(options.sources);
    const harness = await createExtensionTestHarness({
        languageService: JAVA_LANGUAGE_SERVICE,
        workspaceFolders: [project.root],
        activateEvents: [],
        extensions: [installed.registration],
        configuration: options.configuration,
    });
    for (const name of options.open) harness.group.openFile(project.sourcePath(name));
    await harness.host.activateByEvent(JAVA_ACTIVATION_EVENT);
    return {
        harness,
        project,
        at: (name, line, character) => {
            const uri = Uri.file(project.sourcePath(name)).toString();
            return { uri, languageId: "java", versionId: documentVersion(harness, uri), line, character };
        },
        editorOf: (name) => {
            const path = project.sourcePath(name);
            const editor = harness.group.getEditors().find((candidate) => candidate.uri.fsPath === path);
            if (editor === undefined) throw new Error(`${name} is not open`);
            return editor;
        },
        frame: () => {
            harness.app.render();
            return harness.app.backend.screenToString();
        },
        dispose: async () => {
            await harness.dispose();
            project.dispose();
            installed.dispose();
        },
    };
}

/**
 * A type hierarchy item comes only from the standard server, so the registrations of both servers are in.
 * The position is on the name of a type in an open file.
 */
export async function waitForStandardServer(
    suite: IJavaSuite,
    name: string,
    line: number,
    character: number,
): Promise<void> {
    await until(
        "the standard server",
        async () => {
            const provider = suite.harness.languageFeatures.typeHierarchyProvider.ordered(suite.editorOf(name)).at(0);
            if (provider === undefined) return null;
            const session = await provider.prepareTypeHierarchy(suite.at(name, line, character), CancellationTokenNone);
            return session !== null && session.items.length > 0 ? true : null;
        },
        280_000,
    );
}
