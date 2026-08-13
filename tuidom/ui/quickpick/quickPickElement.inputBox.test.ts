import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";

import { QuickPickElement } from "./quickPickElement.ts";

function createApp(picker: QuickPickElement, size: Size = new Size(40, 8)): TestApp {
    const app = TestApp.createWithContent(picker, size);
    picker.focus();
    return app;
}

// ─── Title ─────────────────────────────────────────────────────────────────

describe("QuickPickElement — InputBox title", () => {
    it("renders the title into the top border", () => {
        const picker = new QuickPickElement();
        picker.title = "Save As";
        const app = createApp(picker);

        app.render();
        expect(app.backend.screenToString()).toContain("Save As");
    });
});

// ─── Prompt / validation row ─────────────────────────────────────────────────

describe("QuickPickElement — prompt / validation row", () => {
    it("renders the prompt on a dedicated row and grows height by 1", () => {
        const withoutPrompt = new QuickPickElement();
        const app1 = createApp(withoutPrompt);
        const baseHeight = withoutPrompt.getMinIntrinsicHeight(40);

        const withPrompt = new QuickPickElement();
        withPrompt.prompt = "Enter path to save";
        const app2 = createApp(withPrompt);

        expect(withPrompt.getMinIntrinsicHeight(40)).toBe(baseHeight + 1);
        app2.render();
        expect(app2.backend.screenToString()).toContain("Enter path to save");
        void app1;
    });

    it("validation message overrides the prompt and is shown", () => {
        const picker = new QuickPickElement();
        picker.prompt = "Enter path to save";
        picker.validationMessage = "Please enter a file name";
        const app = createApp(picker);

        app.render();
        const text = app.backend.screenToString();
        expect(text).toContain("Please enter a file name");
        expect(text).not.toContain("Enter path to save");
    });
});

describe("QuickPickElement — message row rendering", () => {
    it("renders a warning-severity message", () => {
        const picker = new QuickPickElement();
        picker.validationMessage = "heads up";
        picker.validationSeverity = "warning";
        const app = createApp(picker);

        app.render();
        expect(app.backend.screenToString()).toContain("heads up");
    });

    it("renders an info-severity message", () => {
        const picker = new QuickPickElement();
        picker.validationMessage = "just so you know";
        picker.validationSeverity = "info";
        const app = createApp(picker);

        app.render();
        expect(app.backend.screenToString()).toContain("just so you know");
    });

    it("truncates a validation message wider than the box", () => {
        const picker = new QuickPickElement();
        picker.validationMessage = "This validation message is far too long to fit in a narrow box";
        const app = createApp(picker, new Size(20, 8));

        expect(() => {
            app.render();
        }).not.toThrow();
        // Some prefix is shown, but not the whole (too-wide) message.
        const text = app.backend.screenToString();
        expect(text).toContain("This");
        expect(text).not.toContain("narrow box");
    });
});

describe("QuickPickElement — title too wide", () => {
    it("skips a title that does not fit the box width", () => {
        const picker = new QuickPickElement();
        picker.title = "A really quite long title that will not fit";
        const app = createApp(picker, new Size(20, 8));

        expect(() => {
            app.render();
        }).not.toThrow();
        expect(app.backend.screenToString()).not.toContain("A really quite long title");
    });
});

// ─── acceptMode: "value" (InputBox flavor) ───────────────────────────────────

describe("QuickPickElement — acceptMode 'value'", () => {
    it("Enter fires onAcceptValue with the typed query (no items)", () => {
        const picker = new QuickPickElement();
        picker.acceptMode = "value";
        const onAcceptValue = vi.fn();
        picker.onAcceptValue = onAcceptValue;
        const app = createApp(picker);

        app.sendKey("f");
        app.sendKey("o");
        app.sendKey("o");
        app.sendKey("Enter");

        expect(onAcceptValue).toHaveBeenCalledOnce();
        expect(onAcceptValue).toHaveBeenCalledWith("foo");
    });

    it("a hard validation error blocks Enter", () => {
        const picker = new QuickPickElement();
        picker.acceptMode = "value";
        picker.validationMessage = "bad";
        picker.validationSeverity = "error";
        const onAcceptValue = vi.fn();
        picker.onAcceptValue = onAcceptValue;
        const app = createApp(picker);

        app.sendKey("Enter");
        expect(onAcceptValue).not.toHaveBeenCalled();
    });

    it("a warning does not block Enter", () => {
        const picker = new QuickPickElement();
        picker.acceptMode = "value";
        picker.validationMessage = "heads up";
        picker.validationSeverity = "warning";
        const onAcceptValue = vi.fn();
        picker.onAcceptValue = onAcceptValue;
        const app = createApp(picker);

        app.sendKey("Enter");
        expect(onAcceptValue).toHaveBeenCalledOnce();
    });
});

// ─── acceptMode: "item" (default) is unchanged ───────────────────────────────

describe("QuickPickElement — acceptMode 'item' default", () => {
    it("does not fire onAcceptValue on Enter", () => {
        const picker = new QuickPickElement();
        picker.items = [{ label: "a" }];
        const onAccept = vi.fn();
        const onAcceptValue = vi.fn();
        picker.onAccept = onAccept;
        picker.onAcceptValue = onAcceptValue;
        const app = createApp(picker);

        app.sendKey("Enter");
        expect(onAccept).toHaveBeenCalledOnce();
        expect(onAcceptValue).not.toHaveBeenCalled();
    });
});
