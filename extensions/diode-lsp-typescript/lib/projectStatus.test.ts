import { describe, expect, it, vi } from "vitest";

import { inferredProjectConfigText } from "./projectConfig.ts";
import {
    CREATE_OR_OPEN_CONFIG_COMMAND,
    type IProjectStatusEditor,
    type IProjectStatusHost,
    type IProjectStatusItem,
    JAVASCRIPT_GO_TO_PROJECT_CONFIG_COMMAND,
    OPEN_CONFIG_COMMAND,
    ProjectStatus,
    TYPESCRIPT_GO_TO_PROJECT_CONFIG_COMMAND,
} from "./projectStatus.ts";

const INFERRED = "/dev/null/inferredProject1*";
const JS_DOCS = "https://go.microsoft.com/fwlink/?linkid=759670";
const TS_DOCS = "https://go.microsoft.com/fwlink/?linkid=841896";

function editor(fsPath: string, languageId: string, scheme = "file"): IProjectStatusEditor {
    return { uri: `${scheme}://${fsPath}`, scheme, fsPath, languageId };
}

const MAIN_JS = editor("/proj/src/main.js", "javascript");
const APP_TS = editor("/proj/src/app.ts", "typescript");

interface IFakeItem extends IProjectStatusItem {
    disposed: boolean;
}

function makeHost(overrides: Partial<IProjectStatusHost> = {}) {
    const items: IFakeItem[] = [];
    const host = {
        createItem: vi.fn((): IProjectStatusItem => {
            const item: IFakeItem = {
                text: "",
                detail: "stale",
                busy: false,
                command: undefined,
                disposed: false,
                dispose: () => {
                    item.disposed = true;
                },
            };
            items.push(item);
            return item;
        }),
        projectInfo: vi.fn<IProjectStatusHost["projectInfo"]>(
            overrides.projectInfo ?? (() => Promise.resolve(INFERRED)),
        ),
        workspaceFolders: vi.fn<IProjectStatusHost["workspaceFolders"]>(
            overrides.workspaceFolders ?? (() => ["/proj"]),
        ),
        asRelativePath: vi.fn((filePath: string) => filePath.replace("/proj/", "")),
        fileExists: vi.fn<IProjectStatusHost["fileExists"]>(overrides.fileExists ?? (() => Promise.resolve(false))),
        createFile: vi.fn<IProjectStatusHost["createFile"]>(overrides.createFile ?? (() => Promise.resolve(true))),
        openFile: vi.fn((_filePath: string) => Promise.resolve()),
        showInformationMessage: vi.fn<IProjectStatusHost["showInformationMessage"]>(
            overrides.showInformationMessage ?? (() => Promise.resolve(undefined)),
        ),
        showWarningMessage: vi.fn((_message: string) => undefined),
    };
    const status = new ProjectStatus(host);
    /** The one live item; fails the test if there are several or none. */
    const item = (): IFakeItem => {
        const live = items.filter((i) => !i.disposed);
        expect(live).toHaveLength(1);
        return live[0];
    };
    const live = (): IFakeItem[] => items.filter((i) => !i.disposed);
    return { host, status, items, item, live };
}

function view(item: IProjectStatusItem) {
    const { text, detail, busy, command } = item;
    return { text, detail, busy, command };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

async function ready(fake: ReturnType<typeof makeHost>, active: IProjectStatusEditor | undefined): Promise<void> {
    fake.status.setReady();
    await fake.status.update(active);
}

describe("diode-lsp-typescript — JS/TS project status", () => {
    it("a .js file in an inferred project shows No jsconfig with Configure JSConfig", async () => {
        const fake = makeHost();
        await ready(fake, MAIN_JS);

        expect(fake.host.projectInfo).toHaveBeenLastCalledWith(MAIN_JS.uri);
        expect(view(fake.item())).toEqual({
            text: "No jsconfig",
            detail: undefined,
            busy: false,
            command: {
                command: CREATE_OR_OPEN_CONFIG_COMMAND,
                title: "Configure JSConfig",
                arguments: ["/proj", "javascript"],
            },
        });
    });

    it("a .ts file in an inferred project shows No tsconfig with Configure TSConfig", async () => {
        const fake = makeHost();
        await ready(fake, APP_TS);

        expect(view(fake.item())).toMatchObject({
            text: "No tsconfig",
            command: { title: "Configure TSConfig", arguments: ["/proj", "typescript"] },
        });
    });

    it("a file with a config shows its relative path and Open Config File", async () => {
        const fake = makeHost({ projectInfo: () => Promise.resolve("/proj/tsconfig.json") });
        await ready(fake, MAIN_JS);

        expect(fake.host.asRelativePath).toHaveBeenCalledWith("/proj/tsconfig.json");
        expect(view(fake.item())).toEqual({
            text: "tsconfig.json",
            detail: undefined,
            busy: false,
            command: { command: OPEN_CONFIG_COMMAND, title: "Open Config File", arguments: ["/proj", "javascript"] },
        });
    });

    it("before the server is ready the item is Loading, busy, without a command, and asks nothing", async () => {
        const fake = makeHost();
        await fake.status.update(MAIN_JS);

        expect(view(fake.item())).toEqual({
            text: "Loading IntelliSense status",
            detail: undefined,
            busy: true,
            command: undefined,
        });
        expect(fake.host.projectInfo).not.toHaveBeenCalled();
    });

    it("the server becoming ready resolves the editor that was waiting", async () => {
        const fake = makeHost();
        await fake.status.update(MAIN_JS);
        fake.status.setReady();
        await vi.waitFor(() => {
            expect(fake.item().text).toBe("No jsconfig");
        });
        expect(fake.host.projectInfo).toHaveBeenCalledExactlyOnceWith(MAIN_JS.uri);
        expect(fake.host.createItem).toHaveBeenCalledOnce();
    });

    it("while projectInfo is in flight the item is Loading again, clearing the previous command", async () => {
        const answer = deferred<string | undefined>();
        const fake = makeHost();
        await ready(fake, MAIN_JS);
        fake.host.projectInfo.mockReturnValueOnce(answer.promise);

        const updating = fake.status.update(APP_TS);
        expect(view(fake.item())).toEqual({
            text: "Loading IntelliSense status",
            detail: undefined,
            busy: true,
            command: undefined,
        });
        answer.resolve("/proj/tsconfig.json");
        await updating;
        expect(fake.item().text).toBe("tsconfig.json");
    });

    it("a stale answer for the previous editor is dropped", async () => {
        const slow = deferred<string | undefined>();
        const fake = makeHost();
        fake.status.setReady();
        fake.host.projectInfo.mockReturnValueOnce(slow.promise).mockResolvedValueOnce("/proj/tsconfig.json");

        const first = fake.status.update(MAIN_JS);
        await fake.status.update(APP_TS);
        slow.resolve(INFERRED);
        await first;

        expect(view(fake.item())).toMatchObject({ text: "tsconfig.json", busy: false });
    });

    it("a stale answer does not bring back an item removed for a non-JS editor", async () => {
        const slow = deferred<string | undefined>();
        const fake = makeHost();
        fake.status.setReady();
        fake.host.projectInfo.mockReturnValueOnce(slow.promise);

        const first = fake.status.update(MAIN_JS);
        await fake.status.update(editor("/proj/jsconfig.json", "jsonc"));
        slow.resolve(INFERRED);
        await first;

        expect(fake.live()).toEqual([]);
    });

    it.each([
        ["no editor", undefined],
        ["a JSON editor", editor("/proj/jsconfig.json", "jsonc")],
        ["an untitled JS buffer", editor("Untitled-1", "javascript", "untitled")],
    ])("%s removes the item", async (_what, active) => {
        const fake = makeHost();
        await ready(fake, MAIN_JS);
        expect(fake.live()).toHaveLength(1);

        await fake.status.update(active);
        expect(fake.live()).toEqual([]);
        expect(fake.host.projectInfo).toHaveBeenCalledOnce();
    });

    it("an item comes back after removal, as a new one", async () => {
        const fake = makeHost();
        await ready(fake, MAIN_JS);
        await fake.status.update(undefined);
        await fake.status.update(APP_TS);

        expect(fake.items).toHaveLength(2);
        expect(fake.item().text).toBe("No tsconfig");
    });

    it("the same item is reused from editor to editor", async () => {
        const fake = makeHost();
        await ready(fake, MAIN_JS);
        await fake.status.update(APP_TS);

        expect(fake.host.createItem).toHaveBeenCalledOnce();
    });

    it("projectInfo without an answer removes the item instead of leaving it loading", async () => {
        const fake = makeHost({ projectInfo: () => Promise.resolve(undefined) });
        await ready(fake, MAIN_JS);

        expect(fake.live()).toEqual([]);
    });

    it("a server that did not start leaves no item and does not show one later", async () => {
        const fake = makeHost();
        await fake.status.update(MAIN_JS);
        fake.status.setFailed();
        expect(fake.live()).toEqual([]);

        await fake.status.update(APP_TS);
        expect(fake.live()).toEqual([]);
    });

    it("a file outside the open folders shows No jsconfig with the reason and no command", async () => {
        const fake = makeHost();
        await ready(fake, editor("/elsewhere/a.js", "javascript"));

        expect(view(fake.item())).toEqual({
            text: "No jsconfig",
            detail: "File is not part opened folders",
            busy: false,
            command: undefined,
        });
    });

    it("a single file without any folder says No opened folders, even when it has a config", async () => {
        const fake = makeHost({
            workspaceFolders: () => [],
            projectInfo: () => Promise.resolve("/elsewhere/tsconfig.json"),
        });
        await ready(fake, editor("/elsewhere/a.ts", "typescript"));

        expect(view(fake.item())).toEqual({
            text: "No tsconfig",
            detail: "No opened folders",
            busy: false,
            command: undefined,
        });
    });

    it("refresh re-asks for the same editor without a Loading flash and shows the new config", async () => {
        const fake = makeHost();
        await ready(fake, MAIN_JS);
        const item = fake.item();
        const texts: string[] = [];
        fake.host.projectInfo.mockImplementationOnce(() => {
            texts.push(item.text);
            return Promise.resolve("/proj/jsconfig.json");
        });

        await fake.status.refresh();
        expect(texts).toEqual(["No jsconfig"]);
        expect(fake.host.projectInfo).toHaveBeenLastCalledWith(MAIN_JS.uri);
        expect(view(fake.item())).toMatchObject({ text: "jsconfig.json", command: { title: "Open Config File" } });
        expect(fake.item()).toBe(item);
    });

    it("refresh without an answer keeps what the item showed", async () => {
        const fake = makeHost();
        await ready(fake, MAIN_JS);
        fake.host.projectInfo.mockResolvedValueOnce(undefined);

        await fake.status.refresh();
        expect(fake.item().text).toBe("No jsconfig");
    });

    it("a refresh answer that arrives after an editor switch is dropped", async () => {
        const slow = deferred<string | undefined>();
        const fake = makeHost();
        await ready(fake, MAIN_JS);
        fake.host.projectInfo.mockReturnValueOnce(slow.promise).mockResolvedValueOnce("/proj/tsconfig.json");

        const refreshing = fake.status.refresh();
        await fake.status.update(APP_TS);
        slow.resolve("/proj/jsconfig.json");
        await refreshing;

        expect(fake.item().text).toBe("tsconfig.json");
    });

    it("refresh while a request is in flight asks again, the older answer is dropped", async () => {
        const slow = deferred<string | undefined>();
        const fake = makeHost();
        fake.status.setReady();
        fake.host.projectInfo.mockReturnValueOnce(slow.promise).mockResolvedValueOnce("/proj/jsconfig.json");

        const first = fake.status.update(MAIN_JS);
        await fake.status.refresh();
        slow.resolve(INFERRED);
        await first;

        expect(fake.host.projectInfo).toHaveBeenCalledTimes(2);
        expect(fake.item().text).toBe("jsconfig.json");
    });

    it("refresh before the server is ready, or with nothing shown, asks nothing", async () => {
        const fake = makeHost();
        await fake.status.update(MAIN_JS);
        await fake.status.refresh();
        expect(fake.item().text).toBe("Loading IntelliSense status");

        fake.status.setFailed();
        await fake.status.refresh();
        expect(fake.host.projectInfo).not.toHaveBeenCalled();
        expect(fake.live()).toEqual([]);
    });

    it("dispose removes the item", async () => {
        const fake = makeHost();
        await ready(fake, MAIN_JS);
        fake.status.dispose();
        expect(fake.live()).toEqual([]);
    });
});

describe("diode-lsp-typescript — Configure JSConfig", () => {
    it("creates the config with the template in the workspace folder and opens it", async () => {
        const fake = makeHost();
        await fake.status.commands()[CREATE_OR_OPEN_CONFIG_COMMAND]("/proj", "javascript");

        expect(fake.host.createFile).toHaveBeenCalledExactlyOnceWith(
            "/proj/jsconfig.json",
            inferredProjectConfigText("javascript"),
        );
        expect(fake.host.openFile).toHaveBeenCalledExactlyOnceWith("/proj/jsconfig.json");
    });

    it("Configure TSConfig writes tsconfig.json with the TypeScript template", async () => {
        const fake = makeHost();
        await fake.status.commands()[CREATE_OR_OPEN_CONFIG_COMMAND]("/proj", "typescript");

        expect(fake.host.createFile).toHaveBeenCalledExactlyOnceWith(
            "/proj/tsconfig.json",
            inferredProjectConfigText("typescript"),
        );
    });

    it("an existing config is opened, never overwritten", async () => {
        const fake = makeHost({ fileExists: () => Promise.resolve(true) });
        await fake.status.commands()[CREATE_OR_OPEN_CONFIG_COMMAND]("/proj", "javascript");

        expect(fake.host.createFile).not.toHaveBeenCalled();
        expect(fake.host.openFile).toHaveBeenCalledExactlyOnceWith("/proj/jsconfig.json");
    });

    it("a rejected edit opens nothing", async () => {
        const fake = makeHost({ createFile: () => Promise.resolve(false) });
        await fake.status.commands()[CREATE_OR_OPEN_CONFIG_COMMAND]("/proj", "javascript");

        expect(fake.host.openFile).not.toHaveBeenCalled();
    });
});

describe("diode-lsp-typescript — Open Config File", () => {
    it("opens the config of the resolved project", async () => {
        const fake = makeHost({ projectInfo: () => Promise.resolve("/proj/jsconfig.json") });
        await ready(fake, MAIN_JS);
        await fake.status.commands()[OPEN_CONFIG_COMMAND]("/proj", "javascript");

        expect(fake.host.openFile).toHaveBeenCalledExactlyOnceWith("/proj/jsconfig.json");
        expect(fake.host.showInformationMessage).not.toHaveBeenCalled();
    });

    it("while the project is pending it asks projectInfo for the file again", async () => {
        const fake = makeHost();
        await fake.status.update(MAIN_JS);
        fake.host.projectInfo.mockResolvedValueOnce("/proj/jsconfig.json");
        await fake.status.commands()[OPEN_CONFIG_COMMAND]("/proj", "javascript");

        expect(fake.host.projectInfo).toHaveBeenCalledExactlyOnceWith(MAIN_JS.uri);
        expect(fake.host.openFile).toHaveBeenCalledExactlyOnceWith("/proj/jsconfig.json");
    });

    it("without a JS/TS editor it does nothing", async () => {
        const fake = makeHost();
        await fake.status.commands()[OPEN_CONFIG_COMMAND]("/proj", "javascript");

        expect(fake.host.projectInfo).not.toHaveBeenCalled();
        expect(fake.host.openFile).not.toHaveBeenCalled();
    });
});

describe("diode-lsp-typescript — Go to Project Configuration", () => {
    it("opens the config of the active file's project", async () => {
        const fake = makeHost({ projectInfo: () => Promise.resolve("/proj/tsconfig.json") });
        await ready(fake, APP_TS);
        await fake.status.commands()[TYPESCRIPT_GO_TO_PROJECT_CONFIG_COMMAND]();

        expect(fake.host.openFile).toHaveBeenCalledExactlyOnceWith("/proj/tsconfig.json");
    });

    it("in an inferred JS project it offers to configure jsconfig.json, and the button creates it", async () => {
        const fake = makeHost({ showInformationMessage: vi.fn(() => Promise.resolve("Configure jsconfig.json")) });
        await ready(fake, MAIN_JS);
        await fake.status.commands()[JAVASCRIPT_GO_TO_PROJECT_CONFIG_COMMAND]();

        expect(fake.host.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            `File is not part of a JavaScript project. View the [jsconfig.json documentation](${JS_DOCS}) to learn more.`,
            "Configure jsconfig.json",
        );
        expect(fake.host.createFile).toHaveBeenCalledExactlyOnceWith(
            "/proj/jsconfig.json",
            inferredProjectConfigText("javascript"),
        );
        expect(fake.host.openFile).toHaveBeenCalledExactlyOnceWith("/proj/jsconfig.json");
    });

    it("in an inferred TS project it offers tsconfig.json; dismissing the message creates nothing", async () => {
        const fake = makeHost();
        await ready(fake, APP_TS);
        await fake.status.commands()[TYPESCRIPT_GO_TO_PROJECT_CONFIG_COMMAND]();

        expect(fake.host.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            `File is not part of a TypeScript project. View the [tsconfig.json documentation](${TS_DOCS}) to learn more.`,
            "Configure tsconfig.json",
        );
        expect(fake.host.createFile).not.toHaveBeenCalled();
        expect(fake.host.openFile).not.toHaveBeenCalled();
    });

    it("the project type comes from the command, not from the editor", async () => {
        const fake = makeHost({ showInformationMessage: vi.fn(() => Promise.resolve("Configure tsconfig.json")) });
        await ready(fake, MAIN_JS);
        await fake.status.commands()[TYPESCRIPT_GO_TO_PROJECT_CONFIG_COMMAND]();

        expect(fake.host.createFile).toHaveBeenCalledWith("/proj/tsconfig.json", expect.any(String));
    });

    it("without an open folder it asks to open one and does not ask the server", async () => {
        const fake = makeHost({ workspaceFolders: () => [] });
        await ready(fake, MAIN_JS);
        fake.host.projectInfo.mockClear();
        await fake.status.commands()[JAVASCRIPT_GO_TO_PROJECT_CONFIG_COMMAND]();

        expect(fake.host.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            "Please open a folder in Diode to use a TypeScript or JavaScript project",
        );
        expect(fake.host.projectInfo).not.toHaveBeenCalled();
    });

    it("without an answer from the server it warns that the project is unknown", async () => {
        const fake = makeHost();
        await ready(fake, MAIN_JS);
        fake.host.projectInfo.mockResolvedValueOnce(undefined);
        await fake.status.commands()[JAVASCRIPT_GO_TO_PROJECT_CONFIG_COMMAND]();

        expect(fake.host.showWarningMessage).toHaveBeenCalledExactlyOnceWith(
            "Could not determine TypeScript or JavaScript project",
        );
        expect(fake.host.showInformationMessage).not.toHaveBeenCalled();
    });

    it("with a server that did not start it warns without asking it", async () => {
        const fake = makeHost();
        await fake.status.update(MAIN_JS);
        fake.status.setFailed();
        await fake.status.commands()[JAVASCRIPT_GO_TO_PROJECT_CONFIG_COMMAND]();

        expect(fake.host.projectInfo).not.toHaveBeenCalled();
        expect(fake.host.showWarningMessage).toHaveBeenCalledExactlyOnceWith(
            "Could not determine TypeScript or JavaScript project",
        );
    });

    it.each([
        ["no editor", undefined],
        ["a JSON editor", editor("/proj/jsconfig.json", "jsonc")],
    ])("with %s it does nothing", async (_what, active) => {
        const fake = makeHost();
        await ready(fake, active);
        await fake.status.commands()[JAVASCRIPT_GO_TO_PROJECT_CONFIG_COMMAND]();

        expect(fake.host.projectInfo).not.toHaveBeenCalled();
        expect(fake.host.showInformationMessage).not.toHaveBeenCalled();
        expect(fake.host.showWarningMessage).not.toHaveBeenCalled();
    });
});
