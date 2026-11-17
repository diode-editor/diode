// The program of the debug-inline-values scenario: the Debug Demo adapter stops on entry in main,
// each step over runs a line, and `sum` grows by `argc` on each `sum += argc` line it ran.
#include <stdio.h>

int main(int argc, char **argv) {
    int sum = 0;
    sum += argc;
    sum += argc;
    printf("%s: %d\n", argv[0], sum);
    return 0;
}
