from typing import overload


class Shape:
    def area(self) -> float:
        raise NotImplementedError


class Circle(Shape):
    def area(self) -> float:
        return 3.14


class Square(Shape):
    def area(self) -> float:
        return 1.0


@overload
def scale(value: int) -> int: ...
@overload
def scale(value: str) -> str: ...
def scale(value):
    return value


def measure(figure: Shape):
    total = figure.area()
    total = total + figure.area()
    return total


unit = Circle()
measure(unit)
