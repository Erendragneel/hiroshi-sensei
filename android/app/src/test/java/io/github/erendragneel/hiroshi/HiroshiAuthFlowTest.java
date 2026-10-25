package io.github.erendragneel.hiroshi;

import static org.junit.Assert.*;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigInteger;
import java.net.Socket;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

/** Real callback, crypto, encrypted prefs and lifecycle; only remote HTTPS replies are fixtures. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 36)
@LooperMode(LooperMode.Mode.PAUSED)
public final class HiroshiAuthFlowTest {
    private static final String ISSUER = "https://auth.openai.com";
    private static final String CLIENT = "oaiapp_flow_fixture";
    private static final String SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
    private static final String ACCESS = "fixture-access-not-a-real-credential";
    private static final String REFRESH = "fixture-refresh-not-a-real-credential";
    private static KeyPair signing;
    private static JSONObject jwks;
    private ActivityController<Activity> activityController;
    private Activity activity;
    private SecureSessionStore store;
    private FixtureRemote remote;
    private HiroshiAuth auth;
    private final ExecutorService background = Executors.newSingleThreadExecutor();
    private final AtomicBoolean completed = new AtomicBoolean();
    private final AtomicReference<JSONObject> summary = new AtomicReference<>();
    private final AtomicReference<String> error = new AtomicReference<>();

    @BeforeClass public static void createSigningFixture() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048); signing = generator.generateKeyPair();
        RSAPublicKey key = (RSAPublicKey) signing.getPublic();
        jwks = new JSONObject().put("keys", new JSONArray().put(new JSONObject()
                .put("kty", "RSA").put("kid", "fixture-key").put("alg", "RS256").put("use", "sig")
                .put("n", unsigned(key.getModulus())).put("e", unsigned(key.getPublicExponent()))));
    }

    @Before public void createFreshPhoneFixture() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        context.getSharedPreferences("hiroshi_secure_session_v1", Context.MODE_PRIVATE).edit().clear().commit();
        KeyGenerator aes = KeyGenerator.getInstance("AES"); aes.init(256);
        SecretKey key = aes.generateKey();
        store = new SecureSessionStore(context, () -> key);
        remote = new FixtureRemote();
        auth = new HiroshiAuth(store, remote);
        activityController = Robolectric.buildActivity(Activity.class).setup();
        activity = activityController.get();
    }

    @After public void finishPhoneFixture() {
        if(remote != null && remote.releaseExchange != null) remote.releaseExchange.countDown();
        if(auth != null) auth.close();
        background.shutdownNow();
        activityController.pause().stop().destroy();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
    }

    @Test public void completeBrowserHandoffValidatesIdentityAndEncryptsRenewableSession() throws Exception {
        Uri authorization = begin();
        assertEquals("dynamic_agent_client", authorization.getQueryParameter("client_id"));
        assertEquals("S256", authorization.getQueryParameter("code_challenge_method"));
        assertNull("The browser must never receive a verifier", authorization.getQueryParameter("code_verifier"));
        String browserPage = callback(authorization, "fixture-code", CLIENT);
        await(completed::get);

        assertNull(error.get());
        assertTrue(summary.get().optBoolean("signedIn"));
        assertTrue(summary.get().optBoolean("planEnabled"));
        assertFalse(summary.get().optBoolean("busy"));
        assertEquals("learner@example.invalid", summary.get().optString("email"));
        assertEquals(1, remote.codeExchanges);
        assertEquals(ACCESS, inBackground(() -> auth.accessToken()));
        assertEquals(CLIENT, store.read().getString("client_id"));
        assertEquals(REFRESH, store.read().getString("refresh_token"));
        assertEquals(authorization.getQueryParameter("ext_agent_host_id"), store.read().getString("host_id"));

        SharedPreferences encrypted = RuntimeEnvironment.getApplication()
                .getSharedPreferences("hiroshi_secure_session_v1", Context.MODE_PRIVATE);
        String persisted = encrypted.getString("record", "");
        assertTrue("The actual store must write its encrypted envelope", persisted.startsWith("v1."));
        assertFalse(persisted.contains(ACCESS)); assertFalse(persisted.contains(REFRESH));
        assertFalse(persisted.contains("learner@example.invalid"));
        assertFalse(summary.get().toString().contains(ACCESS));
        assertFalse(summary.get().toString().contains(REFRESH));
        assertFalse(browserPage.contains(ACCESS)); assertFalse(browserPage.contains(REFRESH));
        assertFalse(browserPage.contains("fixture-code"));
    }

    @Test public void connectionResumesAndRotatesCredentialsWithoutAnotherBrowserSignIn() throws Exception {
        callback(begin(), "fixture-code", CLIENT); await(completed::get); assertNull(error.get());
        String host = store.read().getString("host_id");
        auth.close(); auth = new HiroshiAuth(store, remote);
        assertTrue(auth.status().optBoolean("planEnabled"));
        assertEquals(ACCESS, inBackground(() -> auth.accessToken()));
        JSONObject expired = store.read(); expired.put("expires_at", 0); store.write(expired);

        assertEquals(ACCESS + "-renewed", inBackground(() -> auth.accessToken()));
        assertEquals(1, remote.refreshes);
        JSONObject replaced = store.read();
        assertEquals(REFRESH + "-renewed", replaced.getString("refresh_token"));
        assertEquals(ACCESS + "-renewed", replaced.getString("access_token"));
        assertEquals(host, replaced.getString("host_id"));
        assertTrue(replaced.getLong("expires_at") > System.currentTimeMillis());
        assertNull("Resuming a valid session must not open a browser", Shadows.shadowOf(activity).getNextStartedActivity());
    }

    @Test public void browserReceiptDoesNotTurnATokenExchangeFailureIntoAConnectedAccount() throws Exception {
        remote.failExchange = true;
        String receipt = callback(begin(), "fixture-code", CLIENT); await(completed::get);
        assertTrue(receipt.startsWith("HTTP/1.1 200"));
        assertNotNull(error.get());
        assertFalse(error.get().contains("fixture-private-detail"));
        assertFalse(summary.get().optBoolean("signedIn"));
        assertFalse(summary.get().optBoolean("planEnabled"));
        assertEquals(CLIENT, store.read().getString("pending_client_id"));
        assertFalse(store.read().has("access_token"));
    }

    @Test public void rejectedClientAfterBrowserReturnShowsSafeProviderDiagnosticsWithoutInternetBlame() throws Exception {
        remote.rejectRegistration = true;
        callback(begin(), "fixture-code", CLIENT); await(completed::get);
        assertNotNull(error.get());
        assertFalse(error.get().toLowerCase(java.util.Locale.ROOT).contains("internet"));
        assertFalse(summary.get().optBoolean("signedIn"));
        assertFalse(summary.get().optBoolean("planEnabled"));
        assertEquals("TOKEN_EXCHANGE", summary.get().getString("connectionStage"));
        assertEquals("invalid_client", summary.get().getString("errorCode"));
        assertEquals(401, summary.get().getInt("httpStatus"));
        assertEquals("req_fixture_123", summary.get().getString("requestId"));
        JSONObject diagnostics = auth.connectionDiagnostics();
        assertEquals("TOKEN_EXCHANGE", diagnostics.getString("connectionStage"));
        assertEquals("invalid_client", diagnostics.getString("errorCode"));
        assertEquals(401, diagnostics.getInt("httpStatus"));
        assertEquals("req_fixture_123", diagnostics.getString("requestId"));
        String safeReport = diagnostics.toString();
        for(String privateValue : new String[]{ACCESS, REFRESH, "fixture-code", remote.lastCodeVerifier, "learner@example.invalid", ISSUER}) {
            assertFalse("Connection diagnostics must not expose credentials, callback data, or account details", safeReport.contains(privateValue));
        }
        assertFalse(store.read().has("access_token"));
        assertFalse(store.read().has("pending_verification"));
    }

    @Test public void aSignedIdentityWithTheWrongNonceCannotBeSavedAsAConnection() throws Exception {
        remote.wrongNonce = true;
        callback(begin(), "fixture-code", CLIENT); await(completed::get);
        assertNotNull(error.get()); assertFalse(summary.get().optBoolean("signedIn"));
        assertFalse(store.read().has("access_token"));
        assertFalse(store.read().has("id_token"));
        assertFalse(store.read().has("pending_verification"));
    }

    @Test public void temporaryJwksFailureResumesEncryptedCheckpointWithoutRepeatingBrowserOrCodeExchange() throws Exception {
        remote.jwksFailures = 1;
        callback(begin(), "fixture-code", CLIENT); await(completed::get);
        assertNotNull(error.get());
        assertEquals("VERIFYING_IDENTITY", summary.get().optString("connectionStage"));
        assertEquals(0, summary.get().optInt("httpStatus"));
        assertFalse(summary.get().optBoolean("signedIn"));
        assertFalse(summary.get().optBoolean("planEnabled"));
        assertTrue(store.read().has("pending_verification"));
        assertFalse(store.read().has("access_token"));
        assertEquals(1, remote.codeExchanges);

        // Model time spent away from the app: verification must not extend token lifetime.
        JSONObject saved = store.read();
        JSONObject checkpoint = saved.getJSONObject("pending_verification");
        long exchangedAt = System.currentTimeMillis() - TimeUnit.MINUTES.toMillis(5);
        checkpoint.put("created_at", exchangedAt).getJSONObject("tokens").put("id_token",
                identity(checkpoint.getString("nonce"), exchangedAt / 1000 - 10, exchangedAt / 1000 + 3600));
        store.write(saved);
        String encrypted = RuntimeEnvironment.getApplication()
                .getSharedPreferences("hiroshi_secure_session_v1", Context.MODE_PRIVATE).getString("record", "");
        assertFalse(encrypted.contains(ACCESS)); assertFalse(encrypted.contains(REFRESH));

        auth.close(); auth = new HiroshiAuth(store, remote);
        clearCompletion();
        auth.signIn(activity, (status, failure) -> { summary.set(status); error.set(failure); completed.set(true); });
        await(completed::get);

        assertNull(error.get());
        assertTrue(summary.get().optBoolean("signedIn"));
        assertTrue(summary.get().optBoolean("planEnabled"));
        assertEquals(1, remote.codeExchanges);
        assertNull("Recovery must not send the learner through another browser sign-in", Shadows.shadowOf(activity).getNextStartedActivity());
        assertFalse(store.read().has("pending_verification"));
        assertEquals(ACCESS, inBackground(() -> auth.accessToken()));
        assertTrue("Verification must retain the original grant's expiry", store.read().getLong("expires_at") <= exchangedAt + TimeUnit.HOURS.toMillis(1) + 1000);
    }

    @Test public void anExpiredUnverifiedCheckpointIsDiscardedBeforeStartingAFreshBrowserAttempt() throws Exception {
        remote.jwksFailures = 1;
        callback(begin(), "fixture-code", CLIENT); await(completed::get);
        JSONObject saved = store.read();
        saved.getJSONObject("pending_verification").put("created_at", System.currentTimeMillis() - TimeUnit.MINUTES.toMillis(11));
        store.write(saved);
        clearCompletion();

        Uri freshAuthorization = begin();
        assertEquals("The issued registration must be reused", CLIENT, freshAuthorization.getQueryParameter("client_id"));
        assertFalse(store.read().has("pending_verification"));
        assertEquals(1, remote.codeExchanges);
        auth.cancelSignIn(); await(completed::get);
        assertFalse(summary.get().optBoolean("planEnabled"));
        assertFalse(store.read().has("access_token"));
    }

    @Test public void delayedCheckpointVerificationUsesEncryptedReceiptTimeWithoutExtendingAccessExpiry() throws Exception {
        remote.jwksFailures = 1;
        callback(begin(), "fixture-code", CLIENT); await(completed::get);
        assertNotNull(error.get());
        JSONObject saved = store.read();
        JSONObject checkpoint = saved.getJSONObject("pending_verification");
        long exchangedAt = System.currentTimeMillis() - TimeUnit.MINUTES.toMillis(6);
        String nonce = checkpoint.getString("nonce");
        String expiredIdentity = identity(nonce, exchangedAt / 1000 - 10, exchangedAt / 1000 + 60);
        assertThrows("The fixture identity must already be expired at retry time", HiroshiAuth.AuthException.class,
                () -> HiroshiAuth.validateIdToken(expiredIdentity, jwks, ISSUER, CLIENT, nonce, System.currentTimeMillis()));
        checkpoint.put("created_at", exchangedAt).getJSONObject("tokens").put("id_token", expiredIdentity);
        store.write(saved);

        auth.close(); auth = new HiroshiAuth(store, remote);
        clearCompletion();
        auth.signIn(activity, (status, failure) -> { summary.set(status); error.set(failure); completed.set(true); });
        await(completed::get);

        assertNull(error.get());
        assertTrue(summary.get().optBoolean("signedIn"));
        assertTrue(summary.get().optBoolean("planEnabled"));
        assertEquals(1, remote.codeExchanges);
        assertEquals(exchangedAt + TimeUnit.HOURS.toMillis(1), store.read().getLong("expires_at"));
        assertEquals(ACCESS, inBackground(() -> auth.accessToken()));
        assertEquals(0, remote.refreshes);
        assertFalse(store.read().has("pending_verification"));
        assertNull("A delayed identity-key check must not restart browser sign-in", Shadows.shadowOf(activity).getNextStartedActivity());
    }

    @Test public void closingOwnerDuringConsumedCodeExchangePreservesOnlyEncryptedUnverifiedCheckpoint() throws Exception {
        remote.pauseCodeExchange();
        callback(begin(), "fixture-code", CLIENT);
        await(() -> remote.exchangeEntered.getCount() == 0);
        HiroshiAuth closedOwner = auth;
        closedOwner.close();
        remote.releaseExchange.countDown();
        await(() -> !closedOwner.status().optBoolean("busy"));

        JSONObject saved = store.read();
        assertTrue(saved.has("pending_verification"));
        assertEquals(ACCESS, saved.getJSONObject("pending_verification").getJSONObject("tokens").getString("access_token"));
        assertFalse(saved.has("access_token")); assertFalse(saved.has("refresh_token")); assertFalse(saved.has("id_token"));
        assertFalse(closedOwner.status().optBoolean("signedIn"));
        assertFalse(closedOwner.status().optBoolean("planEnabled"));
        assertFalse("A closed Activity owner must never deliver a connected callback", completed.get());
        assertEquals("A closed owner cannot validate or activate the returned identity", 0, remote.jwksRequests);
        String encrypted = RuntimeEnvironment.getApplication()
                .getSharedPreferences("hiroshi_secure_session_v1", Context.MODE_PRIVATE).getString("record", "");
        assertTrue(encrypted.startsWith("v1.")); assertFalse(encrypted.contains(ACCESS)); assertFalse(encrypted.contains(REFRESH));

        auth = new HiroshiAuth(store, remote);
        clearCompletion();
        auth.signIn(activity, (status, failure) -> { summary.set(status); error.set(failure); completed.set(true); });
        await(completed::get);

        assertNull(error.get());
        assertTrue(summary.get().optBoolean("signedIn"));
        assertTrue(summary.get().optBoolean("planEnabled"));
        assertEquals(1, remote.codeExchanges);
        assertEquals(1, remote.jwksRequests);
        assertFalse(store.read().has("pending_verification"));
        assertEquals(ACCESS, inBackground(() -> auth.accessToken()));
        assertNull("A recreated owner should resume the consumed exchange without another browser", Shadows.shadowOf(activity).getNextStartedActivity());
    }

    @Test public void signingOutFromReplacementOwnerInvalidatesAClosedOwnersInFlightExchange() throws Exception {
        remote.pauseCodeExchange();
        callback(begin(), "fixture-code", CLIENT);
        await(() -> remote.exchangeEntered.getCount() == 0);
        HiroshiAuth closedOwner = auth;
        closedOwner.close();
        auth = new HiroshiAuth(store, remote);
        auth.disconnect();
        remote.releaseExchange.countDown();
        await(() -> !closedOwner.status().optBoolean("busy"));

        JSONObject saved = store.read();
        assertFalse("Logout must prevent the old exchange from restoring even a checkpoint", saved.has("pending_verification"));
        assertFalse(saved.has("access_token")); assertFalse(saved.has("refresh_token")); assertFalse(saved.has("id_token"));
        assertFalse(auth.status().optBoolean("signedIn"));
        assertFalse(auth.status().optBoolean("planEnabled"));
        assertFalse(completed.get());
        assertEquals(0, remote.jwksRequests);
        assertEquals(1, remote.codeExchanges);

        Uri freshAuthorization = begin();
        assertEquals(CLIENT, freshAuthorization.getQueryParameter("client_id"));
        auth.cancelSignIn(); await(completed::get);
        assertFalse(summary.get().optBoolean("planEnabled"));
        assertFalse(store.read().has("pending_verification"));
    }

    @Test public void deniedPlanPermissionKeepsIdentityButNeverUsableInferenceCredentials() throws Exception {
        remote.deniedPlan = true;
        callback(begin(), "fixture-code", CLIENT); await(completed::get);
        assertNotNull(error.get());
        assertTrue(summary.get().optBoolean("signedIn"));
        assertFalse(summary.get().optBoolean("planEnabled"));
        assertFalse(store.read().has("access_token")); assertFalse(store.read().has("refresh_token"));
        Exception failure = assertThrows(Exception.class, () -> inBackground(() -> auth.accessToken()));
        assertFalse(String.valueOf(failure.getMessage()).contains(ACCESS));
    }

    @Test public void cancellationBeforeTheBrowserReturnsCannotCreateATokenSession() throws Exception {
        begin(); auth.cancelSignIn(); await(completed::get);
        assertNotNull(error.get()); assertFalse(summary.get().optBoolean("planEnabled"));
        assertEquals(0, remote.codeExchanges);
        assertFalse(store.read().has("access_token"));
    }

    private Uri begin() throws Exception {
        auth.signIn(activity, (status, failure) -> { summary.set(status); error.set(failure); completed.set(true); });
        AtomicReference<Intent> browser = new AtomicReference<>();
        await(() -> { Intent next = Shadows.shadowOf(activity).getNextStartedActivity(); if(next != null) browser.set(next); return browser.get() != null || completed.get(); });
        assertNotNull("The real sign-in flow should launch the system browser", browser.get());
        assertEquals(Intent.ACTION_VIEW, browser.get().getAction());
        Uri authorization = browser.get().getData();
        assertEquals(ISSUER + "/api/accounts/authorize", authorization.buildUpon().clearQuery().build().toString());
        remote.authorization = authorization;
        return authorization;
    }

    private void clearCompletion() { completed.set(false); summary.set(null); error.set(null); }

    private static String callback(Uri authorization, String code, String client) throws Exception {
        URI redirect = URI.create(authorization.getQueryParameter("redirect_uri"));
        assertEquals("127.0.0.1", redirect.getHost()); assertEquals("/auth/callback", redirect.getPath());
        String target = redirect.getPath() + "?state=" + encode(authorization.getQueryParameter("state"))
                + "&code=" + encode(code) + "&client_id=" + encode(client);
        try(Socket socket = new Socket("127.0.0.1", redirect.getPort())) {
            socket.setSoTimeout(5000);
            socket.getOutputStream().write(("GET " + target + " HTTP/1.1\r\nHost: 127.0.0.1:" + redirect.getPort() + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().flush();
            return read(socket.getInputStream());
        }
    }

    private static void await(BooleanSupplier condition) throws Exception {
        long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
        while(System.nanoTime() < until) {
            Shadows.shadowOf(Looper.getMainLooper()).idle();
            if(condition.getAsBoolean()) return;
            Thread.sleep(10);
        }
        fail("The local sign-in fixture did not complete within eight seconds");
    }

    private String inBackground(CheckedString task) throws Exception { return background.submit(task::get).get(5, TimeUnit.SECONDS); }
    private interface CheckedString { String get() throws Exception; }
    private static String read(InputStream stream) throws IOException { ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count; while((count=stream.read(buffer))!=-1) bytes.write(buffer,0,count); return bytes.toString(StandardCharsets.UTF_8.name()); }
    private static String encode(String value) throws Exception { return URLEncoder.encode(value, StandardCharsets.UTF_8.name()); }
    private static Map<String,String> form(String body) throws Exception { Map<String,String> fields = new HashMap<>(); for(String item:body.split("&")){String[] pair=item.split("=",2);fields.put(URLDecoder.decode(pair[0],"UTF-8"),URLDecoder.decode(pair.length==2?pair[1]:"","UTF-8"));}return fields; }
    private static String base64(byte[] data) { return Base64.getUrlEncoder().withoutPadding().encodeToString(data); }
    private static String unsigned(BigInteger number) { byte[] value=number.toByteArray(); if(value[0]==0)value=java.util.Arrays.copyOfRange(value,1,value.length); return base64(value); }
    private static String identity(String nonce) throws Exception {
        long now=System.currentTimeMillis()/1000;
        return identity(nonce, now-10, now+3600);
    }
    private static String identity(String nonce, long issuedAt, long expiresAt) throws Exception {
        JSONObject claims=new JSONObject().put("iss",ISSUER).put("aud",CLIENT).put("sub","fixture-subject")
                .put("nonce",nonce).put("iat",issuedAt).put("exp",expiresAt).put("email","learner@example.invalid").put("name","Fixture learner");
        String message=base64(new JSONObject().put("alg","RS256").put("kid","fixture-key").toString().getBytes(StandardCharsets.UTF_8))
                +"."+base64(claims.toString().getBytes(StandardCharsets.UTF_8));
        Signature signer=Signature.getInstance("SHA256withRSA");signer.initSign(signing.getPrivate());signer.update(message.getBytes(StandardCharsets.US_ASCII));return message+"."+base64(signer.sign());
    }

    private static void require(String expected,String actual,String part) throws IOException { if(!expected.equals(actual))throw new IOException("The local fixture rejected "+part); }

    private static Exception registrationRejected() throws Exception {
        Class<?> failure = Class.forName(HiroshiAuth.class.getName() + "$HttpFailure");
        java.lang.reflect.Constructor<?> constructor = failure.getDeclaredConstructor(int.class, String.class, String.class);
        constructor.setAccessible(true);
        return (Exception) constructor.newInstance(401, "invalid_client", "req_fixture_123");
    }

    private static final class FixtureRemote implements HiroshiAuth.Transport {
        volatile Uri authorization;
        volatile boolean failExchange,wrongNonce,deniedPlan,rejectRegistration;
        volatile int codeExchanges,refreshes,jwksFailures,jwksRequests;
        volatile String lastCodeVerifier;
        volatile CountDownLatch exchangeEntered,releaseExchange;
        void pauseCodeExchange() { exchangeEntered = new CountDownLatch(1); releaseExchange = new CountDownLatch(1); }
        @Override public String request(String endpoint,String method,String body) throws Exception {
            if(endpoint.equals(ISSUER+"/.well-known/openid-configuration"))return new JSONObject()
                    .put("issuer",ISSUER).put("authorization_endpoint",ISSUER+"/api/accounts/authorize")
                    .put("token_endpoint",ISSUER+"/api/accounts/oauth/token").put("jwks_uri",ISSUER+"/.well-known/jwks.json").toString();
            if(endpoint.equals(ISSUER+"/.well-known/jwks.json")) {
                jwksRequests++;
                if(jwksFailures > 0) { jwksFailures--; throw new IOException("fixture-private-jwks-detail must never be shown"); }
                return jwks.toString();
            }
            if(!endpoint.equals(ISSUER+"/api/accounts/oauth/token")||!"POST".equals(method))throw new IOException("Unexpected local fixture route");
            Map<String,String> request=form(body);
            require(CLIENT,request.get("client_id"),"client registration");
            require("https://api.openai.com/v1",request.get("resource"),"resource");
            boolean renewal="refresh_token".equals(request.get("grant_type"));
            if(renewal){refreshes++;require(REFRESH,request.get("refresh_token"),"refresh rotation");}
            else {
                codeExchanges++; require("authorization_code",request.get("grant_type"),"grant type"); require("fixture-code",request.get("code"),"authorization code");
                require(authorization.getQueryParameter("redirect_uri"),request.get("redirect_uri"),"exact callback URI");
                lastCodeVerifier = request.get("code_verifier");
                require(authorization.getQueryParameter("code_challenge"),HiroshiAuth.challenge(request.get("code_verifier")),"PKCE binding");
                if(rejectRegistration)throw registrationRejected();
                if(failExchange)throw new IOException("fixture-private-detail must never be shown");
                if(exchangeEntered != null) {
                    exchangeEntered.countDown();
                    // A consumed network response can still finish after executor interruption.
                    // Bound the fixture wait, but model that response rather than aborting it.
                    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
                    while(true) {
                        long remaining = until - System.nanoTime();
                        if(remaining <= 0) throw new IOException("The local fixture exchange was not released");
                        try {
                            if(!releaseExchange.await(remaining, TimeUnit.NANOSECONDS)) throw new IOException("The local fixture exchange was not released");
                            break;
                        } catch(InterruptedException ignored) { }
                    }
                }
            }
            JSONObject response=new JSONObject().put("token_type","Bearer").put("expires_in",3600)
                    .put("scope",deniedPlan?"openid profile email offline_access":SCOPE)
                    .put("access_token",renewal?ACCESS+"-renewed":ACCESS).put("refresh_token",renewal?REFRESH+"-renewed":REFRESH);
            if(!renewal)response.put("id_token",identity(wrongNonce?"wrong-nonce":authorization.getQueryParameter("nonce")));
            return response.toString();
        }
    }
}
