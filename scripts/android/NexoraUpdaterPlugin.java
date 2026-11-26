package com.devcedrick.nexoraaidrama;

import android.content.Context;
import android.content.Intent;
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
            boolean sameUpdate = rawUrl.equals(previousUrl);
            if (sameUpdate && "downloading".equals(current)) {
                JSObject result = new JSObject();
                result.put("status", current);
                result.put("downloadId", ACTIVE_DOWNLOAD_ID);
                call.resolve(result);
                return;
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
            File target = new File(context.getExternalFilesDir(null), "NEXORA-AI-DRAMA-update.apk");
            File temp = new File(context.getCacheDir(), "NEXORA-AI-DRAMA-update.apk.part");
            if (target.exists()) target.delete();
            if (temp.exists()) temp.delete();
            prefs.edit().putLong(DOWNLOAD_ID, ACTIVE_DOWNLOAD_ID)
                    .putString(STATUS, "downloading").putString(DOWNLOAD_URL, rawUrl).putLong(DOWNLOADED, 0)
                    .putLong(TOTAL, 0).putString(APK_PATH, "").putString(ERROR, "")
                    .putBoolean(INSTALL_LAUNCHED, false).apply();
            EXECUTOR.execute(() -> downloadApk(rawUrl, target, temp, prefs));
        }
        JSObject result = new JSObject();
        result.put("status", "downloading");
        result.put("downloadId", ACTIVE_DOWNLOAD_ID);
        call.resolve(result);
    }

    private void downloadApk(String rawUrl, File target, File temp, SharedPreferences prefs) {
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
            URL finalUrl = connection.getURL();
            if (response < 200 || response >= 300 || !"https".equalsIgnoreCase(finalUrl.getProtocol())
                    || !("github.com".equalsIgnoreCase(finalUrl.getHost())
                    || "release-assets.githubusercontent.com".equalsIgnoreCase(finalUrl.getHost())
                    || finalUrl.getHost().endsWith(".githubusercontent.com"))) {
                throw new IllegalStateException("The official release server returned an invalid response.");
            }
            long total = connection.getContentLengthLong();
            if (total <= 0 || total > MAX_APK_BYTES) {
                throw new IllegalStateException("The update package size is invalid.");
            }
            prefs.edit().putLong(TOTAL, total).apply();
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(temp)) {
                byte[] buffer = new byte[64 * 1024];
                long count = 0;
                long lastSavedBytes = 0;
                long lastSavedAt = System.currentTimeMillis();
                int read;
                while ((read = input.read(buffer)) != -1) {
                    count += read;
                    if (count > MAX_APK_BYTES || count > total) {
                        throw new IllegalStateException("The update package exceeded its expected size.");
                    }
                    output.write(buffer, 0, read);
                    long now = System.currentTimeMillis();
                    if (count - lastSavedBytes >= 256L * 1024L || now - lastSavedAt >= 500L) {
                        prefs.edit().putLong(DOWNLOADED, count).apply();
                        lastSavedBytes = count;
                        lastSavedAt = now;
                    }
                }
                output.flush();
                prefs.edit().putLong(DOWNLOADED, count).apply();
                if (count != total) throw new IllegalStateException("The update download was incomplete.");
            }
            try (FileInputStream input = new FileInputStream(temp)) {
                byte[] signature = new byte[4];
                if (input.read(signature) != 4 || signature[0] != 'P' || signature[1] != 'K') {
                    throw new IllegalStateException("The downloaded file is not a valid APK archive.");
                }
            }
            android.content.pm.PackageManager packageManager = context.getPackageManager();
            android.content.pm.PackageInfo candidate = packageManager.getPackageArchiveInfo(temp.getAbsolutePath(), 0);
            if (candidate == null || !context.getPackageName().equals(candidate.packageName)) {
                throw new IllegalStateException("The downloaded APK is not the official NEXORA AI DRAMA package.");
            }
            android.content.pm.PackageInfo installed = packageManager.getPackageInfo(context.getPackageName(), 0);
            long candidateVersion = Build.VERSION.SDK_INT >= 28
                    ? candidate.getLongVersionCode() : candidate.versionCode;
            long installedVersion = Build.VERSION.SDK_INT >= 28
                    ? installed.getLongVersionCode() : installed.versionCode;
            if (candidateVersion <= installedVersion) {
                throw new IllegalStateException("This APK is not newer than the installed NEXORA version.");
            }
            if (target.exists() && !target.delete()) throw new IllegalStateException("Could not replace the previous update file.");
            if (!temp.renameTo(target)) throw new IllegalStateException("Could not finalize the downloaded update.");
            prefs.edit().putLong(DOWNLOADED, total).putString(APK_PATH, target.getAbsolutePath())
                    .putString(STATUS, "completed").apply();
        } catch (Exception error) {
            temp.delete();
            prefs.edit().putString(STATUS, "failed").putString(ERROR, error.getMessage() == null ? "Unknown download error" : error.getMessage()).apply();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    @PluginMethod
    public void getDownloadStatus(PluginCall call) {
        long id = call.getLong("downloadId", -1L);
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (id != ACTIVE_DOWNLOAD_ID || id != prefs.getLong(DOWNLOAD_ID, -2L)) {
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
        long id = call.getLong("downloadId", -1L);
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (id != ACTIVE_DOWNLOAD_ID || id != prefs.getLong(DOWNLOAD_ID, -2L)
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
