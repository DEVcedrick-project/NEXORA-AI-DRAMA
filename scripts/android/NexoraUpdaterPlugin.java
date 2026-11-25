package com.devcedrick.nexoraaidrama;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
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
    private BroadcastReceiver downloadReceiver;

    @Override
    public void load() {
        super.load();
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
                long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                if (completedId == -1L || completedId != prefs.getLong(DOWNLOAD_ID, -2L)) return;

                DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
                DownloadManager.Query query = new DownloadManager.Query().setFilterById(completedId);
                try (android.database.Cursor cursor = manager.query(query)) {
                    if (cursor == null || !cursor.moveToFirst()) return;
                    int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    if (status != DownloadManager.STATUS_SUCCESSFUL) return;
                    Uri apkUri = manager.getUriForDownloadedFile(completedId);
                    if (apkUri == null) return;

                    Intent install = new Intent(Intent.ACTION_VIEW);
                    install.setDataAndType(apkUri, "application/vnd.android.package-archive");
                    install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    context.startActivity(install);
                } catch (Exception ignored) {
                    // Android's installer owns the final installation result and confirmation.
                }
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            getContext().registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(downloadReceiver, filter);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String rawUrl = call.getString("url", "");
        Uri uri;
        try {
            uri = Uri.parse(rawUrl);
        } catch (Exception error) {
            call.reject("Invalid update URL.");
            return;
        }

        String path = uri.getPath() == null ? "" : uri.getPath();
        if (!"https".equalsIgnoreCase(uri.getScheme())
                || !"github.com".equalsIgnoreCase(uri.getHost())
                || !path.startsWith("/DEVcedrick-project/NEXORA-AI-DRAMA/releases/download/")
                || !path.endsWith("/NEXORA-AI-DRAMA-release.apk")) {
            call.reject("Update URL is not an official NEXORA release APK.");
            return;
        }

        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            JSObject result = new JSObject();
            result.put("status", "permission_required");
            call.resolve(result);
            return;
        }

        try {
            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle("NEXORA AI DRAMA update");
            request.setDescription("Downloading the official signed update package");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS,
                    "NEXORA-AI-DRAMA-update.apk");
            long id = manager.enqueue(request);
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putLong(DOWNLOAD_ID, id).apply();
            JSObject result = new JSObject();
            result.put("status", "downloading");
            result.put("downloadId", id);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not start the Android update download.", error);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (downloadReceiver != null) {
            try { getContext().unregisterReceiver(downloadReceiver); } catch (Exception ignored) {}
            downloadReceiver = null;
        }
        super.handleOnDestroy();
    }
}
