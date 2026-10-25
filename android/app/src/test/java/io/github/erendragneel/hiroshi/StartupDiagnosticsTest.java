package io.github.erendragneel.hiroshi;

import org.junit.Test;
import static org.junit.Assert.*;

public class StartupDiagnosticsTest {
    @Test public void describesCodeLocationsWithoutExceptionMessagesOrSuppliedFilenames() {
        RuntimeException failure = new IllegalStateException("sk-proj-DO-NOT-COPY Alice private conversation https://example.test/token");
        failure.setStackTrace(new StackTraceElement[]{
                new StackTraceElement("com.android.internal.policy.PhoneWindow", "getInsetsController", "https://private.test/?token=sk-proj-SECRET", 4140),
                new StackTraceElement("io.github.erendragneel.hiroshi.MainActivity$1", "onCreate", "Alice private conversation", 72)
        });
        String report = StartupDiagnostics.describe(failure, "0.2.2", 36);
        assertTrue(report.contains("Hiroshi sensei 0.2.2\nAndroid API 36"));
        assertTrue(report.contains("java.lang.IllegalStateException"));
        assertTrue(report.contains("MainActivity.java:72"));
        assertTrue(report.contains("PhoneWindow.java:4140"));
        assertTrue(report.indexOf("MainActivity.java:72") < report.indexOf("PhoneWindow.java:4140"));
        assertFalse(report.contains("sk-proj"));
        assertFalse(report.contains("Alice"));
        assertFalse(report.contains("private conversation"));
        assertFalse(report.contains("https://"));
    }

    @Test public void neverCallsMessageLocalizedMessageOrThrowableToString() {
        Throwable failure = new RuntimeException() {
            @Override public String getMessage() { throw new AssertionError("Message must not be read"); }
            @Override public String getLocalizedMessage() { throw new AssertionError("Localized message must not be read"); }
            @Override public String toString() { throw new AssertionError("Throwable.toString must not be called"); }
        };
        assertTrue(StartupDiagnostics.describe(failure, "0.2.2", 36).contains("StartupDiagnosticsTest"));
    }

    @Test public void limitsCauseDepthAndFramesAndHandlesCycles() {
        Throwable first = new IllegalStateException("first secret"), second = new IllegalArgumentException("second secret");
        first.initCause(second); second.initCause(first);
        StackTraceElement[] many = new StackTraceElement[1000];
        for (int i = 0; i < many.length; i++) many[i] = new StackTraceElement("io.github.erendragneel.hiroshi.MainActivity", "onCreate", "ignored", i);
        first.setStackTrace(many); second.setStackTrace(many);
        String cycle = StartupDiagnostics.describe(first, "0.2.2", 36);
        assertTrue(cycle.contains("Cause cycle omitted."));
        assertEquals(16, cycle.split("\\n  at ", -1).length - 1);
        assertTrue(cycle.length() <= 4000);

        Throwable chain = new RuntimeException("four", new RuntimeException("three", new RuntimeException("two", new RuntimeException("one"))));
        String bounded = StartupDiagnostics.describe(chain, "0.2.2", 36);
        assertEquals(2, bounded.split("Caused by: ", -1).length - 1);
        assertTrue(bounded.contains("Further causes omitted."));
        assertTrue(bounded.length() <= 4000);
    }

    @Test public void ignoresUntrustedStackIdentifiersAndMetadata() {
        Throwable failure = new RuntimeException("private text");
        failure.setStackTrace(new StackTraceElement[]{
                new StackTraceElement("https://private.test/token", "sk-proj-secret", "private file", 1),
                new StackTraceElement("io.github.erendragneel.hiroshi.MainActivity", "Alice private text", "private file", 1),
                new StackTraceElement("unrelated.private.user.History", "read", "secret", 1)
        });
        String report = StartupDiagnostics.describe(failure, "https://private.test", -1);
        assertTrue(report.contains("Hiroshi sensei unknown\nAndroid API unknown"));
        assertTrue(report.contains("Stack locations unavailable."));
        assertFalse(report.contains("private"));
        assertFalse(report.contains("sk-proj"));
    }

    @Test public void missingFailureStillGivesSmallSafeReport() {
        String report = StartupDiagnostics.describe(null, null, 36);
        assertEquals("Hiroshi sensei unknown\nAndroid API 36\nStartup failure details unavailable.", report);
    }
}
