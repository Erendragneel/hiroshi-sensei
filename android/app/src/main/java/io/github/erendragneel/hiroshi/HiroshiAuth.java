package io.github.erendragneel.hiroshi;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.lang.ref.WeakReference;
import java.math.BigInteger;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.RSAPublicKeySpec;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import javax.net.ssl.HttpsURLConnection;

/** Sign in with ChatGPT public-client flow. Tokens never cross the WebView bridge. */
public final class HiroshiAuth implements AutoCloseable {
    private static final String ISSUER = "https://auth.openai.com";
    private static final String DISCOVERY = ISSUER + "/.well-known/openid-configuration";
    private static final String AUTHORIZE = ISSUER + "/api/accounts/authorize";
    private static final String TOKEN = ISSUER + "/api/accounts/oauth/token";
    private static final String JWKS = ISSUER + "/.well-known/jwks.json";
    private static final String RESOURCE = "https://api.openai.com/v1";
    private static final String SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
    private static final long SIGN_IN_TIMEOUT_MS = 300000;
    private static final long PENDING_MAX_AGE_MS = 600000;
    private static final SecureRandom RANDOM = new SecureRandom();
    private final SecureSessionStore store;
    private final Transport transport;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    // Activity recreation can leave an older instance finishing a token rotation.
    // All instances in this process must serialize against the same saved session.
    private static final Object sessionLock = new Object();
    private static final Object refreshLock = new Object();
    private static final AtomicLong epoch = new AtomicLong();
    private volatile Attempt attempt;
    private volatile String message = "Continue with ChatGPT to connect Hiroshi.";
    private volatile boolean closed;
    private volatile String connectionStage="READY",errorCode="",requestId="",exceptionClass="";
    private volatile int httpStatus;
    private JSONObject discovery;
    private JSONObject cachedJwks;
    private long jwksAt;

    public interface Callback { void onComplete(JSONObject safeStatus, String error); }
    interface Transport { String request(String endpoint, String method, String body) throws Exception; }
    public static final class AuthException extends Exception {
        public final String code;
        public AuthException(String message) { this("AUTH_FAILED", message); }
        AuthException(String code, String message) { super(message); this.code = code; }
    }
    private static final class Attempt {
        final String state = randomValue(32), nonce = randomValue(32), verifier = randomValue(64);
        final long epoch;
        final Callback callback;
        volatile ServerSocket listener;
        volatile boolean cancelled;
        volatile boolean ownerClosed;
        Attempt(long epoch, Callback callback) { this.epoch = epoch; this.callback = callback; }
        void stop() { cancelled = true; try { if (listener != null) listener.close(); } catch (IOException ignored) { } }
    }
    private static final class HttpFailure extends Exception {
        final int status; final String code,requestId;
        HttpFailure(int status, String code, String requestId) { this.status=status;this.code=code;this.requestId=requestId; }
    }

    public HiroshiAuth(Context context) { this(new SecureSessionStore(context), HiroshiAuth::requestHttps); }
    HiroshiAuth(SecureSessionStore store, Transport transport) {
        this.store=Objects.requireNonNull(store,"store");this.transport=Objects.requireNonNull(transport,"transport");
    }

    /** Safe account summary only; neither tokens nor authorization URLs are returned. */
    public JSONObject status() {
        JSONObject result = new JSONObject();
        try {
            JSONObject record = store.read();
            boolean signedIn = !record.optString("id_token").isEmpty();
            result.put("signedIn", signedIn).put("planEnabled", signedIn && record.optBoolean("plan_enabled"))
                    .put("email", signedIn ? record.optString("email") : "")
                    .put("displayName", signedIn ? record.optString("display_name") : "")
                    .put("busy", attempt != null).put("message", message)
                    .put("connectionStage",connectionStage).put("errorCode",errorCode).put("httpStatus",httpStatus)
                    .put("requestId",requestId);
        } catch (Exception failure) {
            recordFailure(failure);
            try { result.put("signedIn", false).put("planEnabled", false).put("email", "").put("displayName", "")
                    .put("busy", false).put("message", "Hiroshi could not unlock the saved ChatGPT connection. Your game progress is safe. Copy connection details to identify the problem.")
                    .put("connectionStage",connectionStage).put("errorCode",errorCode).put("httpStatus",httpStatus).put("requestId",requestId); } catch (Exception impossible) { }
        }
        return result;
    }

    /** Deliberately excludes account information, authorization URLs and all credentials. */
    public JSONObject connectionDiagnostics() {
        JSONObject report=new JSONObject();
        try { report.put("connectionStage",connectionStage).put("errorCode",errorCode).put("httpStatus",httpStatus)
                .put("requestId",requestId).put("exceptionClass",exceptionClass); } catch(Exception ignored){ }
        return report;
    }

    private void beginConnection() { errorCode="";httpStatus=0;requestId="";exceptionClass="";connectionStage="STARTING"; }
    private void recordFailure(Exception failure) {
        exceptionClass=failure.getClass().getSimpleName();
        if(failure instanceof HttpFailure) {
            HttpFailure http=(HttpFailure)failure;httpStatus=http.status;requestId=safeRequestId(http.requestId);
            errorCode=knownProviderCode(http.code)?http.code:"AUTH_HTTP_ERROR";
        } else if(failure instanceof AuthException) errorCode=((AuthException)failure).code;
        else if(failure instanceof org.json.JSONException)errorCode="AUTH_RESPONSE_UNREADABLE";
        else if(failure instanceof java.security.GeneralSecurityException)errorCode="SECURE_STORAGE_UNAVAILABLE";
        else if(failure instanceof IOException)errorCode=isSavingStage()?"SECURE_SESSION_SAVE_FAILED":"AUTH_CONNECTION_INTERRUPTED";
        else errorCode="AUTH_SETUP_FAILED";
    }

    public void signIn(Activity activity, Callback callback) {
        Objects.requireNonNull(callback, "callback");
        if (closed) { complete(callback, "Hiroshi is closing. Open the app again."); return; }
        final Attempt current;
        synchronized (sessionLock) {
            if (attempt != null) { complete(callback, "A sign-in is already open. Finish it or cancel before trying again."); return; }
            current = new Attempt(epoch.get(), callback); attempt = current;
        }
        WeakReference<Activity> activityRef = new WeakReference<>(activity);
        executor.execute(() -> runSignIn(current, activityRef));
    }

    private void runSignIn(Attempt current, WeakReference<Activity> activityRef) {
        String error = null;
        beginConnection();
        try {
            JSONObject metadata = metadata();
            JSONObject existing;
            String hostId;
            synchronized (sessionLock) { requireActive(current); hostId=store.hostId();existing=store.read(); }
            JSONObject pending=existing.optJSONObject("pending_verification");
            if(pending!=null&&!validCheckpoint(pending,existing,hostId)) {
                clearCheckpoint(current);pending=null;existing=store.read();
            }
            if(pending==null) {
                String savedClient=existing.optString("client_id",existing.optString("pending_client_id",""));
                current.listener=new ServerSocket(0,8,InetAddress.getByName("127.0.0.1"));
                current.listener.setSoTimeout(1000);
                String redirect="http://127.0.0.1:"+current.listener.getLocalPort()+"/auth/callback";
                Map<String,String> parameters=new LinkedHashMap<>();
                parameters.put("client_id",savedClient.isEmpty()?"dynamic_agent_client":savedClient);
                if(savedClient.isEmpty())parameters.put("agent_name_hint","Hiroshi sensei");
                parameters.put("ext_agent_host_id",hostId);parameters.put("response_type","code");
                parameters.put("redirect_uri",redirect);parameters.put("scope",SCOPES);parameters.put("resource",RESOURCE);
                parameters.put("state",current.state);parameters.put("nonce",current.nonce);
                parameters.put("code_challenge_method","S256");parameters.put("code_challenge",challenge(current.verifier));
                if(!savedClient.isEmpty()&&!existing.optString("id_token").isEmpty())parameters.put("id_token_hint",existing.optString("id_token"));
                if(!savedClient.isEmpty()&&!existing.optString("email").isEmpty())parameters.put("login_hint",existing.optString("email"));
                if(!savedClient.isEmpty()&&!existing.optBoolean("plan_enabled"))parameters.put("prompt","consent");
                String authorization=metadata.getString("authorization_endpoint")+"?"+encodeForm(parameters);
                requireActive(current);connectionStage="BROWSER";
                message="Finish Continue with ChatGPT in your browser, then return to Hiroshi.";
                main.post(()->{
                    Activity owner=activityRef.get();if(!isActive(current))return;
                    if(owner==null||owner.isFinishing()||owner.isDestroyed()){current.stop();return;}
                    try{owner.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(authorization)).addCategory(Intent.CATEGORY_BROWSABLE));}
                    catch(RuntimeException ignored){current.stop();}
                });
                Map<String,String> returned=listen(current);requireActive(current);
                String clientId=returned.getOrDefault("client_id",savedClient);
                if(clientId==null||!clientId.matches("[A-Za-z0-9_-]{4,256}")||"dynamic_agent_client".equals(clientId)
                        ||(!savedClient.isEmpty()&&!savedClient.equals(clientId)))throw new AuthException("The sign-in registration did not match. Please start again.");
                if(savedClient.isEmpty())synchronized(sessionLock){requireActive(current);connectionStage="SAVING_REGISTRATION";JSONObject saved=store.read();saved.put("pending_client_id",clientId);store.write(saved);}
                synchronized(refreshLock) {
                    requireActive(current);connectionStage="TOKEN_EXCHANGE";
                    message="ChatGPT returned to Hiroshi. Finishing your connection…";
                    JSONObject tokens=postForm(TOKEN,form("grant_type","authorization_code","client_id",clientId,
                            "code",returned.get("code"),"code_verifier",current.verifier,"redirect_uri",redirect,"resource",RESOURCE));
                    pending=new JSONObject().put("tokens",tokens).put("client_id",clientId).put("host_id",hostId)
                            .put("nonce",current.nonce).put("created_at",System.currentTimeMillis())
                            .put("expected_subject",existing.optString("subject"));
                    // This encrypted checkpoint is not an authenticated session. Never expose
                    // its credentials to the browser or use them before identity validation.
                    synchronized(sessionLock){
                        // Closing an Activity must not lose an already consumed code.
                        // This only preserves an unverified encrypted checkpoint; a
                        // closed owner can never activate the returned credentials.
                        if(current.epoch!=epoch.get()||(!isActive(current)&&!current.ownerClosed))requireActive(current);
                        connectionStage="SAVING_CHECKPOINT";
                        JSONObject saved=store.read();saved.put("pending_verification",pending);store.write(saved);
                    }
                }
            }
            JSONObject record;
            synchronized(refreshLock) { record=finishCheckpoint(current,pending,hostId); }
            if(!record.optBoolean("plan_enabled"))error="Signed in, but ChatGPT plan usage was not approved. Continue with ChatGPT again to enable it.";
            connectionStage=record.optBoolean("plan_enabled")?"CONNECTED":"SIGNED_IN";
            message=error==null?"ChatGPT is connected. Hiroshi can use this account's available models and plan allowance.":error;
            if(error!=null)errorCode="PLAN_PERMISSION_REQUIRED";
        } catch(Exception failure) {
            recordFailure(failure);
            if(failure instanceof AuthException&&"VERIFYING_IDENTITY".equals(connectionStage)) {
                try{clearCheckpoint(current);}catch(Exception ignored){ }
            }
            error=friendly(failure);
            if(isActive(current))message=error;
        } finally {
            current.stop();synchronized(sessionLock){if(attempt==current)attempt=null;}
            complete(current.callback,error);
        }
    }

    private boolean validCheckpoint(JSONObject pending,JSONObject saved,String host) {
        long created=pending.optLong("created_at"),now=System.currentTimeMillis();
        String client=pending.optString("client_id");
        String expected=saved.optString("client_id",saved.optString("pending_client_id",""));
        return created>0&&created<=now+30000&&now-created<=PENDING_MAX_AGE_MS
                &&host.equals(pending.optString("host_id"))&&client.equals(expected)
                &&client.matches("[A-Za-z0-9_-]{4,256}")&&!"dynamic_agent_client".equals(client)
                &&pending.optString("nonce").matches("[A-Za-z0-9_-]{32,128}")
                &&pending.optJSONObject("tokens")!=null;
    }

    private JSONObject finishCheckpoint(Attempt current,JSONObject pending,String host) throws Exception {
        requireActive(current);connectionStage="VERIFYING_IDENTITY";message="Verifying your ChatGPT sign-in…";
        String client=pending.getString("client_id");JSONObject tokens=pending.getJSONObject("tokens");
        // The locally encrypted receipt is bounded to ten minutes and bound to
        // this installation/client/nonce. Validate identity as of that receipt;
        // delayed verification must not extend the API token's original expiry.
        JSONObject claims=verifyIdentity(tokens.optString("id_token"),client,pending.getString("nonce"),pending.getLong("created_at"));
        String expected=pending.optString("expected_subject");
        if(!expected.isEmpty()&&!expected.equals(claims.optString("sub")))throw new AuthException("The signed-in account did not match the saved connection.");
        JSONObject record=tokenRecord(tokens,claims,client,host,null,pending.getLong("created_at"));
        connectionStage="SAVING_SESSION";
        synchronized(sessionLock){requireActive(current);store.write(record);epoch.incrementAndGet();}
        return record;
    }

    private void clearCheckpoint(Attempt current) throws Exception {
        synchronized(sessionLock){requireActive(current);JSONObject saved=store.read();saved.remove("pending_verification");store.write(saved);}
    }

    private Map<String, String> listen(Attempt current) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(SIGN_IN_TIMEOUT_MS);
        while (System.nanoTime() < deadline) {
            requireActive(current);
            try (Socket socket = current.listener.accept()) {
                socket.setSoTimeout(3000);
                String request = readLine(socket.getInputStream(), 14000);
                String[] line = request.split(" ", -1);
                Map<String, String> parameters;
                try {
                    if (line.length != 3 || !"GET".equals(line[0]) || !line[2].startsWith("HTTP/1.")) throw new AuthException("Invalid callback");
                    parameters = parseCallback(line[1], current.state);
                } catch (AuthException invalid) {
                    respond(socket, "400 Bad Request", "This sign-in callback could not be accepted. Return to Hiroshi.");
                    if ("ACCESS_DENIED".equals(invalid.code) || "OAUTH_ERROR".equals(invalid.code)) throw invalid;
                    continue;
                }
                respond(socket, "200 OK", "Your approval returned to Hiroshi. The app is finishing your connection.");
                current.listener.close(); return parameters;
            } catch (SocketTimeoutException ignored) { }
        }
        throw new AuthException("Sign-in timed out after five minutes. Please try again.");
    }

    /** Blocking native-only access. Call from a background thread, never a JavaScript bridge result. */
    public String accessToken() throws AuthException {
        if (closed) throw new AuthException("Hiroshi is closing. Open the app again.");
        if (Looper.myLooper() == Looper.getMainLooper()) throw new AuthException("Connect Hiroshi from a background request.");
        synchronized (refreshLock) {
            long version = epoch.get();
            try {
                JSONObject record = store.read();
                if (!record.optBoolean("plan_enabled") || record.optString("access_token").isEmpty()) throw new AuthException("Continue with ChatGPT to enable Hiroshi's AI conversation.");
                long now = System.currentTimeMillis();
                if (record.optLong("expires_at") > now + 60000 || (record.optLong("expires_at") > now + 5000 && record.optLong("earliest_refresh_at") > now)) {
                    if (epoch.get() != version || closed) throw new AuthException("You signed out. Continue with ChatGPT to reconnect.");
                    return record.getString("access_token");
                }
                if (record.optString("refresh_token").isEmpty()) throw new AuthException("Your ChatGPT connection expired. Continue with ChatGPT again.");
                JSONObject renewed = postForm(TOKEN, form("grant_type", "refresh_token", "client_id", record.getString("client_id"),
                        "refresh_token", record.getString("refresh_token"), "resource", RESOURCE));
                JSONObject claims = null;
                if (!renewed.optString("id_token").isEmpty()) {
                    claims = verifyIdentity(renewed.getString("id_token"), record.getString("client_id"), null);
                    if (!record.optString("subject").equals(claims.optString("sub"))) throw new AuthException("The refreshed ChatGPT account did not match. Sign in again.");
                }
                JSONObject next = tokenRecord(renewed, claims, record.getString("client_id"), record.getString("host_id"), record);
                boolean current;
                synchronized (sessionLock) { current = epoch.get() == version; if (current) store.write(next); }
                if (!current) {
                    // A logout may race the network rotation. Never restore that session;
                    // revoke the newly returned refresh token as well as the previous one.
                    try { String endpoint = metadata().optString("revocation_endpoint"); if (sameAuthOrigin(endpoint)) request(endpoint, "POST", encodeForm(form("token", next.optString("refresh_token"), "token_type_hint", "refresh_token", "client_id", next.optString("client_id")))); }
                    catch (Exception ignored) { }
                    throw new AuthException("You signed out. Continue with ChatGPT to reconnect.");
                }
                // Finishing an Activity is not signing out. Preserve a valid
                // replacement for the next Activity, but do not use it here.
                if (closed) throw new AuthException("Hiroshi is closing. Open the app again.");
                if (!next.optBoolean("plan_enabled")) throw new AuthException("ChatGPT plan permission is no longer enabled. Continue with ChatGPT again.");
                return next.getString("access_token");
            } catch (HttpFailure failure) {
                if (Arrays.asList("invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused").contains(failure.code)) {
                    synchronized (sessionLock) { if (version == epoch.get()) { epoch.incrementAndGet(); try { store.clearCredentials(); } catch (Exception ignored) { } } }
                    throw new AuthException("Your ChatGPT connection expired. Continue with ChatGPT again.");
                }
                throw new AuthException(friendly(failure));
            } catch (AuthException failure) { throw failure; }
            catch (Exception ignored) { throw new AuthException("Hiroshi could not renew the ChatGPT connection. Check your internet connection and try again."); }
        }
    }

    /** Cancel the temporary browser flow; an existing validated connection is retained. */
    public void cancelSignIn() {
        synchronized(sessionLock) {
            Attempt current = attempt;
            if (current != null) {
                current.ownerClosed=false;current.stop();
                message = "Sign-in cancelled. You can try Continue with ChatGPT again.";
            }
        }
    }

    /** Clear locally first. Network revocation is best effort and never restores cleared credentials. */
    public void disconnect() {
        epoch.incrementAndGet(); cancelSignIn();
        JSONObject previous;
        try { synchronized (sessionLock) { previous = store.read(); store.clearCredentials(); } }
        catch (Exception ignored) { message = "The saved connection could not be cleared. Clear Hiroshi's app storage in Android settings."; return; }
        message = "Signed out on this phone.";
        if (previous.optString("refresh_token").isEmpty() || closed) return;
        executor.execute(() -> {
            try {
                String endpoint = metadata().optString("revocation_endpoint");
                if (!sameAuthOrigin(endpoint)) throw new AuthException("Revocation unavailable");
                request(endpoint, "POST", encodeForm(form("token", previous.optString("refresh_token"), "token_type_hint", "refresh_token", "client_id", previous.optString("client_id"))));
            } catch (Exception ignored) { message = "Signed out on this phone. Remote sign-out could not be confirmed; disconnect Hiroshi in ChatGPT Settings to revoke access."; }
        });
    }

    @Override public void close() {
        synchronized(sessionLock) {
            Attempt current=attempt;
            if(current!=null&&!current.cancelled)current.ownerClosed=true;
            closed=true;
            if(current!=null)current.stop();
        }
        executor.shutdownNow();
    }

    private boolean isActive(Attempt value) { return !closed && attempt == value && !value.cancelled && value.epoch == epoch.get(); }
    private void requireActive(Attempt value) throws AuthException { if (!isActive(value)) throw new AuthException("Sign-in cancelled. You can try Continue with ChatGPT again."); }
    private void complete(Callback callback, String error) { main.post(() -> { if (!closed) callback.onComplete(status(), error); }); }

    private synchronized JSONObject metadata() throws Exception {
        if (discovery == null) {
            JSONObject fetched = new JSONObject(request(DISCOVERY, "GET", null));
            if (!ISSUER.equals(fetched.optString("issuer")) || !AUTHORIZE.equals(fetched.optString("authorization_endpoint"))
                    || !TOKEN.equals(fetched.optString("token_endpoint")) || !JWKS.equals(fetched.optString("jwks_uri"))) throw new AuthException("OpenAI's sign-in configuration could not be verified. Please try again later.");
            discovery = fetched;
        }
        return discovery;
    }

    private synchronized JSONObject verifyIdentity(String jwt, String clientId, String nonce) throws Exception {
        return verifyIdentity(jwt,clientId,nonce,System.currentTimeMillis());
    }
    private synchronized JSONObject verifyIdentity(String jwt, String clientId, String nonce,long receivedAt) throws Exception {
        metadata();
        if (cachedJwks == null || System.currentTimeMillis() - jwksAt > 3600000) { cachedJwks = new JSONObject(request(JWKS, "GET", null)); jwksAt = System.currentTimeMillis(); }
        try { return validateIdToken(jwt, cachedJwks, ISSUER, clientId, nonce, receivedAt); }
        catch (AuthException failure) {
            if (!"KEY_NOT_FOUND".equals(failure.code)) throw failure;
            cachedJwks = new JSONObject(request(JWKS, "GET", null)); jwksAt = System.currentTimeMillis();
            return validateIdToken(jwt, cachedJwks, ISSUER, clientId, nonce, receivedAt);
        }
    }

    private static JSONObject tokenRecord(JSONObject tokens, JSONObject claims, String clientId, String host, JSONObject old) throws Exception {
        return tokenRecord(tokens,claims,clientId,host,old,System.currentTimeMillis());
    }
    private static JSONObject tokenRecord(JSONObject tokens, JSONObject claims, String clientId, String host, JSONObject old,long receivedAt) throws Exception {
        JSONObject record = old == null ? new JSONObject() : new JSONObject(old.toString());
        record.put("client_id", clientId).put("host_id", host); record.remove("pending_client_id");
        if (claims != null) record.put("subject", claims.getString("sub")).put("issuer", claims.getString("iss"))
                .put("email", claims.optString("email")).put("display_name", claims.optString("name"));
        String scope = tokens.has("scope") ? tokens.optString("scope") : record.optString("scope");
        Set<String> granted = new HashSet<>(Arrays.asList(scope.trim().split("\\s+")));
        boolean enabled = granted.contains("chatgpt.tokens.use.direct") && granted.contains("resource.invoke");
        if (enabled && (!"Bearer".equalsIgnoreCase(tokens.optString("token_type")) || tokens.optString("access_token").isEmpty()
                || tokens.optString("refresh_token").isEmpty() || tokens.optLong("expires_in") <= 0 || tokens.optLong("expires_in") > 86400)) throw new AuthException("OpenAI returned an incomplete connection. Continue with ChatGPT again.");
        record.put("scope", scope).put("plan_enabled", enabled);
        if (tokens.has("id_token")) record.put("id_token", tokens.getString("id_token"));
        if (enabled) {
            record.put("access_token", tokens.getString("access_token")).put("refresh_token", tokens.getString("refresh_token"))
                    .put("expires_at", receivedAt + tokens.getLong("expires_in") * 1000);
            // This field is opaque when unrecognized; expiry remains the authoritative local bound.
            record.remove("earliest_refresh_at");
            if (tokens.opt("earliest_refresh_at") instanceof Number) record.put("earliest_refresh_at", tokens.getLong("earliest_refresh_at") * 1000);
        } else { record.remove("access_token"); record.remove("refresh_token"); record.remove("expires_at"); }
        return record;
    }

    static String challenge(String verifier) throws AuthException {
        try { return Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII))); }
        catch (GeneralSecurityException ignored) { throw new AuthException("This phone could not prepare secure sign-in."); }
    }
    private static String randomValue(int bytes) { byte[] value = new byte[bytes]; RANDOM.nextBytes(value); return Base64.getUrlEncoder().withoutPadding().encodeToString(value); }
    private static boolean constantEquals(String left, String right) { return left != null && right != null && MessageDigest.isEqual(left.getBytes(StandardCharsets.UTF_8), right.getBytes(StandardCharsets.UTF_8)); }

    static Map<String, String> parseCallback(String target, String state) throws AuthException {
        try {
            URI uri = new URI(target);
            if (uri.isAbsolute() || uri.getRawAuthority() != null || uri.getRawFragment() != null || !"/auth/callback".equals(uri.getRawPath()) || uri.getRawQuery() == null) throw new AuthException("Invalid sign-in callback.");
            Map<String, String> result = new HashMap<>();
            for (String pair : uri.getRawQuery().split("&")) {
                String[] parts = pair.split("=", 2);
                String key = URLDecoder.decode(parts[0], StandardCharsets.UTF_8.name());
                String value = parts.length == 2 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8.name()) : "";
                if (result.put(key, value) != null) throw new AuthException("Invalid sign-in callback.");
            }
            if (!constantEquals(state, result.get("state"))) throw new AuthException("The sign-in attempt did not match. Please start again.");
            if (result.containsKey("error")) throw new AuthException("access_denied".equals(result.get("error")) ? "ACCESS_DENIED" : "OAUTH_ERROR", "ChatGPT sign-in was not approved. You can try again when ready.");
            if (result.getOrDefault("code", "").isEmpty()) throw new AuthException("The sign-in callback did not contain a code.");
            return result;
        } catch (AuthException failure) { throw failure; }
        catch (Exception ignored) { throw new AuthException("Invalid sign-in callback."); }
    }

    /** RS256 only; no algorithm supplied by an untrusted token selects a verifier. */
    static JSONObject validateIdToken(String jwt, JSONObject jwks, String issuer, String clientId, String nonce, long nowMillis) throws AuthException {
        try {
            if (jwt == null || jwt.length() > 64000) throw new GeneralSecurityException();
            String[] parts = jwt.split("\\.", -1);
            if (parts.length != 3) throw new GeneralSecurityException();
            for (String part : parts) if (part.isEmpty() || !part.matches("[A-Za-z0-9_-]+")) throw new GeneralSecurityException();
            JSONObject header = new JSONObject(new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8));
            if (!"RS256".equals(header.optString("alg")) || header.has("crit") || header.has("jku") || header.has("jwk") || header.has("x5u")) throw new GeneralSecurityException();
            String kid = header.optString("kid");
            if (kid.isEmpty() || kid.length() > 256) throw new GeneralSecurityException();
            JSONArray keys = jwks.getJSONArray("keys"); JSONObject selected = null;
            if (keys.length() > 100) throw new GeneralSecurityException();
            for (int i = 0; i < keys.length(); i++) {
                JSONObject key = keys.getJSONObject(i);
                if (kid.equals(key.optString("kid")) && "RSA".equals(key.optString("kty"))
                        && (!key.has("use") || "sig".equals(key.optString("use"))) && (!key.has("alg") || "RS256".equals(key.optString("alg")))) {
                    if (selected != null) throw new GeneralSecurityException(); selected = key;
                }
            }
            if (selected == null) throw new AuthException("KEY_NOT_FOUND", "OpenAI's identity signing key could not be found.");
            BigInteger modulus = new BigInteger(1, Base64.getUrlDecoder().decode(selected.getString("n")));
            BigInteger exponent = new BigInteger(1, Base64.getUrlDecoder().decode(selected.getString("e")));
            if (modulus.bitLength() < 2048 || modulus.bitLength() > 8192 || exponent.bitLength() > 32 || exponent.compareTo(BigInteger.valueOf(3)) < 0 || !exponent.testBit(0)) throw new GeneralSecurityException();
            Signature signature = Signature.getInstance("SHA256withRSA");
            signature.initVerify(KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(modulus, exponent)));
            signature.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
            if (!signature.verify(Base64.getUrlDecoder().decode(parts[2]))) throw new GeneralSecurityException();
            JSONObject claims = new JSONObject(new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8));
            long now = nowMillis / 1000;
            if (!issuer.equals(claims.optString("iss")) || !(claims.opt("exp") instanceof Number) || claims.getLong("exp") <= now - 5
                    || !(claims.opt("iat") instanceof Number) || claims.getLong("iat") > now + 5 || claims.getLong("iat") < 0
                    || (claims.has("nbf") && (!(claims.opt("nbf") instanceof Number) || claims.getLong("nbf") > now + 5))
                    || claims.optString("sub").isEmpty() || claims.optString("sub").length() > 512) throw new GeneralSecurityException();
            Object audience = claims.opt("aud"); boolean matches = clientId.equals(audience); int audiences = 1;
            if (audience instanceof JSONArray) { JSONArray values = (JSONArray) audience; audiences = values.length(); for (int i = 0; i < values.length(); i++) if (clientId.equals(values.opt(i))) matches = true; }
            if (!matches || (audiences > 1 && !clientId.equals(claims.optString("azp"))) || (claims.has("azp") && !clientId.equals(claims.optString("azp")))
                    || (nonce != null && !constantEquals(nonce, claims.optString("nonce")))) throw new GeneralSecurityException();
            return claims;
        } catch (AuthException failure) { throw failure; }
        catch (Exception ignored) { throw new AuthException("OpenAI's account identity could not be verified. Please start sign-in again."); }
    }

    private static Map<String, String> form(String... pairs) {
        Map<String, String> result = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) result.put(pairs[i], pairs[i + 1]);
        return result;
    }
    private static String encodeForm(Map<String, String> values) throws UnsupportedEncodingException {
        StringJoiner result = new StringJoiner("&");
        for (Map.Entry<String, String> value : values.entrySet()) result.add(URLEncoder.encode(value.getKey(), "UTF-8") + "=" + URLEncoder.encode(value.getValue(), "UTF-8"));
        return result.toString();
    }
    private JSONObject postForm(String endpoint, Map<String, String> form) throws Exception { return new JSONObject(request(endpoint, "POST", encodeForm(form))); }
    private static boolean sameAuthOrigin(String endpoint) {
        try { URI uri = new URI(endpoint); return "https".equals(uri.getScheme()) && "auth.openai.com".equals(uri.getHost()) && uri.getPort() == -1 && uri.getUserInfo() == null && uri.getFragment() == null && uri.getQuery() == null; }
        catch (Exception ignored) { return false; }
    }
    private String request(String endpoint, String method, String body) throws Exception { return transport.request(endpoint,method,body); }
    private static String requestHttps(String endpoint, String method, String body) throws Exception {
        if (!sameAuthOrigin(endpoint)) throw new AuthException("The sign-in endpoint could not be verified.");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(endpoint).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
        connection.setRequestMethod(method); connection.setRequestProperty("Accept", "application/json");
        try {
            if (body != null) { byte[] bytes = body.getBytes(StandardCharsets.UTF_8); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded"); connection.setFixedLengthStreamingMode(bytes.length); try (OutputStream output = connection.getOutputStream()) { output.write(bytes); } }
            int status = connection.getResponseCode();
            String text; try (InputStream input = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream()) { text = input == null ? "" : readBounded(input, 262144); }
            if (status < 200 || status >= 300) {
                String code = ""; try { JSONObject error = new JSONObject(text); code = error.optString("error"); if (error.opt("error") instanceof JSONObject) code = error.getJSONObject("error").optString("code"); } catch (Exception ignored) { }
                if (!code.matches("[a-z0-9_]{0,100}")) code = "";
                throw new HttpFailure(status,code,connection.getHeaderField("x-request-id"));
            }
            return text;
        } finally { connection.disconnect(); }
    }
    private static String readBounded(InputStream input, int limit) throws IOException { ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count; while ((count = input.read(buffer)) != -1) { if (output.size() + count > limit) throw new IOException("Response too large"); output.write(buffer, 0, count); } return output.toString(StandardCharsets.UTF_8.name()); }
    private static String readLine(InputStream input, int limit) throws IOException { ByteArrayOutputStream output = new ByteArrayOutputStream(); int value; while ((value = input.read()) != -1 && value != '\n') { if (output.size() >= limit) throw new IOException("Request too large"); if (value != '\r') output.write(value); } return output.toString(StandardCharsets.US_ASCII.name()); }
    private static void respond(Socket socket, String status, String text) throws IOException {
        // Static local return page. No authorization code, account detail or token is rendered.
        String html="<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Return to Hiroshi sensei</title>"
                +"<style>body{margin:0;padding:32px 22px;background:#f6f5f0;color:#305348;font:16px/1.65 system-ui,sans-serif}main{max-width:430px;margin:10vh auto}h1{font-size:27px;line-height:1.2}a{display:block;padding:14px 18px;border-radius:12px;background:#345849;color:white;text-align:center;text-decoration:none;font-weight:600;margin:25px 0}small{color:#71816c}</style>"
                +"<main><small>HIROSHI SENSEI</small><h1>Return to your teacher</h1><p>"+text+"</p>"
                +"<a href='intent://signin-complete#Intent;scheme=hiroshi-sensei;package=io.github.erendragneel.hiroshi;end'>Open Hiroshi sensei</a>"
                +"<small>If the button does not open the app, return to Hiroshi from your recent apps.</small></main></html>";
        byte[] body=html.getBytes(StandardCharsets.UTF_8);OutputStream output=socket.getOutputStream();
        output.write(("HTTP/1.1 "+status+"\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\nContent-Length: "+body.length+"\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        output.write(body);output.flush();
    }
    private static boolean knownProviderCode(String code) {
        return Arrays.asList("invalid_client","invalid_grant","invalid_request","invalid_scope","invalid_target",
                "unauthorized_client","unsupported_grant_type","access_denied","server_error","temporarily_unavailable",
                "subscription_sharing_user_not_eligible","chatpass_v2_scope_not_authorized",
                "chatpass_v2_invalid_authorization_context").contains(code);
    }
    private static String safeRequestId(String value) {
        return value!=null&&(value.matches("req_[A-Za-z0-9_-]{8,100}")||value.matches("[A-Fa-f0-9-]{16,64}"))?value:"";
    }
    private boolean isSavingStage() {
        return "SAVING_SESSION".equals(connectionStage)||"SAVING_CHECKPOINT".equals(connectionStage)||"SAVING_REGISTRATION".equals(connectionStage);
    }
    private String friendly(Exception failure) {
        if (failure instanceof AuthException) return failure.getMessage();
        if (failure instanceof HttpFailure) { HttpFailure http = (HttpFailure) failure;
            if ("subscription_sharing_user_not_eligible".equals(http.code)) return "ChatGPT plan usage is unavailable for this account or workspace.";
            if ("invalid_grant".equals(http.code)) return "The ChatGPT sign-in or renewable session expired. Continue with ChatGPT again.";
            if ("invalid_client".equals(http.code)||"unauthorized_client".equals(http.code)) return "ChatGPT did not accept this app's connection registration. Your saved game is safe. The connection details can identify what needs fixing.";
            if ("invalid_scope".equals(http.code)||"invalid_target".equals(http.code)) return "ChatGPT did not accept the permissions requested by this connection. Your saved game is safe.";
            if (http.status == 403) return "OpenAI did not allow this connection. Check your account, workspace and regional eligibility.";
            if (http.status == 429) return "ChatGPT is limiting sign-in requests. Wait a little before trying again.";
            if (http.status>=500) return "The ChatGPT sign-in service could not finish the connection. Tap Continue with ChatGPT to retry.";
            return "ChatGPT returned to Hiroshi, but the sign-in service did not accept the next connection step. Your game is safe; the connection details can identify the cause.";
        }
        if(isSavingStage())return "Hiroshi could not securely save the connection. Your game progress has not been reset.";
        if("VERIFYING_IDENTITY".equals(connectionStage))return "Hiroshi could not finish verifying the sign-in. Tap Continue with ChatGPT to retry without repeating browser approval.";
        if("TOKEN_EXCHANGE".equals(connectionStage))return "ChatGPT returned to Hiroshi, but the connection was interrupted while finishing sign-in. Tap Continue with ChatGPT to try again.";
        return "The ChatGPT connection could not be started. Your saved game is safe; please try again.";
    }
}
