import type { JsxNode } from "../../../../../../tuidom/dom/jsx/jsx-runtime.ts";
import { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import { BoxContainer } from "../../../../../../tuidom/ui/layout/boxContainerElement.ts";
import { HFlex, hflexFill, hflexFit } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { PaddingContainer } from "../../../../../../tuidom/ui/layout/paddingContainerElement.ts";
import { VStack } from "../../../../../../tuidom/ui/layout/vStackElement.ts";
import { TextLabel } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import { APP_NAME, REPO_URL, VEXX_VERSION } from "../../../../base/common/version.ts";

import type { IDialogStyles } from "./dialogComponent.ts";
import { DialogComponent } from "./dialogComponent.ts";

/** Диалог «About»: имя, версия, Node, ссылка на репозиторий. */
export class AboutDialog extends DialogComponent {
    public onClose?: () => void;

    private readonly okButton: ButtonElement;

    public constructor() {
        super("aboutDialog");

        this.okButton = new ButtonElement("OK");
        this.okButton.onActivate = () => this.onClose?.();
        this.okButton.layoutStyle = { width: hflexFit(), height: 1 };
        this.rebuild();
    }

    public focusDefault(): void {
        this.okButton.focus();
    }

    protected override rowButtons(): readonly ButtonElement[] {
        return [this.okButton];
    }

    protected override onDismiss(): void {
        this.onClose?.();
    }

    protected override describe(styles: IDialogStyles): JsxNode {
        const { bg, fg } = styles;
        return (
            <BoxContainer bg={bg} fg={fg} borderFg={styles.borderFg} title={APP_NAME} titleFg={fg} hasSeparator>
                <PaddingContainer left={2} right={2} bg={bg}>
                    <VStack>
                        <TextLabel text={APP_NAME} fg={fg} bg={bg} layout={{ width: "stretch", height: 1 }} />
                        <TextLabel
                            text={`Version ${VEXX_VERSION}`}
                            fg={fg}
                            bg={bg}
                            layout={{ width: "stretch", height: 1 }}
                        />
                        <TextLabel
                            text={`Node ${process.version}`}
                            fg={fg}
                            bg={bg}
                            layout={{ width: "stretch", height: 1 }}
                        />
                        <TextLabel
                            text={REPO_URL}
                            fg={styles.linkFg}
                            bg={bg}
                            layout={{ width: "stretch", height: 1 }}
                        />
                        <TextLabel text="" fg={fg} bg={bg} layout={{ width: "stretch", height: 1 }} />
                        <HFlex layout={{ width: "stretch", height: 1 }}>
                            <TextLabel text="" fg={fg} bg={bg} layout={{ width: hflexFill(), height: 1 }} />
                            {this.okButton}
                        </HFlex>
                    </VStack>
                </PaddingContainer>
            </BoxContainer>
        );
    }
}
