import { packRgb } from "../common/colorUtils.ts";
import { Point } from "../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../dom/tuiElement.ts";

const FOCUSED_BG = packRgb(0, 120, 215);
const DEFAULT_BG = packRgb(50, 50, 50);
const FOCUSED_FG = packRgb(255, 255, 255);
const DEFAULT_FG = packRgb(180, 180, 180);

export class FocusableBox extends TUIElement {
    private bg = DEFAULT_BG;
    private fg = DEFAULT_FG;
    private label: string;

    public constructor(label: string) {
        super();
        this.focusable = true;
        this.label = label;

        this.addEventListener("focus", () => {
            this.bg = FOCUSED_BG;
            this.fg = FOCUSED_FG;
        });
        this.addEventListener("blur", () => {
            this.bg = DEFAULT_BG;
            this.fg = DEFAULT_FG;
        });
    }

    public render(context: RenderContext): void {
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const isTop = y === 0;
                const isBottom = y === h - 1;
                const isLeft = x === 0;
                const isRight = x === w - 1;

                let char: string;
                if ((isTop || isBottom) && (isLeft || isRight)) {
                    char = "+";
                } else if (isTop || isBottom) {
                    char = "-";
                } else if (isLeft || isRight) {
                    char = "|";
                } else {
                    char = " ";
                }

                context.setCell(x, y, {
                    char,
                    bg: this.bg,
                    fg: this.fg,
                });
            }
        }

        // Draw label centered on the middle row
        const midY = Math.floor(h / 2);
        const text = this.isFocused ? `► ${this.label} ◄` : `  ${this.label}  `;
        const startX = Math.max(1, Math.floor((w - text.length) / 2));
        for (let i = 0; i < text.length && startX + i < w - 1; i++) {
            context.setCell(startX + i, midY, {
                char: text[i],
                bg: this.bg,
                fg: this.fg,
            });
        }
    }
}
