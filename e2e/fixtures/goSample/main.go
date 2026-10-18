package main

import (
	"fmt"
	"os"

	"example.com/hello/greet"
)

func main() {
	msg := greet.Hello("world")
	var broken int = "oops"
	fmt.Println( msg,broken )
}
