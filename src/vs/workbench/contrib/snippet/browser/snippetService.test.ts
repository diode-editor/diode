import { afterEach, describe, expect, it } from "vitest";

import { drawSelections, snippetPane } from "../../../../../TestUtils/snippetPane.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { SnippetController2 } from "../../../../editor/contrib/snippet/browser/snippetController2.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";

import {
    acceptSnippetAction,
    jumpToNextSnippetPlaceholderAction,
    jumpToPrevSnippetPlaceholderAction,
} from "./snippetActions.ts";
import { SnippetService } from "./snippetService.ts";

const disposers: (() => void)[] = [];

function setup() {
    const pane = snippetPane("");
    const active = new Emitter<TextEditorPane | null>();
    let current: TextEditorPane | null = pane;
    const group = {
        getActiveEditor: () => current,
        onActiveEditorChanged: active.event,
    } as unknown as IEditorService;
    const service = new SnippetService(group);
    const contextKeys = new ContextKeyService();
    const accessor = { get: () => service } as unknown as Parameters<typeof acceptSnippetAction.run>[0];
    disposers.push(() => {
        service.dispose();
        pane.dispose();
    });
    return {
        pane,
        service,
        accessor,
        insert(template: string) {
            SnippetController2.get(pane).apply([{ range: createRange(0, 0, 0, 0), template }], {});
        },
        keys() {
            service.updateContextKeys(contextKeys);
            return [
                contextKeys.get("inSnippetMode"),
                contextKeys.get("hasNextTabstop"),
                contextKeys.get("hasPrevTabstop"),
            ];
        },
        deactivate() {
            current = null;
            active.fire(null);
        },
    };
}

afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
});

describe("SnippetService", () => {
    it("the keys follow the session of the active editor", () => {
        const h = setup();
        expect(h.keys()).toEqual([false, false, false]);
        h.insert("${1:a} ${2:b} ${3:c}");
        expect(h.keys()).toEqual([true, true, false]);
        jumpToNextSnippetPlaceholderAction.run(h.accessor);
        expect(h.keys()).toEqual([true, true, true]);
        jumpToPrevSnippetPlaceholderAction.run(h.accessor);
        expect(drawSelections(h.pane)).toBe("[a] b c");
        acceptSnippetAction.run(h.accessor);
        expect(drawSelections(h.pane)).toBe("a b c|");
        expect(h.keys()).toEqual([false, false, false]);
    });

    it("another editor taking over ends the session; no active editor has no keys", () => {
        const h = setup();
        h.insert("${1:a} ${2:b}");
        h.deactivate();
        expect(h.keys()).toEqual([false, false, false]);
        jumpToNextSnippetPlaceholderAction.run(h.accessor);
        expect(SnippetController2.get(h.pane).isInSnippet).toBe(false);
        expect(h.pane.viewState.snippetTabstopRanges).toEqual([]);
    });
});
