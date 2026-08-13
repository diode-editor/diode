import { describe, expect, it } from "vitest";

import { MockTerminalBackend } from "../backend/mockTerminalBackend.ts";
import { Size } from "../common/geometryPromitives.ts";
import { expectScreen, screen } from "../testing/expectScreen.ts";
import { BodyElement } from "../ui/body/bodyElement.ts";
import { BoxElement } from "../ui/layout/boxElement.ts";

import { TuiApplication } from "./tuiApplication.ts";

describe("TuiApplication", () => {
    it("renders root element on run()", () => {
        const backend = new MockTerminalBackend(new Size(6, 3));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const box = new BoxElement();
        body.setContent(box);
        app.root = body;
        app.run();

        expectScreen(
            backend,
            screen`
                +----+
                |    |
                +----+
            `,
        );
    });

    it("sets root size to match terminal dimensions", () => {
        const backend = new MockTerminalBackend(new Size(10, 5));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const box = new BoxElement();
        body.setContent(box);
        app.root = body;
        app.run();

        expect(body.layoutSize.width).toBe(10);
        expect(body.layoutSize.height).toBe(5);
    });

    it("re-renders with new size on terminal resize", () => {
        const backend = new MockTerminalBackend(new Size(6, 3));
        const app = new TuiApplication(backend);

        const body = new BodyElement();
        const box = new BoxElement();
        body.setContent(box);
        app.root = body;
        app.run();

        // Verify initial render
        expectScreen(
            backend,
            screen`
                +----+
                |    |
                +----+
            `,
        );

        // Simulate resize
        backend.resize(new Size(8, 4));

        expectScreen(
            backend,
            screen`
                +------+
                |      |
                |      |
                +------+
            `,
        );

        expect(body.layoutSize.width).toBe(8);
        expect(body.layoutSize.height).toBe(4);
    });

    it("updates screen dimensions on resize", () => {
        const backend = new MockTerminalBackend(new Size(10, 5));
        const app = new TuiApplication(backend);
        const body = new BodyElement();
        body.setContent(new BoxElement());
        app.root = body;
        app.run();

        expect(app.screen.width).toBe(10);
        expect(app.screen.height).toBe(5);

        backend.resize(new Size(20, 10));

        expect(app.screen.width).toBe(20);
        expect(app.screen.height).toBe(10);
    });
});
