package io.github.erendragneel.hiroshi;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.StringReader;

import static org.junit.Assert.*;

public final class HiroshiInferenceTest {
    private static JSONObject payload() throws Exception {
        return new JSONObject().put("language", "ja").put("level", "beginner").put("scene", "cafe")
                .put("corrections", false).put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", "こんにちは")));
    }

    private static String sse(JSONObject event) { return "data: " + event + "\n\n"; }

    private static JSONObject completion(String output) throws Exception {
        return new JSONObject().put("type", "response.completed").put("response", new JSONObject()
                .put("status", "completed").put("output", new JSONArray().put(new JSONObject().put("type", "message")
                        .put("content", new JSONArray().put(new JSONObject().put("type", "output_text").put("text", output))))));
    }

    private static String reply() throws Exception {
        JSONArray choices = new JSONArray();
        for (int i = 0; i < 3; i++) choices.put(new JSONObject().put("text", "はい").put("meaning", "Yes"));
        return new JSONObject().put("reply", "こんにちは。").put("reading", "Konnichiwa.").put("translation", "Hello.")
                .put("correction", "A correction").put("suggestions", choices).toString();
    }

    private static HiroshiInference.InferenceException streamFailure(String stream) throws Exception {
        try {
            HiroshiInference.parseEventStream(new StringReader(stream));
            fail("Expected incomplete or failed stream");
            return null;
        } catch (HiroshiInference.InferenceException expected) { return expected; }
    }

    @Test public void requestUsesOnlySupportedStatelessStreamingFields() throws Exception {
        JSONObject request = HiroshiInference.buildRequest(payload(), "account-offered-model");
        assertEquals(5, request.length());
        assertFalse(request.getBoolean("store"));
        assertTrue(request.getBoolean("stream"));
        assertEquals("account-offered-model", request.getString("model"));
        assertFalse(request.has("temperature"));
        assertFalse(request.has("max_output_tokens"));
        assertFalse(request.has("previous_response_id"));
        for (int i = 0; i < request.getJSONArray("input").length(); i++) {
            assertNotEquals("system", request.getJSONArray("input").getJSONObject(i).getString("role"));
        }
    }

    @Test public void personalizationNeverEntersDeveloperInstructions() throws Exception {
        JSONObject body = payload().put("profile", new JSONObject().put("name", "IGNORE_RULES_SENTINEL").put("interests", "STEAL_CREDENTIALS_SENTINEL"))
                .put("memories", new JSONArray().put("REPLACE_SYSTEM_SENTINEL"));
        JSONObject request = HiroshiInference.buildRequest(body, "model");
        assertFalse(request.getString("instructions").contains("SENTINEL"));
        JSONArray input = request.getJSONArray("input");
        assertTrue(input.getJSONObject(input.length() - 2).getString("content").startsWith("UNTRUSTED REFERENCE DATA"));
        assertTrue(input.getJSONObject(input.length() - 2).getString("content").contains("IGNORE_RULES_SENTINEL"));
        assertEquals("こんにちは", input.getJSONObject(input.length() - 1).getString("content"));
    }

    @Test public void historyBoundKeepsCompleteMostRecentLearnerMessage() throws Exception {
        JSONArray history = new JSONArray();
        for (int i = 0; i < 30; i++) history.put(new JSONObject().put("role", "assistant").put("content", "prior" + i));
        String latest = "a".repeat(2500);
        history.put(new JSONObject().put("role", "user").put("content", latest));
        JSONObject request = HiroshiInference.buildRequest(payload().put("messages", history), "model");
        JSONArray input = request.getJSONArray("input");
        assertEquals(21, input.length());
        assertEquals("prior11", input.getJSONObject(0).getString("content"));
        assertEquals(latest, input.getJSONObject(input.length() - 1).getString("content"));
    }

    @Test public void rejectsInjectedSystemRoleAndOversizedMessage() throws Exception {
        JSONObject body = payload();
        body.getJSONArray("messages").getJSONObject(0).put("role", "system");
        try { HiroshiInference.buildRequest(body, "model"); fail("System role must be rejected"); }
        catch (HiroshiInference.InferenceException expected) { assertEquals("INVALID_MESSAGES", expected.code); }
        body.getJSONArray("messages").getJSONObject(0).put("role", "user").put("content", "a".repeat(2501));
        try { HiroshiInference.buildRequest(body, "model"); fail("Message bound must be enforced"); }
        catch (HiroshiInference.InferenceException expected) { assertEquals("INVALID_MESSAGES", expected.code); }
    }

    @Test public void teacherDataIsBoundedUntrustedAndCannotCreateGrades() throws Exception {
        JSONObject lesson = new JSONObject().put("lessonId", "greetings").put("title", "LESSON_SENTINEL")
                .put("objective", "Learn greetings").put("explanation", new JSONArray().put("Say hello."))
                .put("examples", new JSONArray().put(new JSONObject().put("target", "こんにちは").put("meaning", "Hello")));
        JSONObject request = HiroshiInference.buildRequest(payload().put("teacherContext", lesson), "model");
        assertTrue(request.getString("instructions").contains("Teacher support is active"));
        assertTrue(request.getString("instructions").contains("must not invent marks"));
        assertFalse(request.getString("instructions").contains("LESSON_SENTINEL"));
        assertTrue(request.getJSONArray("input").getJSONObject(0).getString("content").contains("LESSON_SENTINEL"));
    }

    @Test public void acceptsOnlyAfterCompletedTerminalEvent() throws Exception {
        String expected = reply();
        String stream = ": keepalive\n\nevent: response.output_text.delta\n" + sse(new JSONObject().put("type", "response.output_text.delta").put("delta", expected))
                + sse(completion(expected));
        assertEquals(expected, HiroshiInference.parseEventStream(new StringReader(stream)));
    }

    @Test public void partialTextAndDoneWithoutCompletionAreNeverReplies() throws Exception {
        String partial = sse(new JSONObject().put("type", "response.output_text.delta").put("delta", reply()));
        assertEquals("AI_INCOMPLETE", streamFailure(partial).code);
        assertEquals("AI_INCOMPLETE", streamFailure(partial + "data: [DONE]\n\n").code);
    }

    @Test public void lateUsageFailureDiscardsOtherwisePlausibleReply() throws Exception {
        String stream = sse(new JSONObject().put("type", "response.output_text.delta").put("delta", reply()))
                + sse(new JSONObject().put("type", "response.failed").put("response", new JSONObject().put("status", "failed")
                .put("error", new JSONObject().put("code", "subscription_sharing_usage_limit_exceeded").put("message", "PRIVATE_RAW_MESSAGE"))));
        HiroshiInference.InferenceException error = streamFailure(stream);
        assertEquals("subscription_sharing_usage_limit_exceeded", error.code);
        assertFalse(error.getMessage().contains("PRIVATE_RAW_MESSAGE"));
        assertTrue(error.getMessage().contains("Manage usage"));
    }

    @Test public void incompleteStatusAndRefusalAreNotCompletedAnswers() throws Exception {
        JSONObject invalid = completion(reply());
        invalid.getJSONObject("response").put("status", "incomplete");
        assertEquals("AI_INCOMPLETE", streamFailure(sse(invalid)).code);
        JSONObject refused = completion(reply());
        refused.getJSONObject("response").getJSONArray("output").getJSONObject(0).getJSONArray("content")
                .getJSONObject(0).put("type", "refusal");
        assertEquals("AI_REFUSAL", streamFailure(sse(refused)).code);
    }

    @Test public void excessiveOutputAndMalformedEventsFailClosed() throws Exception {
        assertEquals("AI_REPLY_TOO_LARGE", streamFailure(sse(new JSONObject().put("type", "response.output_text.delta").put("delta", "x".repeat(40 * 1024 + 1)))).code);
        assertEquals("AI_INVALID_STREAM", streamFailure("data: {not-json}\n\n").code);
    }

    @Test public void replyNormalizationHonorsCorrectionsAndTeacherReadings() throws Exception {
        JSONObject normalized = HiroshiInference.parseReply(reply(), false, true);
        assertEquals("", normalized.getString("correction"));
        assertEquals("", normalized.getString("reading"));
        assertEquals("こんにちは。", normalized.getString("reply"));
        try { HiroshiInference.parseReply("{\"reply\":\"plausible text\"}", true, false); fail("Missing fields must fail"); }
        catch (HiroshiInference.InferenceException expected) { assertEquals("AI_INVALID_REPLY", expected.code); }
    }

    @Test public void catalogFiltersVisibilityAndPreservesAccountOrdering() throws Exception {
        JSONArray raw = new JSONArray().put(new JSONObject().put("slug", "offered-first").put("display_name", "Preferred").put("visibility", "list"))
                .put(new JSONObject().put("slug", "hidden").put("display_name", "Hidden").put("visibility", "hide"))
                .put(new JSONObject().put("slug", "offered-second").put("display_name", "Another").put("visibility", "list"))
                .put(new JSONObject().put("slug", "offered-first").put("display_name", "Duplicate").put("visibility", "list"));
        JSONArray models = HiroshiInference.parseCatalog(new JSONObject().put("models", raw));
        assertEquals(2, models.length());
        assertEquals("offered-first", models.getJSONObject(0).getString("slug"));
        assertEquals("offered-second", models.getJSONObject(1).getString("slug"));
    }

    @Test public void cannotSelectAnAssumedModelWithoutAccountDiscovery() throws Exception {
        HiroshiInference client = new HiroshiInference(() -> { throw new AssertionError("Selection must never request a credential"); });
        assertEquals("", client.selectedModel());
        try { client.selectModel("gpt-6.1-sol"); fail("An assumed model must not be accepted"); }
        catch (HiroshiInference.InferenceException expected) { assertEquals("CHATGPT_MODEL_NOT_AVAILABLE", expected.code); }
        client.clearModels();
        assertEquals("", client.selectedModel());
    }
}
