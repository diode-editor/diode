import type { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { NULL_JUMP_RECORDER } from "../../../services/history/browser/historyService.ts";
import type { ISearchHandle } from "../../../services/search/common/textSearch.ts";
import { TextSearchService } from "../../../services/search/node/textSearchService.ts";

import { SearchComponent } from "./searchComponent.ts";

// The seams "what the component puts into the query" and "what rg finds" are tested separately; here — that they meet in
// the frame. The scenario is a monorepo bug: `"common": true` in `files.exclude` hid `nci/common/**`.
describe("SearchComponent + настоящий ripgrep", () => {
    let ws: ITempWorkspace;
    let service: TextSearchService;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-search-view-",
            files: {
                "common/RootOnly.java": "TopicStreamConsumer\n",
                "nci/common/ydb/TopicStreamConsumer.java": "class TopicStreamConsumer {}\n",
            },
        });
        service = new TextSearchService();
    });

    afterEach(() => {
        service.dispose();
        ws.dispose();
    });

    function make(settings: Record<string, unknown>): SearchComponent {
        const workspace = {
            getWorkspace: () => ({ id: ws.dir, folders: [{ uri: { fsPath: ws.dir }, name: "", index: 0 }] }),
        } as unknown as IWorkspaceContextService;
        const configuration: IConfigurationService = {
            ...NULL_CONFIGURATION_SERVICE,
            get: (key: string) => settings[key] as never,
        };
        return new SearchComponent(
            service,
            workspace,
            { openUri: () => {}, getActiveEditor: () => null },
            NULL_STATE_SERVICE,
            new ContextKeyService(),
            { registerContainer: () => {}, registerView: () => {} } as unknown as ViewsService,
            NULL_JUMP_RECORDER,
            configuration,
        );
    }

    function setInput(component: SearchComponent, index: number, value: string): void {
        const input = component.view.querySelectorAll("InputElement")[index] as InputElement;
        input.inputState.value = value;
        input.onChange?.(value);
    }

    function screen(component: SearchComponent): string {
        return renderElement(component.view, 60, 20, { themeVars: true }).screenToString();
    }

    /** One summary is not enough: "No results" shows before rg starts, and "1 … in 1 file" while rg streams the second file. */
    async function search(component: SearchComponent, query: string, summary: string): Promise<string> {
        const spy = vi.spyOn(service, "search");
        setInput(component, 0, query);
        await vi.waitFor(() => {
            expect(spy).toHaveBeenCalled();
        });
        await (spy.mock.results.at(-1)?.value as ISearchHandle).complete;
        await vi.waitFor(() => {
            expect(screen(component)).toContain(summary);
        });
        return screen(component);
    }

    it("корневой `common` из files.exclude не прячет `nci/common/**`", async () => {
        const component = make({ "files.exclude": { common: true } });
        const frame = await search(component, "TopicStreamConsumer", "in 1 file");
        expect(frame).toContain("TopicStreamConsumer.java");
        expect(frame).not.toContain("RootOnly.java");
    });

    it("`common` в поле «files to exclude» прячет его на любой глубине", async () => {
        const component = make({});
        component.toggleQueryDetails(true, false);
        setInput(component, 2, "common");
        await search(component, "TopicStreamConsumer", "No results");
    });

    it("`common` в поле «files to include» находит его на любой глубине", async () => {
        const component = make({});
        component.toggleQueryDetails(true, false);
        setInput(component, 1, "common");
        const frame = await search(component, "TopicStreamConsumer", "2 results in 2 files");
        expect(frame).toContain("RootOnly.java");
        expect(frame).toContain("TopicStreamConsumer.java");
    });
});
