import { describe, expect, it, vi } from "vitest";

import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILink } from "../../../../editor/common/languages/iLinkSource.ts";

import { openLinkAction } from "./linksActions.ts";
import { LinksService, LinksServiceDIToken } from "./linksService.ts";

const DOC = Uri.file("/work/dir/doc.md");
const range = createRange(0, 0, 0, 1);

function setup(
    options: { readonly opened?: boolean; readonly knownCommand?: boolean; readonly active?: boolean } = {},
) {
    const clicked = new Emitter<ILink>();
    const links: ILink[] = [];
    const goToPosition = vi.fn();
    let activeUri = DOC;
    const editor = {
        get uri() {
            return activeUri;
        },
        onDidClickLink: clicked.event,
        getLinksAtSelections: () => links,
        goToPosition,
    };
    const changedActive = new Emitter<unknown>();
    const openUri = vi.fn((uri: Uri) => {
        activeUri = uri;
        return Promise.resolve();
    });
    const editors = {
        getActiveEditor: () => (options.active === false ? null : editor),
        onActiveEditorChanged: changedActive.event,
        editorGroups: { activeGroup: { findPaneIndex: () => -1 }, groups: [] },
        openUri,
    };
    const jumps = { jumpAsync: (run: () => Promise<void>) => run() };
    const external = { open: vi.fn(() => Promise.resolve(options.opened ?? true)) };
    const commands = {
        has: () => options.knownCommand ?? true,
        execute: vi.fn(() => Promise.resolve()),
    };
    const show = vi.fn();
    const service = new LinksService(editors as never, jumps as never, external, commands as never, { show } as never);
    const click = async (link: ILink): Promise<void> => {
        clicked.fire(link);
        await vi.waitFor(() => undefined);
        await new Promise((resolve) => setImmediate(resolve));
    };
    const messages = (): string[] =>
        show.mock.calls.map(([notification]) => (notification as { message: string }).message);
    return { service, click, links, external, openUri, goToPosition, commands, show, messages, clicked, changedActive };
}

describe("LinksService", () => {
    it.each(["http://a.b/c", "https://a.b/c?d=e#f", "mailto:me@a.b", "HTTPS://A.B/"])(
        "%s goes to the system opener as written",
        async (url) => {
            const { click, external, openUri, messages } = setup();
            await click({ range, url });
            expect(external.open).toHaveBeenCalledWith(url);
            expect(openUri).not.toHaveBeenCalled();
            expect(messages()).toEqual([]);
        },
    );

    it("a url the opener refuses is reported as not well-formed", async () => {
        const { click, messages } = setup({ opened: false });
        await click({ range, url: "http://[bad" });
        expect(messages()).toEqual(["Failed to open this link because it is not well-formed: http://[bad"]);
    });

    it("a url without a scheme is reported as not well-formed", async () => {
        const { click, external, openUri, messages } = setup();
        await click({ range, url: "no scheme" });
        expect(messages()).toEqual(["Failed to open this link because it is not well-formed: no scheme"]);
        expect(external.open).not.toHaveBeenCalled();
        expect(openUri).not.toHaveBeenCalled();
    });

    it("the warning is a passive one", async () => {
        const { click, show } = setup();
        await click({ range });
        expect(show).toHaveBeenCalledWith({
            severity: "warn",
            message: "Failed to open this link because its target is missing.",
            modal: false,
            items: [],
        });
    });

    it("a link without a target asks the provider and opens the answer", async () => {
        const { click, external } = setup();
        await click({ range, resolve: () => Promise.resolve("https://resolved/") });
        expect(external.open).toHaveBeenCalledWith("https://resolved/");
    });

    it("a provider that gives no target: the missing-target toast", async () => {
        const { click, external, messages } = setup();
        await click({ range, resolve: () => Promise.resolve(null) });
        expect(messages()).toEqual(["Failed to open this link because its target is missing."]);
        expect(external.open).not.toHaveBeenCalled();
    });

    it("a failure on the way goes to the unexpected errors, not to the process", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((error) => errors.push(error));
        const boom = new Error("boom");
        const { click } = setup();
        await click({ range, resolve: () => Promise.reject(boom) });
        expect(errors).toEqual([boom]);
    });

    it("a file opens in the editor, with no position", async () => {
        const { click, openUri, goToPosition, external } = setup();
        await click({ range, url: "file:///other/file.txt" });
        expect(openUri.mock.calls[0][0].toString()).toBe("file:///other/file.txt");
        expect(goToPosition).not.toHaveBeenCalled();
        expect(external.open).not.toHaveBeenCalled();
    });

    it.each([
        ["file:///other/file.txt#L10", 9, 0],
        ["file:///other/file.txt#10", 9, 0],
        ["file:///other/file.txt#L10,5", 9, 4],
        ["file:///other/file.txt#10,5", 9, 4],
        ["file:///other/file.txt#L10,5-L12,1", 9, 4],
    ])("%s opens the file at its position", async (url, line, column) => {
        const { click, openUri, goToPosition } = setup();
        await click({ range, url });
        expect(openUri.mock.calls[0][0].toString()).toBe("file:///other/file.txt");
        expect(goToPosition).toHaveBeenCalledWith(line, column);
    });

    it("a fragment that is not a position stays on the uri", async () => {
        const { click, openUri, goToPosition } = setup();
        await click({ range, url: "file:///other/file.md#heading" });
        expect(openUri.mock.calls[0][0].fragment).toBe("heading");
        expect(goToPosition).not.toHaveBeenCalled();
    });

    it.each([
        ["file://./sibling.txt", "file:///work/dir/sibling.txt"],
        ["file:///./sibling.txt", "file:///work/dir/sibling.txt"],
        ["file://./sub/inner.txt", "file:///work/dir/sub/inner.txt"],
        ["file:///./sub/inner.txt", "file:///work/dir/sub/inner.txt"],
    ])("%s is relative to the document's folder", async (url, expected) => {
        const { click, openUri } = setup();
        await click({ range, url });
        expect(openUri.mock.calls[0][0].toString()).toBe(expected);
    });

    it("a relative file with a line keeps it", async () => {
        const { click, openUri, goToPosition } = setup();
        await click({ range, url: "file://./sibling.txt#L3" });
        expect(openUri.mock.calls[0][0].toString()).toBe("file:///work/dir/sibling.txt");
        expect(goToPosition).toHaveBeenCalledWith(2, 0);
    });

    it("a path merely starting with a dot is not relative", async () => {
        const { click, openUri } = setup();
        await click({ range, url: "file:///.hidden/file.txt" });
        expect(openUri.mock.calls[0][0].toString()).toBe("file:///.hidden/file.txt");
    });

    it("another scheme goes to the editor as it is", async () => {
        const { click, openUri, external } = setup();
        await click({ range, url: "untitled:./x" });
        expect(openUri.mock.calls[0][0].scheme).toBe("untitled");
        expect(external.open).not.toHaveBeenCalled();
    });

    it("command: runs the command with its arguments", async () => {
        const { click, commands, external, openUri } = setup();
        const args = encodeURIComponent(JSON.stringify(["one", 2]));
        await click({ range, url: `command:my.command?${args}` });
        expect(commands.execute).toHaveBeenCalledWith("my.command", "one", 2);
        expect(external.open).not.toHaveBeenCalled();
        expect(openUri).not.toHaveBeenCalled();
    });

    it("COMMAND: in another case is a command as well", async () => {
        const { click, commands } = setup();
        await click({ range, url: "COMMAND:my.command" });
        expect(commands.execute).toHaveBeenCalledWith("my.command");
    });

    it("command: an unknown one is an error toast", async () => {
        const { click, messages } = setup({ knownCommand: false });
        await click({ range, url: "command:nope" });
        expect(messages()).toEqual(["command 'nope' not found"]);
    });

    it("Open Link opens the link at every selection", async () => {
        const { service, links, external } = setup();
        links.push({ range, url: "https://one/" }, { range, url: "https://two/" });
        service.openLinksAtSelections();
        await new Promise((resolve) => setImmediate(resolve));
        expect(external.open.mock.calls).toEqual([["https://one/"], ["https://two/"]]);
    });

    it("Open Link without an editor does nothing", () => {
        const { service, external } = setup({ active: false });
        service.openLinksAtSelections();
        expect(external.open).not.toHaveBeenCalled();
    });

    it("the listener goes with the editor", async () => {
        const { click, external, service } = setup();
        service.dispose();
        await click({ range, url: "https://a/" });
        expect(external.open).not.toHaveBeenCalled();
    });

    it("the command is the service's, with upstream's id and title and no key", () => {
        const openLinksAtSelections = vi.fn();
        void openLinkAction.run({
            get: (id: unknown) => (id === LinksServiceDIToken ? { openLinksAtSelections } : null),
        } as never);
        expect(openLinksAtSelections).toHaveBeenCalledOnce();
        expect(openLinkAction).toMatchObject({ id: "editor.action.openLink", title: "Open Link" });
        expect(openLinkAction.keybinding).toBeUndefined();
    });
});
