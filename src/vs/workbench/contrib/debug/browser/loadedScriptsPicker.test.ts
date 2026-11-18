// Debug: Open Loaded Script...: which sessions' sources are listed, the folder of a file and of a `debug:` source, and
// what the picked row does.

import { describe, expect, it, vi } from "vitest";

import { mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import type { IDebugService, IDebugSession } from "../common/debug.ts";
import type { Source } from "../common/debugSource.ts";

import { type ILoadedScriptsPickerServices, showLoadedScriptMenu } from "./loadedScriptsPicker.ts";

function loaded(uri: Uri, available = true): Source {
    return { uri, available } as Source;
}

function session(name: string, sources: Source[], supportsLoadedSourcesRequest = true): IDebugSession {
    return mockSession({
        name,
        capabilities: { supportsLoadedSourcesRequest },
        getLoadedSources: () => Promise.resolve(sources),
    });
}

function setup(active: IDebugSession[], inactive: IDebugSession[] = []) {
    const getSessions = (includeInactive?: boolean) => (includeInactive ? [...active, ...inactive] : active);
    const services = {
        debugService: { getModel: () => ({ getSessions }) } as unknown as IDebugService,
        quickInput: { quickPick: vi.fn<(opts: { items: QuickPickItem[] }) => Promise<QuickPickItem | undefined>>() },
        sources: {
            // Relative to the workspace `/w`; any other uri whole.
            uriLabel: (uri: Uri) => uri.toString().replace(/^file:\/\/\/w\/?/u, ""),
            openSource: vi.fn((_uri: Uri) => Promise.resolve()),
        },
    } satisfies ILoadedScriptsPickerServices;
    services.quickInput.quickPick.mockResolvedValue(undefined);
    return services;
}

function items(services: ReturnType<typeof setup>): QuickPickItem[] {
    return services.quickInput.quickPick.mock.calls[0][0].items;
}

describe("Debug: Open Loaded Script...", () => {
    it("lists the active sessions that have loadedSources: a file's folder by its label, a debug: source's path", async () => {
        const services = setup(
            [
                session("app", [
                    loaded(Uri.file("/w/src/a.ts")),
                    loaded(Uri.file("/w/b.ts")),
                    loaded(Uri.from({ scheme: "debug", path: "/lib/futex.S", query: "session=s&ref=7" })),
                ]),
                session("no sources", [loaded(Uri.file("/w/never.ts"))], false),
            ],
            [session("ended", [loaded(Uri.file("/w/ended.ts"))])],
        );

        await showLoadedScriptMenu(services);

        expect(items(services).map((i) => [i.label, i.description, i.hint])).toEqual([
            ["a.ts", "src", "app"],
            // The workspace folder itself has no description.
            ["b.ts", undefined, "app"],
            ["futex.S", "/lib", "app"],
        ]);
    });

    it("the picked source opens if it is available; a cancelled picker opens nothing", async () => {
        const services = setup([session("app", [loaded(Uri.file("/w/a.ts")), loaded(Uri.file("/w/gone.ts"), false)])]);

        await showLoadedScriptMenu(services);
        expect(services.sources.openSource).not.toHaveBeenCalled();

        const [a, gone] = items(services);
        services.quickInput.quickPick.mockResolvedValueOnce(gone).mockResolvedValueOnce(a);
        await showLoadedScriptMenu(services);
        expect(services.sources.openSource).not.toHaveBeenCalled();
        await showLoadedScriptMenu(services);

        expect(services.sources.openSource.mock.calls.map(([uri]) => uri.toString())).toEqual(["file:///w/a.ts"]);
    });
});
