import { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { FillerElement } from "../../../../../../tuidom/ui/layout/fillerElement.ts";
import type { HFlexChildSize } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStatusBarEntry, StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";
import { ThemedComponent } from "../../component.ts";

export const StatusBarComponentDIToken = token<StatusBarComponent>("StatusBarComponent");

/** Ширина разделителя между соседними сегментами одной стороны. */
const SEPARATOR_WIDTH = 2;

/**
 * Компонент статус-бара: собирает полосу из примитивов tuidom (HFlex +
 * TextLabel + Filler) и отражает в ней записи {@link StatusBarService}
 * (обновление по `onDidChangeEntries`). Про поставщиков записей ничего не
 * знает — сегменты публикуют contribution-сервисы (`EditorStatusContribution`
 * и др.).
 *
 * Дерево строится один раз и мутируется на месте (паттерн FindComponent):
 * пока состав сторон не меняется, обновляются только тексты лейблов — путь
 * курсора `Ln X, Col Y` не пересобирает поддерево на каждое нажатие.
 * Пересборка `replaceChildren` происходит лишь при смене числа сегментов;
 * лейблы и разделители живут в монотонно растущих пулах.
 */
export class StatusBarComponent extends ThemedComponent {
    public static dependencies = [StatusBarServiceDIToken, ThemeServiceDIToken] as const;

    public readonly view: HFlexElement;

    /**
     * Краевые паддинги полосы. Правый — не только воздух: нижне-правую ячейку
     * терминала рендер вообще никогда не пишет (запись туда провоцирует
     * hardware scroll — см. terminalRenderer), и паддинг гарантирует, что в
     * эту нерисуемую ячейку не попадёт значимый символ последнего сегмента.
     */
    private readonly padLeft = new FillerElement();
    private readonly padRight = new FillerElement();
    /** Заполняет середину между сторонами и красит фон полосы. */
    private readonly centerFill = new FillerElement();
    private readonly leftLabels: TextLabelElement[] = [];
    private readonly rightLabels: TextLabelElement[] = [];
    private readonly separators: FillerElement[] = [];
    private currentLeft: readonly IStatusBarEntry[] = [];
    private currentRight: readonly IStatusBarEntry[] = [];

    public constructor(
        private readonly statusBarService: StatusBarService,
        themeService: ThemeService,
    ) {
        super(themeService);
        this.view = new HFlexElement();
        this.view.id = "statusBar";
        this.register(
            this.statusBarService.onDidChangeEntries(() => {
                this.renderEntries();
            }),
        );
        this.renderEntries();
        this.initStyles();
    }

    private renderEntries(): void {
        const entries = this.statusBarService.entries();
        const left = entries.filter((entry) => entry.alignment !== "right");
        const right = entries.filter((entry) => entry.alignment === "right");
        const structureChanged = left.length !== this.currentLeft.length || right.length !== this.currentRight.length;
        this.currentLeft = left;
        this.currentRight = right;

        this.ensureLabels(this.leftLabels, "left", left.length);
        this.ensureLabels(this.rightLabels, "right", right.length);
        left.forEach((entry, i) => this.syncLabelText(this.leftLabels[i], entry.text));
        right.forEach((entry, i) => this.syncLabelText(this.rightLabels[i], entry.text));

        if (structureChanged) {
            this.rebuildChildren();
        }
    }

    private syncLabelText(label: TextLabelElement, text: string): void {
        if (label.getText() !== text) label.setText(text);
    }

    /**
     * Доращивает пул лейблов до нужного размера. Клик-слушатель вешается один
     * раз при создании и замыкает (сторона, индекс): колбэк записи резолвится
     * в момент клика из текущего снапшота, поэтому переиспользование лейбла
     * под другую запись ничего не перевешивает, а запись без onClick инертна.
     */
    private ensureLabels(pool: TextLabelElement[], side: "left" | "right", count: number): void {
        while (pool.length < count) {
            const index = pool.length;
            const label = new TextLabelElement("");
            label.addEventListener("click", () => {
                const current = side === "left" ? this.currentLeft : this.currentRight;
                current[index]?.onClick?.();
            });
            pool.push(label);
        }
    }

    /**
     * Пересобирает детей полосы: [padL, левые сегменты через разделители,
     * centerFill, правые сегменты через разделители, padR]. Каждая колонка
     * покрыта каким-то ребёнком, поэтому фон полосы красится без собственного
     * render у HFlex. При нехватке ширины centerFill схлопывается в 0 — правая
     * группа теряет правое выравнивание и обрезается краем экрана.
     */
    private rebuildChildren(): void {
        const children: TUIElement[] = [];
        const push = (element: TUIElement, width: HFlexChildSize): void => {
            element.layoutStyle = { width, height: 1 };
            children.push(element);
        };

        let separatorIndex = 0;
        const pushSeparator = (): void => {
            if (this.separators.length === separatorIndex) {
                this.separators.push(new FillerElement());
            }
            push(this.separators[separatorIndex], hflexFixed(SEPARATOR_WIDTH));
            separatorIndex++;
        };

        push(this.padLeft, hflexFixed(1));
        this.currentLeft.forEach((_, i) => {
            if (i > 0) pushSeparator();
            push(this.leftLabels[i], hflexFit());
        });
        push(this.centerFill, hflexFill());
        this.currentRight.forEach((_, i) => {
            if (i > 0) pushSeparator();
            push(this.rightLabels[i], hflexFit());
        });
        push(this.padRight, hflexFixed(1));

        this.view.replaceChildren(children);
    }

    protected updateStyles(): void {
        const bg = this.theme.getRequiredColor("statusBar.background");
        const fg = this.theme.getRequiredColor("statusBar.foreground");
        // Лейблы, паддинги и разделители своих цветов не задают — наследуют
        // fg/bg полосы через каскад стилей.
        this.view.style = { fg, bg };
    }
}
