package com.devcedrick.nexoraaidrama;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NexoraUpdater")
public class NexoraUpdaterPlugin extends Plugin {
    private static final String PREFS = "nexora_native_updater";
    private static final String DOWNLOAD_ID = "download_id";
    private static final String INSTALL_LAUNCHED = "install_launched";

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url", "").trim();
        Uri uri = Uri.parse(rawUrl);
        String path = uri.getPath() == null ? "" : uri.getPath();
        if (!"https".equalsIgnoreCase(uri.getScheme())
                || !"github.com".equalsIgnoreCase(uri.getHost())
                || uri.getUserInfo() != null
                || uri.getPort() != -1
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

        try {
            DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("Android download service is unavailable.");

            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            long previousId = prefs.getLong(DOWNLOAD_ID, -1L);
            if (previousId > 0) manager.remove(previousId);

            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle("NEXORA AI DRAMA update");
            request.setDescription("Downloading the official signed update package");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS,
                    "NEXORA-AI-DRAMA-update.apk");

            long id = manager.enqueue(request);
            prefs.edit().putLong(DOWNLOAD_ID, id).putBoolean(INSTALL_LAUNCHED, false).apply();
            JSObject result = new JSObject();
            result.put("status", "downloading");
            result.put("downloadId", id);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not start the Android update download.", error);
        }
    }

    @PluginMethod
    public void installDownloadedApk(PluginCall call) {
        long downloadId = call.getLong("downloadId", -1L);
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (downloadId <= 0 || downloadId != prefs.getLong(DOWNLOAD_ID, -2L)) {
            call.reject("Unknown NEXORA update download.");
            return;
        }
        if (prefs.getBoolean(INSTALL_LAUNCHED, false)) {
            JSObject already = new JSObject();
            already.put("status", "installer_already_opened");
            call.resolve(already);
            return;
        }
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("Android download service is unavailable.");
            return;
        }
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (android.database.Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()
                    || cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) != DownloadManager.STATUS_SUCCESSFUL) {
                call.reject("The NEXORA APK download is not complete yet.");
                return;
            }
            Uri apkUri = manager.getUriForDownloadedFile(downloadId);
            if (apkUri == null) {
                call.reject("Android could not locate the downloaded NEXORA APK.");
                return;
            }
            prefs.edit().putBoolean(INSTALL_LAUNCHED, true).commit();
            try {
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(apkUri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                context.startActivity(install);
                android.app.NotificationManager notifications = (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (notifications != null) notifications.cancel(26010);
                JSObject result = new JSObject();
                result.put("status", "installer_opened");
                call.resolve(result);
            } catch (Exception launchError) {
                prefs.edit().putBoolean(INSTALL_LAUNCHED, false).commit();
                throw launchError;
            }
        } catch (Exception error) {
            call.reject("Could not open the Android installer for the NEXORA update.", error);
        }
    }

    @PluginMethod
    public void getDownloadStatus(PluginCall call) {
        long downloadId = call.getLong("downloadId", -1L);
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (downloadId <= 0 || downloadId != prefs.getLong(DOWNLOAD_ID, -2L)) {
            call.reject("Unknown NEXORA update download.");
            return;
        }
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("Android download service is unavailable.");
            return;
        }
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (android.database.Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                call.reject("NEXORA update download was not found.");
                return;
            }
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            int progress = total > 0 ? (int) Math.min(100L, downloaded * 100L / total) : 0;
            String state;
            if (status == DownloadManager.STATUS_SUCCESSFUL) state = "completed";
            else if (status == DownloadManager.STATUS_FAILED) state = "failed";
            else if (status == DownloadManager.STATUS_PAUSED) state = "paused";
            else state = "downloading";
            JSObject result = new JSObject();
            result.put("status", state);
            result.put("progress", progress);
            result.put("downloadedBytes", downloaded);
            result.put("totalBytes", total);
            if (status == DownloadManager.STATUS_FAILED) {
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                result.put("reason", reason);
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not read NEXORA update download progress.", error);
        }
    }

}
