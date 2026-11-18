import { Component, input } from "@angular/core";

@Component({
    selector: "app-hello",
    templateUrl: "./hello.component.html",
})
export class HelloComponent {
    name = input<string>("world");
    count = 0;
    increment(): void {
        this.count++;
    }
}
