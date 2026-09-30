package demo;

public class App {
    static String greet(String who) {
        return "hello, " + who;
    }

    public static void main(String[] args) {
        String message = greet("world");
        int broken = message;
        System.out.println(broken);
    }
}
