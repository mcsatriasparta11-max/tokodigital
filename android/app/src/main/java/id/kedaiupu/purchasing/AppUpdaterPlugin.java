package id.kedaiupu.purchasing;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private final java.util.concurrent.ExecutorService executor = Executors.newSingleThreadExecutor();
    @Override protected void handleOnDestroy() { executor.shutdownNow(); }
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private File apkFile() { return new File(getContext().getCacheDir(), "app-updates/update.apk"); }
    private String hex(byte[] data) { StringBuilder out = new StringBuilder(); for (byte b : data) out.append(String.format("%02x", b & 255)); return out.toString(); }
    private String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) { byte[] b = new byte[65536]; int n; while ((n = in.read(b)) != -1) digest.update(b, 0, n); }
        return hex(digest.digest());
    }
    private long version(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    private int signatureFlags() { return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES; }
    private Set<String> signers(PackageInfo info) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28 ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        if (signatures == null || signatures.length == 0) throw new Exception("Tanda tangan APK tidak tersedia.");
        Set<String> result = new HashSet<>(); for (Signature signature : signatures) result.add(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()))); return result;
    }
    private void verify(File file, String sha, long expectedVersion) throws Exception {
        if (!file.isFile() || !hash(file).equalsIgnoreCase(sha)) throw new Exception("Berkas pembaruan tidak lengkap atau berubah. Unduh ulang.");
        PackageManager pm = getContext().getPackageManager();
        PackageInfo candidate = pm.getPackageArchiveInfo(file.getAbsolutePath(), signatureFlags());
        PackageInfo current = pm.getPackageInfo(getContext().getPackageName(), signatureFlags());
        if (candidate == null || !getContext().getPackageName().equals(candidate.packageName)) throw new Exception("APK bukan aplikasi Kedai UPU.");
        if (version(candidate) != expectedVersion || version(candidate) <= version(current)) throw new Exception("Versi pembaruan tidak sesuai.");
        if (!signers(candidate).equals(signers(current))) throw new Exception("Tanda tangan pembaruan berbeda dari aplikasi yang terpasang.");
    }
    private boolean allowed(URL url, boolean initial) {
        if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443)) return false;
        if ("github.com".equals(url.getHost())) return url.getPath().startsWith("/mcsatriasparta11-max/tokodigital/releases/download/");
        return !initial && "release-assets.githubusercontent.com".equals(url.getHost());
    }
    @PluginMethod public void download(PluginCall call) {
        String url = call.getString("url"), sha = call.getString("sha256"); Integer expected = call.getInt("versionCode");
        try { if (url == null || sha == null || !sha.matches("[a-fA-F0-9]{64}") || expected == null || expected < 1 || !allowed(new URL(url), true)) throw new Exception(); }
        catch (Exception e) { call.reject("Sumber pembaruan tidak valid."); return; }
        if (!downloading.compareAndSet(false, true)) { call.reject("Pembaruan sedang diunduh."); return; }
        executor.execute(() -> {
            File file = apkFile(), partial = new File(file.getParentFile(), "update.part"); HttpURLConnection connection = null;
            try {
                if (!file.getParentFile().exists() && !file.getParentFile().mkdirs()) throw new Exception("Penyimpanan belum tersedia.");
                boolean cached = file.isFile() && hash(file).equalsIgnoreCase(sha);
                if (!cached) {
                    URL next = new URL(url);
                    for (int redirects = 0; redirects < 6; redirects++) {
                        if (!allowed(next, redirects == 0)) throw new Exception("Alamat unduhan tidak diizinkan.");
                        connection = (HttpURLConnection) next.openConnection(); connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(30000);
                        int status = connection.getResponseCode();
                        if (status >= 300 && status < 400) { String location = connection.getHeaderField("Location"); if (location == null) throw new Exception("Alamat unduhan tidak tersedia."); next = new URL(next, location); connection.disconnect(); connection = null; continue; }
                        if (status != 200) throw new Exception("Unduhan gagal. Periksa koneksi dan coba lagi.");
                        break;
                    }
                    if (connection == null) throw new Exception("Terlalu banyak pengalihan unduhan.");
                    long total = connection.getContentLengthLong(), count = 0, last = 0;
                    if (total > 104857600) throw new Exception("Berkas pembaruan terlalu besar.");
                    try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(partial)) {
                        byte[] buffer = new byte[65536]; int n;
                        while ((n = in.read(buffer)) != -1) {
                            count += n; if (count > 104857600) throw new Exception("Berkas pembaruan terlalu besar."); out.write(buffer, 0, n);
                            long now = System.currentTimeMillis(); if (now - last > 500) { JSObject progress = new JSObject(); progress.put("percent", total > 0 ? (int)(count * 100 / total) : -1); notifyListeners("progress", progress); last = now; }
                        }
                    }
                    verify(partial, sha, expected);
                    if (file.exists() && !file.delete()) throw new Exception("Berkas lama belum dapat diganti.");
                    if (!partial.renameTo(file)) throw new Exception("Berkas pembaruan belum dapat disimpan.");
                }
                verify(file, sha, expected);
                getContext().getSharedPreferences("upu-updater", 0).edit().putString("sha", sha).putLong("version", expected).apply();
                call.resolve(new JSObject().put("ready", true));
            } catch (Exception e) { partial.delete(); call.reject(e.getMessage() == null ? "Pembaruan gagal diunduh." : e.getMessage()); }
            finally { if (connection != null) connection.disconnect(); downloading.set(false); }
        });
    }
    @PluginMethod public void install(PluginCall call) {
        if (downloading.get()) { call.reject("Tunggu unduhan selesai."); return; }
        executor.execute(() -> {
            try {
                android.content.SharedPreferences prefs = getContext().getSharedPreferences("upu-updater", 0);
                verify(apkFile(), prefs.getString("sha", ""), prefs.getLong("version", 0));
                if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) { call.resolve(new JSObject().put("needsPermission", true)); return; }
                getActivity().runOnUiThread(() -> {
                    try {
                        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apkFile());
                        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        getActivity().startActivity(intent); call.resolve(new JSObject().put("opened", true));
                    } catch (Exception e) { call.reject("Pemasang Android belum dapat dibuka."); }
                });
            } catch (Exception e) { call.reject(e.getMessage()); }
        });
    }
    @PluginMethod public void openSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))); call.resolve(); }
            catch (Exception e) { call.reject("Pengaturan izin belum dapat dibuka."); }
        });
    }
}
