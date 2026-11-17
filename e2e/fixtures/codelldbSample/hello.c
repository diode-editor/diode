#include <stdio.h>
#include <stdlib.h>

struct point {
    int x;
    int y;
};

struct node {
    int value;
    struct node *next;
};

int main(void) {
    int numbers[4] = {10, 20, 30, 40};
    struct point origin = {1, 2};
    struct node third = {3, NULL};
    struct node second = {2, &third};
    struct node first = {1, &second};
    struct node *list = &first;
    int sum = 0;
    for (int i = 0; i < 4; i++) {
        sum += numbers[i];
        printf("i=%d sum=%d\n", i, sum);
    }
    printf("origin=(%d,%d) head=%d\n", origin.x, origin.y, list->value);
    return 0;
}
