package com.devcedrick.nexoraaidrama;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.SharedPreferences;
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
import java.util.Arrays;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NexoraUpdater")
public class NexoraUpdaterPlugin extends Plugin {
    private static final String PREFS = "nexora_native_updater";
    private static final String DOWNLOAD_ID = "download_id";
    private static final String STATUS = "status";
    private static final String DOWNLOADED = "downloaded_bytes";
    private static final String TOTAL = "total_bytes";
    private static final String APK_PATH = "apk_path";
    private static final String DOWNLOAD_URL = "download_url";
    private static final String EXPECTED_SHA256 = "expected_sha256";
    private static final String LAST_ACTIVITY = "last_activity_ms";
    private static final long STALE_DOWNLOAD_MS = 90L * 1000L;
    private static final String ERROR = "error";
    private static final String INSTALL_LAUNCHED = "install_launched";
    private static final long ACTIVE_DOWNLOAD_ID = 1L;
    private static final long MAX_APK_BYTES = 150L * 1024L * 1024L;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Object DOWNLOAD_LOCK = new Object();

    @PluginMethod
    public void checkInstallPermission(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < 26
                || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url", "").trim();
        String expectedSha256 = call.getString("sha256", "").trim().toLowerCase(Locale.ROOT);
        if (!expectedSha256.matches("[a-f0-9]{64}")) {
            call.reject("The update manifest is missing a valid APK SHA-256 checksum. Please refresh the update information.");
            return;
        }
        Uri uri = Uri.parse(rawUrl);
        String path = uri.getPath() == null ? "" : uri.getPath();
        if (!"https".equalsIgnoreCase(uri.getScheme())
                || !"github.com".equalsIgnoreCase(uri.getHost())
                || uri.getUserInfo() != null || uri.getPort() != -1
                || !path.matches("/DEVcedrick-project/NEXORA-AI-DRAMA/releases/download/v[0-9]+\\.[0-9]+\\.[0-9]+/NEXORA-AI-DRAMA-release\\.apk")) {
            call.reject("Update URL is not an official NEXORA release APK.");
            return;
        }

        Context context = getContext();
        if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + context.getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(settings);
            JSObject result = new JSObject();
            result.put("status", "permission_required");
            call.resolve(result);
            return;
        }

        synchronized (DOWNLOAD_LOCK) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String current = prefs.getString(STATUS, "");
            String previousUrl = prefs.getString(DOWNLOAD_URL, "");
            String previousHash = prefs.getString(EXPECTED_SHA256, "");
            boolean sameUpdate = rawUrl.equals(previousUrl) && expectedSha256.equals(previousHash);
            if (sameUpdate && "downloading".equals(current)) {
                long lastActivity = prefs.getLong(LAST_ACTIVITY, 0L);
                if (lastActivity > 0L && System.currentTimeMillis() - lastActivity < STALE_DOWNLOAD_MS) {
                    JSObject result = new JSObject();
                    result.put("status", current);
                    result.put("downloadId", ACTIVE_DOWNLOAD_ID);
                    call.resolve(result);
                    return;
                }
                // Recover a persisted "downloading" state if Android killed the process
                // or the previous transfer stopped making progress.
                prefs.edit().putString(STATUS, "failed")
                        .putString(ERROR, "The previous update download stopped. Tap Update Now to restart it.")
                        .apply();
                current = "failed";
            }
            if (sameUpdate && "completed".equals(current)
                    && new File(prefs.getString(APK_PATH, "")).isFile()) {
                JSObject result = new JSObject();
                result.put("status", current);
                result.put("downloadId", ACTIVE_DOWNLOAD_ID);
                call.resolve(result);
                return;
            }
            if ("downloading".equals(current)) {
                call.reject("A different NEXORA update is already downloading. Please wait for it to finish.");
                return;
            }
            File updateDirectory = context.getExternalFilesDir(null);
            if (updateDirectory == null) {
                call.reject("Android could not access the private update storage.");
                return;
            }
            if (!updateDirectory.exists() && !updateDirectory.mkdirs()) {
                call.reject("Android could not create the private update storage.");
                return;
            }
            File target = new File(updateDirectory, "NEXORA-AI-DRAMA-update.apk");
            // Keep the partial download beside the final APK. File.renameTo() is
            // not reliable across Android cache/external-files filesystems.
            File temp = new File(updateDirectory, "NEXORA-AI-DRAMA-update.apk.part");
            if (target.exists() && !target.delete()) {
                call.reject("Could not clear the previous update package.");
                return;
            }
            if (temp.exists() && !temp.delete()) {
                call.reject("Could not clear the incomplete update package.");
                return;
            }
            prefs.edit().putLong(DOWNLOAD_ID, ACTIVE_DOWNLOAD_ID)
                    .putString(STATUS, "downloading").putString(DOWNLOAD_URL, rawUrl).putString(EXPECTED_SHA256, expectedSha256).putLong(DOWNLOADED, 0)
                    .putLong(TOTAL, 0).putString(APK_PATH, "").putString(ERROR, "")
                    .putLong(LAST_ACTIVITY, System.currentTimeMillis())
                    .putBoolean(INSTALL_LAUNCHED, false).apply();
            EXECUTOR.execute(() -> downloadApk(context, rawUrl, expectedSha256, target, temp, prefs));
        }
        JSObject result = new JSObject();
        result.put("status", "downloading");
        result.put("downloadId", ACTIVE_DOWNLOAD_ID);
        call.resolve(result);
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024]; int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        StringBuilder hex = new StringBuilder(64);
        for (byte value : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return hex.toString();
    }

    private static void verifyApkArchive(File apk) throws Exception {
        boolean hasManifest = false;
        try (ZipFile zip = new ZipFile(apk)) {
            java.util.Enumeration<? extends ZipEntry> entries = zip.entries();
            byte[] buffer = new byte[32 * 1024];
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if ("AndroidManifest.xml".equals(entry.getName())) hasManifest = true;
                if (entry.isDirectory()) continue;
                try (InputStream input = zip.getInputStream(entry)) { while (input.read(buffer) != -1) {} }
            }
        }
        if (!hasManifest) throw new IllegalStateException("The downloaded archive has no Android manifest.");
    }

    private static PackageInfo validateUpdateApk(Context context, File apk, String expectedSha256) throws Exception {
        if (apk.length() < 1024L * 1024L) throw new IllegalStateException("The downloaded APK is unexpectedly small and may be incomplete.");
        if (!expectedSha256.matches("[a-f0-9]{64}") || !expectedSha256.equals(sha256(apk)))
            throw new IllegalStateException("The downloaded APK checksum does not match the official release. The file was rejected.");
        verifyApkArchive(apk);
        PackageManager pm = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28
                ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo candidate = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (candidate == null || !context.getPackageName().equals(candidate.packageName)) {
            throw new IllegalStateException("The downloaded APK is not the official NEXORA AI DRAMA package.");
        }
        PackageInfo installed = pm.getPackageInfo(context.getPackageName(), flags);
        boolean sameSigner;
        if (Build.VERSION.SDK_INT >= 28) {
            sameSigner = candidate.signingInfo != null && installed.signingInfo != null
                    && Arrays.equals(candidate.signingInfo.getApkContentsSigners(),
                                     installed.signingInfo.getApkContentsSigners());
        } else {
            sameSigner = candidate.signatures != null && installed.signatures != null
                    && Arrays.equals(candidate.signatures, installed.signatures);
        }
        if (!sameSigner) {
            throw new IllegalStateException("This update was signed with a different key. Installation was blocked to protect your app and data.");
        }
        long candidateVersion = Build.VERSION.SDK_INT >= 28
                ? candidate.getLongVersionCode() : candidate.versionCode;
        long installedVersion = Build.VERSION.SDK_INT >= 28
                ? installed.getLongVersionCode() : installed.versionCode;
        if (candidateVersion <= installedVersion) {
            throw new IllegalStateException("This APK is not newer than the installed NEXORA version.");
        }
        return candidate;
    }

    private void downloadApk(Context context, String rawUrl, String expectedSha256, File target, File temp, SharedPreferences prefs) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(rawUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", "NEXORA-AI-DRAMA-Updater");
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
            int response = connection.getResponseCode();
            prefs.edit().putLong(LAST_ACTIVITY, System.currentTimeMillis()).apply();
            URL finalUrl = connection.getURL();
            if (response < 200 || response >= 300 || !"https".equalsIgnoreCase(finalUrl.getProtocol())
                    || !("github.com".equalsIgnoreCase(finalUrl.getHost())
                    || "release-assets.githubusercontent.com".equalsIgnoreCase(finalUrl.getHost())
                    || finalUrl.getHost().endsWith(".githubusercontent.com"))) {
                throw new IllegalStateException("The official release server returned an invalid response.");
            }
            // GitHub/CDN may use chunked transfer and omit Content-Length.
            // Unknown size is valid; enforce the hard byte limit while streaming.
            long total = connection.getContentLengthLong();
            if (total > MAX_APK_BYTES) {
                throw new IllegalStateException("The update package is larger than the allowed limit.");
            }
            prefs.edit().putLong(TOTAL, Math.max(0L, total)).apply();
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(temp)) {
                byte[] buffer = new byte[64 * 1024];
                long count = 0;
                long lastSavedBytes = 0;
                long lastSavedAt = System.currentTimeMillis();
                int read;
                while ((read = input.read(buffer)) != -1) {
                    count += read;
                    if (count > MAX_APK_BYTES || (total > 0 && count > total)) {
                        throw new IllegalStateException("The update package exceeded its expected size.");
                    }
                    output.write(buffer, 0, read);
                    long now = System.currentTimeMillis();
                    if (count - lastSavedBytes >= 256L * 1024L || now - lastSavedAt >= 500L) {
                        prefs.edit().putLong(DOWNLOADED, count)
                                .putLong(LAST_ACTIVITY, now).apply();
                        lastSavedBytes = count;
                        lastSavedAt = now;
                    }
                }
                output.flush();
                output.getFD().sync();
                prefs.edit().putLong(DOWNLOADED, count)
                        .putLong(LAST_ACTIVITY, System.currentTimeMillis()).apply();
                if (total > 0 && count != total) throw new IllegalStateException("The update download was incomplete.");
                total = count;
                prefs.edit().putLong(TOTAL, total).apply();
            }
            try (FileInputStream input = new FileInputStream(temp)) {
                byte[] signature = new byte[4];
                if (input.read(signature) != 4 || signature[0] != 'P' || signature[1] != 'K') {
                    throw new IllegalStateException("The downloaded file is not a valid APK archive.");
                }
            }
            validateUpdateApk(context, temp, expectedSha256);
            if (target.exists() && !target.delete()) throw new IllegalStateException("Could not replace the previous update file.");
            // Both files now live in the same directory/filesystem, so this
            // finalization is an atomic rename on supported Android filesystems.
            if (!temp.renameTo(target)) throw new IllegalStateException("Could not finalize the downloaded update.");
            prefs.edit().putLong(DOWNLOADED, total).putString(APK_PATH, target.getAbsolutePath())
                    .putLong(LAST_ACTIVITY, System.currentTimeMillis())
                    .putString(STATUS, "completed").apply();
        } catch (Exception error) {
            temp.delete();
            prefs.edit().putLong(LAST_ACTIVITY, System.currentTimeMillis())
                    .putString(STATUS, "failed").putString(ERROR, error.getMessage() == null ? "Unknown download error" : error.getMessage()).apply();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    @PluginMethod
    public void getDownloadStatus(PluginCall call) {
        // Only one native update slot exists. Do not trust a JavaScript numeric
        // argument here: Capacitor versions can deserialize it as a different
        // Number subtype and make getLong() return its fallback value.
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long storedId = prefs.getLong(DOWNLOAD_ID, -2L);
        if (storedId != ACTIVE_DOWNLOAD_ID) {
            call.reject("Unknown NEXORA update download.");
            return;
        }
        long downloaded = prefs.getLong(DOWNLOADED, 0);
        long total = prefs.getLong(TOTAL, 0);
        String status = prefs.getString(STATUS, "failed");
        JSObject result = new JSObject();
        result.put("status", status);
        result.put("progress", total > 0 ? Math.min(100L, downloaded * 100L / total) : 0);
        result.put("downloadedBytes", downloaded);
        result.put("totalBytes", total);
        result.put("reason", prefs.getString(ERROR, ""));
        call.resolve(result);
    }

    @PluginMethod
    public void resetInstallLaunchState(PluginCall call) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(INSTALL_LAUNCHED, false).apply();
        call.resolve();
    }

    @PluginMethod
    public void installDownloadedApk(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        // As above, validate the persisted single-download slot rather than a
        // JS numeric argument, so status and installer handoff use the same ID.
        if (prefs.getLong(DOWNLOAD_ID, -2L) != ACTIVE_DOWNLOAD_ID
                || !"completed".equals(prefs.getString(STATUS, ""))) {
            call.reject("The NEXORA APK download is not complete.");
            return;
        }
        if (prefs.getBoolean(INSTALL_LAUNCHED, false)) {
            JSObject alreadyOpen = new JSObject();
            alreadyOpen.put("status", "installer_already_opened");
            call.resolve(alreadyOpen);
            return;
        }
        String path = prefs.getString(APK_PATH, "");
        File apk = new File(path);
        if (!apk.isFile() || apk.length() <= 0) {
            call.reject("The downloaded NEXORA APK could not be found.");
            return;
        }
        try {
            validateUpdateApk(context, apk, prefs.getString(EXPECTED_SHA256, ""));
            Uri apkUri = FileProvider.getUriForFile(context,
                    context.getPackageName() + ".nexora-updater.fileprovider", apk);
            Intent install = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            install.setData(apkUri);
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            install.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
            context.startActivity(install);
            prefs.edit().putBoolean(INSTALL_LAUNCHED, true).commit();
            JSObject result = new JSObject();
            result.put("status", "installer_opened");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not open Android's package installer.", error);
        }
    }
}
