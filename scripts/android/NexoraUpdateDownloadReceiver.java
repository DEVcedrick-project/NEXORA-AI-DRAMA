package com.devcedrick.nexoraaidrama;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.os.Build;
import android.net.Uri;
import android.database.Cursor;

public final class NexoraUpdateDownloadReceiver extends BroadcastReceiver {
    private static final String PREFS = "nexora_native_updater";
    private static final String DOWNLOAD_ID = "download_id";
    private static final String INSTALL_LAUNCHED = "install_launched";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
        long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (completedId == -1L || completedId != prefs.getLong(DOWNLOAD_ID, -2L)
                || prefs.getBoolean(INSTALL_LAUNCHED, false)) return;

        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return;
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(completedId);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) return;
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status != DownloadManager.STATUS_SUCCESSFUL) return;
            Uri apkUri = manager.getUriForDownloadedFile(completedId);
            if (apkUri == null) return;

            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apkUri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);

            // Background receivers must not launch activities directly on modern Android.
            // A NEXORA notification opens the installer when the user taps it.
            String channelId = "nexora_update_ready";
            NotificationManager notifications =
                    (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (notifications == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                        channelId, "NEXORA updates", NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Alerts when a NEXORA update is ready to install");
                notifications.createNotificationChannel(channel);
            }
            PendingIntent pendingInstall = PendingIntent.getActivity(
                    context, (int) (completedId & 0x7fffffff), install,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(context, channelId)
                    : new Notification.Builder(context);
            builder.setSmallIcon(context.getApplicationInfo().icon)
                    .setContentTitle("NEXORA update is ready")
                    .setContentText("Tap here to install the latest version.")
                    .setContentIntent(pendingInstall)
                    .setAutoCancel(true)
                    .setCategory(Notification.CATEGORY_STATUS)
                    .setPriority(Notification.PRIORITY_HIGH);
            notifications.notify(26010, builder.build());
        } catch (Exception ignored) {
            prefs.edit().putBoolean(INSTALL_LAUNCHED, false).commit();
            // Android owns the final installation confirmation and result.
        }
    }
}
