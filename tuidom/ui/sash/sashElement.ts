import type { RenderContext } from "../../dom/tuiElement.ts";
import { TUIElement } from "../../dom/tuiElement.ts";

/** How long the cursor must linger on the sash before the hover line lights up. */
const HOVER_DELAY_MS = 300;

/**
 * Orientation of a {@link SashElement}: a `"vertical"` sash is a column that
 * resizes horizontally (reports screenX); a `"horizontal"` sash is a row that
 * resizes vertically (reports screenY).
 */
export type SashOrientation = "vertical" | "horizontal";

/**
 * Draggable divider (a "sash") used to resize a neighbouring panel.
 *
 * It opts into pointer capture so that once the user presses the left button on it,
 * every subsequent move/release is delivered here even while the cursor is over the
 * neighbour. While dragging it reports the absolute boundary coordinate to its owner
 * via {@link onDrag} — screenX for a vertical sash, screenY for a horizontal one; the
 * owner clamps and applies the new size.
 *
 * It is invisible at rest. On hover — after a short delay so a passing cursor does not
 * flash it — it paints a thin line along the boundary so the user can tell it is
 * draggable. The line also stays lit for the duration of a drag.
 */
export class SashElement extends TUIElement {
    public onDrag?: (boundaryScreen: number) => void;

    private readonly orientation: SashOrientation;
    private dragging = false;
    private hoverTimer: ReturnType<typeof setTimeout> | null = null;

    public constructor(orientation: SashOrientation = "vertical") {
        super();
        this.orientation = orientation;
        this.capturesPointer = true;
        // Keep focusable = false so mousedown does not steal focus from the file tree.

        this.addEventListener("mousedown", (event) => {
            if (event.button !== "left") return;
            // Dragging lights the line immediately; no point waiting on the hover delay.
            this.clearHoverTimer();
            this.dragging = true;
        });
        this.addEventListener("mousemove", (event) => {
            if (!this.dragging) return;
            this.onDrag?.(this.orientation === "vertical" ? event.screenX : event.screenY);
        });
        this.addEventListener("mouseup", () => {
            this.dragging = false;
        });
        // Ядерное hover-состояние мгновенно, а сашу нужна задержка (мелькание
        // при пролёте курсора) — таймер остаётся, но результат выражается
        // кастомным состоянием "lit".
        this.addEventListener("mouseenter", () => {
            this.clearHoverTimer();
            this.hoverTimer = setTimeout(() => {
                this.hoverTimer = null;
                this.setStyleState("lit", true);
            }, HOVER_DELAY_MS);
        });
        this.addEventListener("mouseleave", () => {
            this.clearHoverTimer();
            this.setStyleState("lit", false);
        });
    }

    private clearHoverTimer(): void {
        if (this.hoverTimer !== null) {
            clearTimeout(this.hoverTimer);
            this.hoverTimer = null;
        }
    }

    public override render(context: RenderContext): void {
        if (!(this.hasStyleState("lit") || this.dragging)) return;
        const color = this.styleVar("sash.hoverBorder");
        if (this.orientation === "vertical") {
            for (let y = 0; y < this.layoutSize.height; y++) {
                context.setCell(0, y, { char: "│", fg: color });
            }
        } else {
            for (let x = 0; x < this.layoutSize.width; x++) {
                context.setCell(x, 0, { char: "─", fg: color });
            }
        }
    }
}
