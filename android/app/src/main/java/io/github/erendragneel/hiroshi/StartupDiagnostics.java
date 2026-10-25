package io.github.erendragneel.hiroshi;

import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;

/** Local startup diagnostics: code locations only, never exception messages or account data. */
public final class StartupDiagnostics {
    private static final String APP = "io.github.erendragneel.hiroshi.";
    private static final int MAX_CAUSES = 3;
    private static final int MAX_FRAMES = 8;
    private static final int MAX_SCAN = 128;
    private static final int MAX_LENGTH = 4000;

    private StartupDiagnostics() { }

    public static String describe(Throwable failure, String version, int apiLevel) {
        String safeVersion = version != null && version.matches("[0-9]{1,3}(?:\\.[0-9]{1,3}){1,3}")
                ? version : "unknown";
        StringBuilder report = new StringBuilder("Hiroshi sensei ").append(safeVersion)
                .append("\nAndroid API ").append(apiLevel > 0 && apiLevel < 1000 ? apiLevel : "unknown");
        if (failure == null) return report.append("\nStartup failure details unavailable.").toString();

        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<Throwable, Boolean>());
        Throwable current = failure;
        for (int depth = 0; depth < MAX_CAUSES && current != null; depth++) {
            if (!seen.add(current)) {
                report.append("\nCause cycle omitted.");
                current = null;
                break;
            }
            report.append(depth == 0 ? "\nFailure: " : "\nCaused by: ")
                    .append(safeClass(current.getClass().getName(), "Throwable"));
            appendFrames(report, current);
            try { current = current.getCause(); }
            catch (RuntimeException ignored) {
                report.append("\nFurther causes unavailable.");
                current = null;
            }
            if (report.length() >= MAX_LENGTH) break;
        }
        if (current != null) report.append("\nFurther causes omitted.");
        return report.substring(0, Math.min(report.length(), MAX_LENGTH));
    }

    private static void appendFrames(StringBuilder report, Throwable failure) {
        StackTraceElement[] stack;
        try { stack = failure.getStackTrace(); }
        catch (RuntimeException ignored) { stack = null; }
        if (stack == null) {
            report.append("\n  Stack locations unavailable.");
            return;
        }
        int count = 0;
        // First retain app locations, then the framework locations that explain the cause.
        for (int pass = 0; pass < 2 && count < MAX_FRAMES; pass++) {
            for (int i = 0; i < Math.min(stack.length, MAX_SCAN) && count < MAX_FRAMES; i++) {
                StackTraceElement frame = stack[i];
                if (frame == null) continue;
                String owner = frame.getClassName();
                boolean app = owner.startsWith(APP);
                if ((pass == 0) != app || !knownOwner(owner) || !validClass(owner)) continue;
                String method = frame.getMethodName();
                if (!(method.matches("[A-Za-z_$][A-Za-z0-9_$]{0,79}")
                        || "<init>".equals(method) || "<clinit>".equals(method))) continue;
                String source = owner.substring(owner.lastIndexOf('.') + 1).split("\\$", 2)[0];
                if (source.length() > 80) continue;
                report.append("\n  at ").append(owner).append('.').append(method).append('(')
                        .append(source).append(".java");
                if (frame.getLineNumber() >= 0) report.append(':').append(frame.getLineNumber());
                report.append(')');
                count++;
            }
        }
        if (count == 0) report.append("\n  Stack locations unavailable.");
    }

    private static boolean knownOwner(String owner) {
        return owner.startsWith(APP) || owner.startsWith("android.") || owner.startsWith("androidx.")
                || owner.startsWith("com.android.") || owner.startsWith("java.") || owner.startsWith("javax.")
                || owner.startsWith("kotlin.") || owner.startsWith("org.chromium.");
    }

    private static boolean validClass(String name) {
        return name != null && name.length() <= 180
                && name.matches("[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)*");
    }

    private static String safeClass(String name, String fallback) {
        return validClass(name) ? name : fallback;
    }
}
