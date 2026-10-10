package net.antinet.ispmanager;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Native bridge used by the web app to talk to the MikroTik router.
 *
 * - request(): HTTP(S) call to the RouterOS REST API. Runs natively, so the
 *   router does not need CORS headers. HTTPS is only allowed with a pinned
 *   certificate fingerprint (trust on first use): routers use self-signed
 *   certificates and are reached by IP, so the pinned SHA-256 is the trust anchor.
 * - probeCertificate(): reads the router certificate so the user can compare
 *   its fingerprint before trusting it. The handshake is aborted on purpose,
 *   so no request and no credentials are ever sent during the probe.
 * - secureSet/secureGet/secureRemove(): small secrets encrypted with an
 *   AES-256-GCM key that lives in the Android Keystore.
 */
@CapacitorPlugin(name = "RouterLink")
public class RouterLinkPlugin extends Plugin {

    private static final int MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final Pattern HOST_PATTERN = Pattern.compile("^[A-Za-z0-9.:\\-]{1,253}$");
    private static final Pattern HEX64 = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern HEADER_NAME = Pattern.compile("^[A-Za-z0-9-]{1,64}$");

    private static final String KEY_ALIAS = "antinet_secrets_v1";
    private static final String PREFS = "antinet_secure";

    private final ExecutorService executor = Executors.newFixedThreadPool(4);

    // ------------------------------------------------------------------ HTTP

    @PluginMethod
    public void request(PluginCall call) {
        final String url = call.getString("url");
        final String method = call.getString("method", "GET");
        final JSObject headers = call.getObject("headers", new JSObject());
        final String body = call.getString("body");
        final int timeoutMs = Math.max(1000, Math.min(call.getInt("timeoutMs", 10000), 120000));
        final String pin = call.getString("pinSha256");
        executor.execute(() -> doRequest(call, url, method, headers, body, timeoutMs, pin));
    }

    private void doRequest(PluginCall call, String url, String method, JSObject headers, String body, int timeoutMs, String pin) {
        HttpURLConnection conn = null;
        try {
            if (url == null) {
                call.reject("missing url", "NETWORK");
                return;
            }
            if (!"GET".equals(method) && !"POST".equals(method)) {
                call.reject("method not allowed", "NETWORK");
                return;
            }
            URL u = new java.net.URI(url).toURL();
            String scheme = u.getProtocol();
            if (!"http".equals(scheme) && !"https".equals(scheme)) {
                call.reject("scheme not allowed", "NETWORK");
                return;
            }
            // The router is on the local network: never route its credentials through a system proxy.
            conn = (HttpURLConnection) u.openConnection(Proxy.NO_PROXY);
            if (conn instanceof HttpsURLConnection) {
                final String expected = normalize(pin);
                if (!HEX64.matcher(expected).matches()) {
                    call.reject("certificate-not-pinned", "TLS");
                    return;
                }
                HttpsURLConnection https = (HttpsURLConnection) conn;
                SSLContext ctx = SSLContext.getInstance("TLS");
                ctx.init(null, new TrustManager[] { new PinnedTrustManager(expected) }, new SecureRandom());
                https.setSSLSocketFactory(ctx.getSocketFactory());
                // Identity comes from the pinned certificate, not the hostname (routers are reached by IP).
                https.setHostnameVerifier((hostname, session) -> {
                    try {
                        Certificate[] chain = session.getPeerCertificates();
                        return chain.length > 0 && pinMatches(chain[0], expected);
                    } catch (Exception e) {
                        return false;
                    }
                });
            }
            conn.setConnectTimeout(Math.min(CONNECT_TIMEOUT_MS, timeoutMs));
            conn.setReadTimeout(timeoutMs);
            conn.setInstanceFollowRedirects(false);
            conn.setUseCaches(false);
            conn.setRequestMethod(method);
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                String v = headers.getString(k);
                if (v == null || !HEADER_NAME.matcher(k).matches() || v.indexOf('\r') >= 0 || v.indexOf('\n') >= 0) continue;
                conn.setRequestProperty(k, v);
            }
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bytes);
                }
            }
            int status = conn.getResponseCode();
            InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = is == null ? "" : readAll(is);
            JSObject out = new JSObject();
            out.put("status", status);
            out.put("body", text);
            call.resolve(out);
        } catch (SocketTimeoutException e) {
            call.reject("timeout", "TIMEOUT");
        } catch (IOException e) {
            if (hasCause(e, PinMismatchException.class)) {
                call.reject("certificate fingerprint changed", "PIN_MISMATCH");
            } else if (e instanceof javax.net.ssl.SSLException) {
                call.reject(String.valueOf(e.getMessage()), "TLS");
            } else {
                call.reject(String.valueOf(e.getMessage()), "NETWORK");
            }
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "NETWORK");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ------------------------------------------------------------------ certificate probe

    @PluginMethod
    public void probeCertificate(PluginCall call) {
        final String host = call.getString("host", "");
        final int port = call.getInt("port", 443);
        executor.execute(() -> doProbe(call, host, port));
    }

    private void doProbe(PluginCall call, String host, int port) {
        if (host == null || !HOST_PATTERN.matcher(host).matches() || port < 1 || port > 65535) {
            call.reject("invalid host", "NETWORK");
            return;
        }
        CapturingTrustManager capture = new CapturingTrustManager();
        try (Socket raw = new Socket(Proxy.NO_PROXY)) {
            raw.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            raw.setSoTimeout(CONNECT_TIMEOUT_MS);
            SSLContext ctx = SSLContext.getInstance("TLS");
            ctx.init(null, new TrustManager[] { capture }, new SecureRandom());
            try (SSLSocket ssl = (SSLSocket) ctx.getSocketFactory().createSocket(raw, host, port, false)) {
                ssl.startHandshake();
            } catch (IOException expected) {
                // CapturingTrustManager always rejects after recording the chain.
            }
            X509Certificate cert = capture.captured;
            if (cert == null) {
                call.reject("no certificate received", "TLS");
                return;
            }
            JSObject out = new JSObject();
            out.put("sha256", sha256Hex(cert.getEncoded()));
            out.put("subject", cert.getSubjectX500Principal().getName());
            out.put("issuer", cert.getIssuerX500Principal().getName());
            out.put("validFrom", iso(cert.getNotBefore()));
            out.put("validTo", iso(cert.getNotAfter()));
            call.resolve(out);
        } catch (SocketTimeoutException e) {
            call.reject("timeout", "TIMEOUT");
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "NETWORK");
        }
    }

    // ------------------------------------------------------------------ secure storage

    @PluginMethod
    public void secureSet(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || value == null) {
            call.reject("missing key or value");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey());
            byte[] ct = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String packed = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
            prefs().edit().putString(key, packed).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("secure storage unavailable: " + e.getMessage());
        }
    }

    @PluginMethod
    public void secureGet(PluginCall call) {
        String key = call.getString("key");
        JSObject out = new JSObject();
        String packed = key == null ? null : prefs().getString(key, null);
        if (packed == null) {
            out.put("value", JSONObject.NULL);
            call.resolve(out);
            return;
        }
        try {
            String[] parts = packed.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            byte[] plain = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
            out.put("value", new String(plain, StandardCharsets.UTF_8));
        } catch (Exception e) {
            // Key was invalidated (e.g. device credentials reset): forget the value.
            prefs().edit().remove(key).apply();
            out.put("value", JSONObject.NULL);
        }
        call.resolve(out);
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        String key = call.getString("key");
        if (key != null) prefs().edit().remove(key).apply();
        call.resolve();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static synchronized SecretKey secretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return gen.generateKey();
    }

    // ------------------------------------------------------------------ helpers

    static final class PinMismatchException extends CertificateException {
        PinMismatchException() {
            super("certificate fingerprint does not match the pinned value");
        }
    }

    /** Accepts exactly one certificate: the one whose SHA-256 the user approved. */
    static final class PinnedTrustManager implements X509TrustManager {
        private final String expected;

        PinnedTrustManager(String expected) {
            this.expected = expected;
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            throw new CertificateException("client certificates are not used");
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            if (chain == null || chain.length == 0) throw new CertificateException("empty certificate chain");
            if (!pinMatches(chain[0], expected)) throw new PinMismatchException();
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }

    /** Records the server certificate, then always refuses it so the handshake stops. */
    static final class CapturingTrustManager implements X509TrustManager {
        volatile X509Certificate captured;

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            throw new CertificateException("client certificates are not used");
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
            if (chain != null && chain.length > 0) captured = chain[0];
            throw new CertificateException("probe only");
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }

    static boolean pinMatches(Certificate cert, String expectedHex) {
        try {
            byte[] actual = sha256Hex(cert.getEncoded()).getBytes(StandardCharsets.US_ASCII);
            return MessageDigest.isEqual(actual, expectedHex.getBytes(StandardCharsets.US_ASCII));
        } catch (Exception e) {
            return false;
        }
    }

    static String sha256Hex(byte[] data) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder(d.length * 2);
        for (byte b : d) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }

    static String normalize(String pin) {
        return pin == null ? "" : pin.replaceAll("[^0-9a-fA-F]", "").toLowerCase(Locale.ROOT);
    }

    static boolean hasCause(Throwable e, Class<? extends Throwable> type) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (type.isInstance(t)) return true;
            if (t.getCause() == t) break;
        }
        return false;
    }

    static String iso(Date d) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.ROOT);
        f.setTimeZone(TimeZone.getDefault());
        return f.format(d);
    }

    static String readAll(InputStream is) throws IOException {
        try (InputStream in = is) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            int total = 0;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > MAX_RESPONSE_BYTES) throw new IOException("response too large");
                bos.write(buf, 0, n);
            }
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
