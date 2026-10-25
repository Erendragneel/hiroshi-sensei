package io.github.erendragneel.hiroshi;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.BeforeClass;
import org.junit.Test;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.Map;
import static org.junit.Assert.*;

/** Local-only security regressions: no browser, network, credentials or real account. */
public class HiroshiAuthTest {
    private static final String ISSUER = "https://auth.openai.com";
    private static final String CLIENT = "oaiapp_test";
    private static final String NONCE = "fresh-test-nonce";
    private static final long NOW = 1800000000000L;
    private static KeyPair pair;
    private static JSONObject jwks;

    @BeforeClass public static void keys() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048); pair = generator.generateKeyPair();
        RSAPublicKey key = (RSAPublicKey) pair.getPublic();
        JSONObject jwk = new JSONObject().put("kty", "RSA").put("kid", "test-key").put("use", "sig").put("alg", "RS256")
                .put("n", unsigned(key.getModulus())).put("e", unsigned(key.getPublicExponent()));
        jwks = new JSONObject().put("keys", new JSONArray().put(jwk));
    }
    private static String unsigned(BigInteger value) { byte[] bytes = value.toByteArray(); if (bytes[0] == 0) bytes = java.util.Arrays.copyOfRange(bytes, 1, bytes.length); return encode(bytes); }
    private static String encode(byte[] bytes) { return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private static JSONObject claims() throws Exception { return new JSONObject().put("iss", ISSUER).put("aud", CLIENT).put("sub", "test-subject")
            .put("iat", NOW / 1000 - 30).put("exp", NOW / 1000 + 300).put("nonce", NONCE); }
    private static String token(JSONObject claims) throws Exception { return token(claims, new JSONObject().put("alg", "RS256").put("kid", "test-key")); }
    private static String token(JSONObject claims, JSONObject header) throws Exception {
        String input = encode(header.toString().getBytes(StandardCharsets.UTF_8)) + "." + encode(claims.toString().getBytes(StandardCharsets.UTF_8));
        Signature signature = Signature.getInstance("SHA256withRSA"); signature.initSign(pair.getPrivate()); signature.update(input.getBytes(StandardCharsets.US_ASCII));
        return input + "." + encode(signature.sign());
    }
    private static JSONObject verify(String token) throws Exception { return HiroshiAuth.validateIdToken(token, jwks, ISSUER, CLIENT, NONCE, NOW); }

    @Test public void validatesOnlySignedIdentityBoundToClientAndNonce() throws Exception {
        assertEquals("test-subject", verify(token(claims())).getString("sub"));
        assertEquals("test-subject", HiroshiAuth.validateIdToken(token(claims()), jwks, ISSUER, CLIENT, null, NOW).getString("sub"));
    }

    @Test public void rejectsTamperingAndAlgorithmConfusion() throws Exception {
        String good = token(claims()); String[] pieces = good.split("\\.");
        String tampered = pieces[0] + "." + encode(claims().put("sub", "attacker").toString().getBytes(StandardCharsets.UTF_8)) + "." + pieces[2];
        assertThrows(HiroshiAuth.AuthException.class, () -> verify(tampered));
        assertThrows(HiroshiAuth.AuthException.class, () -> verify(token(claims(), new JSONObject().put("alg", "HS256").put("kid", "test-key"))));
        assertThrows(HiroshiAuth.AuthException.class, () -> verify(pieces[0] + "." + pieces[1] + "."));
        assertThrows(HiroshiAuth.AuthException.class, () -> verify(token(claims(), new JSONObject().put("alg", "RS256").put("kid", "test-key").put("jku", "https://attacker.invalid/keys"))));
    }

    @Test public void rejectsMismatchedClaimsEvenWhenSignatureIsValid() throws Exception {
        for (JSONObject bad : new JSONObject[]{claims().put("iss", "https://attacker.invalid"), claims().put("aud", "another-client"),
                claims().put("nonce", "another-attempt"), claims().put("exp", NOW / 1000 - 6), claims().put("iat", NOW / 1000 + 6),
                claims().put("nbf", NOW / 1000 + 6), claims().put("sub", "")}) {
            assertThrows(HiroshiAuth.AuthException.class, () -> verify(token(bad)));
        }
    }

    @Test public void multipleAudiencesRequireMatchingAuthorizedParty() throws Exception {
        JSONObject multiple = claims().put("aud", new JSONArray().put(CLIENT).put("another-client"));
        assertThrows(HiroshiAuth.AuthException.class, () -> verify(token(multiple)));
        multiple.put("azp", "another-client"); assertThrows(HiroshiAuth.AuthException.class, () -> verify(token(multiple)));
        multiple.put("azp", CLIENT); assertEquals("test-subject", verify(token(multiple)).getString("sub"));
    }

    @Test public void unknownKeysAreIdentifiedWithoutAcceptingClaims() throws Exception {
        HiroshiAuth.AuthException error = assertThrows(HiroshiAuth.AuthException.class, () -> verify(token(claims(), new JSONObject().put("alg", "RS256").put("kid", "rotated-key"))));
        assertEquals("KEY_NOT_FOUND", error.code);
    }

    @Test public void usesRfc7636S256Challenge() throws Exception {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", HiroshiAuth.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
    }

    @Test public void acceptsOnlyExactOneTimeLoopbackCallbackShape() throws Exception {
        Map<String, String> result = HiroshiAuth.parseCallback("/auth/callback?state=expected&code=opaque%2Bcode&client_id=oaiapp_test", "expected");
        assertEquals("opaque+code", result.get("code"));
        for (String bad : new String[]{"/callback?state=expected&code=x", "/auth/callback?state=wrong&code=x", "/auth/callback?code=x",
                "/auth/callback?state=expected&state=expected&code=x", "/auth/callback?state=expected&code=x&code=y",
                "/auth/callback?state=expected&code=x#fragment", "http://attacker.invalid/auth/callback?state=expected&code=x",
                "/auth/callback?state=expected"}) {
            assertThrows(HiroshiAuth.AuthException.class, () -> HiroshiAuth.parseCallback(bad, "expected"));
        }
    }

    @Test public void deniedConsentCannotBecomeAnAuthenticatedCallback() throws Exception {
        HiroshiAuth.AuthException denied = assertThrows(HiroshiAuth.AuthException.class, () -> HiroshiAuth.parseCallback("/auth/callback?state=expected&error=access_denied&code=x", "expected"));
        assertEquals("ACCESS_DENIED", denied.code);
        assertFalse(denied.getMessage().contains("code=x"));
    }
}
