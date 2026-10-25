package io.github.erendragneel.hiroshi;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Native-only storage. The manifest must disable backup for this application. */
public final class SecureSessionStore {
    private static final String ALIAS = "io.github.erendragneel.hiroshi.session.v1";
    private static final byte[] AAD = ALIAS.getBytes(StandardCharsets.UTF_8);
    private final SharedPreferences preferences;
    interface KeySource { SecretKey get() throws GeneralSecurityException, IOException; }
    private final KeySource keys;

    public SecureSessionStore(Context context) { this(context,null); }
    SecureSessionStore(Context context, KeySource keySource) {
        preferences = context.getApplicationContext().getSharedPreferences("hiroshi_secure_session_v1", Context.MODE_PRIVATE);
        keys=keySource==null?this::androidKey:keySource;
    }

    private SecretKey key() throws GeneralSecurityException, IOException { return keys.get(); }
    private SecretKey androidKey() throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }

    public synchronized JSONObject read() throws GeneralSecurityException, IOException, JSONException {
        String encrypted = preferences.getString("record", null);
        if (encrypted == null) return new JSONObject();
        String[] parts = encrypted.split("\\.", -1);
        if (parts.length != 3 || !"v1".equals(parts[0])) throw new GeneralSecurityException("Unreadable saved session");
        try {
            byte[] iv = Base64.getDecoder().decode(parts[1]);
            byte[] body = Base64.getDecoder().decode(parts[2]);
            if (iv.length != 12 || body.length < 16 || body.length > 262144) throw new GeneralSecurityException("Unreadable saved session");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            cipher.updateAAD(AAD);
            return new JSONObject(new String(cipher.doFinal(body), StandardCharsets.UTF_8));
        } catch (IllegalArgumentException e) { throw new GeneralSecurityException("Unreadable saved session"); }
    }

    /** One ciphertext and synchronous commit keep rotating credentials atomic. */
    public synchronized void write(JSONObject record) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(AAD);
        byte[] plaintext = record.toString().getBytes(StandardCharsets.UTF_8);
        if (plaintext.length > 200000) throw new IOException("Session is too large");
        String encoded = "v1." + Base64.getEncoder().encodeToString(cipher.getIV()) + "."
                + Base64.getEncoder().encodeToString(cipher.doFinal(plaintext));
        if (!preferences.edit().putString("record", encoded).commit()) throw new IOException("Session could not be saved");
    }

    public synchronized String hostId() throws GeneralSecurityException, IOException, JSONException {
        JSONObject record = read();
        String host = record.optString("host_id", "");
        if (host.isEmpty()) {
            host = "urn:uuid:" + UUID.randomUUID();
            record.put("host_id", host);
            write(record);
        }
        return host;
    }

    /** Preserve the installation and account/client mapping, never renewable credentials. */
    public synchronized void clearCredentials() throws GeneralSecurityException, IOException, JSONException {
        JSONObject previous = read();
        JSONObject retained = new JSONObject();
        for (String name : new String[]{"host_id", "client_id", "pending_client_id", "subject", "issuer", "email", "display_name", "plan_enabled", "scope"}) {
            if (previous.has(name)) retained.put(name, previous.get(name));
        }
        write(retained);
    }
}
