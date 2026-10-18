package greet

import "strings"

// Hello returns a greeting for name.
func Hello(name string) string {
	return "Hello, " + strings.ToUpper(name)
}
