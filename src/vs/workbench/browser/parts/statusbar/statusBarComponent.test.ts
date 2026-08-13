import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TUIMouseEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import { HFlexElement } from "@tuidom/all/ui/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/all/ui/text/textLabelElement";

import { clickSegment, createStatusBarHarness, statusSegments, statusTexts } from "./statusBarComponent.testUtils.ts";

describe("StatusBarComponent", () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        // Deterministic ambient environment so the terminal-env segment resolves to
        // a plain "legacy" tier with no non-local modes, regardless of the host
        // (e.g. running inside tmux/ssh would otherwise leak "ssh,tmux").
        delete process.env.TMUX;
        delete process.env.TMUX_PANE;
        delete process.env.SSH_CONNECTION;
        delete process.env.SSH_CLIENT;
        delete process.env.SSH_TTY;
        delete process.env.COLORTERM;
        delete process.env.KITTY_WINDOW_ID;
        delete process.env.GHOSTTY_RESOURCES_DIR;
        delete process.env.WEZTERM_PANE;
        delete process.env.ALACRITTY_WINDOW_ID;
        delete process.env.TERM_PROGRAM;
        process.env.TERM = "xterm-256color";
    });

    afterEach(() => {
        process.env = savedEnv;
    });

    it("view is the composed flex row with the statusBar id", () => {
        const { component } = createStatusBarHarness();
        expect(component.view).toBeInstanceOf(HFlexElement);
        expect(component.view.id).toBe("statusBar");
    });

    it("shows only the terminal-environment segment when no file is open", () => {
        const { component } = createStatusBarHarness();

        // Test env has no probe → legacy tier, no non-local modes.
        expect(statusSegments(component.view)).toEqual([{ text: "legacy", side: "left" }]);
    });

    it("shows the cursor position (right-aligned) after a file is opened", () => {
        const { component, source } = createStatusBarHarness();

        source.openEditor();

        expect(statusSegments(component.view)).toEqual([
            { text: "legacy", side: "left" },
            { text: "Ln 1, Col 1", side: "right" },
            { text: "UTF-8", side: "right" },
            { text: "LF", side: "right" },
            // NULL_LANGUAGE_SERVICE не знает display name — беджик показывает
            // сырой language id.
            { text: "plaintext", side: "right" },
        ]);
    });

    it("does not show the file name or a modified badge", () => {
        const { component, source } = createStatusBarHarness();

        const editor = source.openEditor();
        editor.viewState.type("x");

        const texts = statusTexts(component.view);
        expect(texts).not.toContain("test-statusbar-nofile.txt");
        expect(texts).not.toContain("[Modified]");
    });

    it("omits the cursor position when there is no selection", () => {
        const { component, source } = createStatusBarHarness();

        const editor = source.openEditor();
        editor.viewState.selections = [];

        // Язык остаётся: активный редактор есть, пропадает только Ln/Col.
        expect(statusTexts(component.view)).toEqual(["legacy", "UTF-8", "LF", "plaintext"]);
    });

    it("shows the terminal tier as the first segment", () => {
        const { component } = createStatusBarHarness();
        expect(statusTexts(component.view)[0]).toBe("legacy");
    });

    it("updates the cursor column as text is typed", () => {
        const { component, source } = createStatusBarHarness();

        const editor = source.openEditor();
        editor.viewState.type("x");

        expect(statusTexts(component.view)).toContain("Ln 1, Col 2");
    });

    it("shows the chord hint entry and clears it on dispose", () => {
        const { component, statusBarService } = createStatusBarHarness();

        // Chord-хинт публикует KeybindingDispatcher как обычную запись сервиса.
        const hint = statusBarService.addEntry({
            id: "status.chordHint",
            text: "(Ctrl+K) was pressed. Waiting for next key…",
            alignment: "left",
            priority: 50,
        });
        expect(statusTexts(component.view)).toContain("(Ctrl+K) was pressed. Waiting for next key…");

        hint.dispose();
        expect(statusSegments(component.view)).toEqual([{ text: "legacy", side: "left" }]);
    });

    it("keeps the chord hint alongside the cursor position", () => {
        const { component, source, statusBarService } = createStatusBarHarness();
        source.openEditor();

        statusBarService.addEntry({
            id: "status.chordHint",
            text: "(Ctrl+K) waiting…",
            alignment: "left",
            priority: 50,
        });

        const segments = statusSegments(component.view);
        expect(segments).toContainEqual({ text: "(Ctrl+K) waiting…", side: "left" });
        expect(segments).toContainEqual({ text: "Ln 1, Col 1", side: "right" });
    });

    it("tracks the cursor live without an explicit refresh", () => {
        const { component, source } = createStatusBarHarness();

        const editor = source.openEditor();

        // No manual refresh — the cursor-change subscription drives the update.
        editor.viewState.type("abc");

        expect(statusTexts(component.view)).toContain("Ln 1, Col 4");
    });

    it("dispose of the contributions removes their entries", () => {
        const { component, source, editorContribution, terminalContribution } = createStatusBarHarness();
        source.openEditor();

        editorContribution.dispose();
        expect(statusTexts(component.view)).toEqual(["legacy"]);

        terminalContribution.dispose();
        expect(statusTexts(component.view)).toEqual([]);
    });

    it("dispose of the component stops following the service", () => {
        const { component, statusBarService } = createStatusBarHarness();

        component.dispose();
        statusBarService.addEntry({ id: "late", text: "late", alignment: "left", priority: 0 });

        expect(statusTexts(component.view)).toEqual(["legacy"]);
    });

    describe("clicks", () => {
        it("клик по левой записи с onClick зовёт её колбэк", () => {
            const { component, statusBarService } = createStatusBarHarness();
            let clicked = 0;
            statusBarService.addEntry({
                id: "left.clickable",
                text: "clickable",
                alignment: "left",
                priority: 10,
                onClick: () => clicked++,
            });

            clickSegment(component.view, "clickable");
            expect(clicked).toBe(1);
        });

        it("запись без onClick инертна", () => {
            const { component } = createStatusBarHarness();
            // "legacy" — сегмент терминального окружения, колбэка у него нет.
            expect(() => {
                clickSegment(component.view, "legacy");
            }).not.toThrow();
        });

        it("clickSegment по несуществующему сегменту бросает", () => {
            const { component } = createStatusBarHarness();
            expect(() => {
                clickSegment(component.view, "no-such-segment");
            }).toThrow('no segment "no-such-segment"');
        });

        it("клик по лейблу снятой записи — no-op (лейбл остался в пуле)", () => {
            const { component, statusBarService } = createStatusBarHarness();
            let clicked = 0;
            const hint = statusBarService.addEntry({
                id: "left.temp",
                text: "temp",
                alignment: "left",
                priority: 10,
                onClick: () => clicked++,
            });
            const label = component.view
                .getChildren()
                .find(
                    (child): child is TextLabelElement =>
                        child instanceof TextLabelElement && child.getText() === " temp ",
                );
            expect(label).toBeDefined();

            hint.dispose();

            // Лейбл отцеплен от полосы, но живёт в пуле; его индекс теперь за
            // пределами снапшота — клик обязан молча ничего не делать.
            label!.dispatchEvent(
                new TUIMouseEvent("click", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 }),
            );
            expect(clicked).toBe(0);
        });
    });

    describe("build-once reconciliation", () => {
        it("cursor movement mutates the existing labels without rebuilding the tree", () => {
            const { component, source } = createStatusBarHarness();
            const editor = source.openEditor();

            const childrenBefore = component.view.getChildren();
            const labelBefore = childrenBefore.find(
                (child) => "getText" in child && (child as { getText(): string }).getText() === " Ln 1, Col 1 ",
            );
            expect(labelBefore).toBeDefined();

            editor.viewState.type("x");

            // Тот же массив детей и тот же экземпляр лейбла — изменился только текст.
            expect(component.view.getChildren()).toEqual(childrenBefore);
            expect((labelBefore as { getText(): string }).getText()).toBe(" Ln 1, Col 2 ");
        });

        it("adding and removing a segment rebuilds the row, reusing pooled labels", () => {
            const { component, statusBarService } = createStatusBarHarness();
            const countBefore = component.view.getChildren().length;

            const hint = statusBarService.addEntry({ id: "hint", text: "hint", alignment: "left", priority: 50 });
            // Новый левый сегмент → +лейбл (разделителей нет, воздух в самом лейбле).
            expect(component.view.getChildren().length).toBe(countBefore + 1);
            const labelsAfterAdd = component.view.getChildren();

            hint.dispose();
            expect(component.view.getChildren().length).toBe(countBefore);

            // Повторное добавление переиспользует пул — те же экземпляры детей.
            statusBarService.addEntry({ id: "hint2", text: "hint2", alignment: "left", priority: 50 });
            expect(component.view.getChildren()).toEqual(labelsAfterAdd);
        });
    });
});
