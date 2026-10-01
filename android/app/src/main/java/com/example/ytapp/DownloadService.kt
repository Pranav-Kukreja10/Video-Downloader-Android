package com.example.ytapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/** Keeps the process alive while a download runs, and shows progress. */
class DownloadService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW)
        )
        ServiceCompat.startForeground(
            this, NOTIF_ID, build(this, 0, "Starting download…"),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        )
        return START_NOT_STICKY
    }

    companion object {
        private const val CHANNEL = "downloads"
        private const val NOTIF_ID = 4242

        private fun build(ctx: Context, progress: Int, text: String): Notification {
            val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            val pi = android.app.PendingIntent.getActivity(
                ctx, 0, open, android.app.PendingIntent.FLAG_IMMUTABLE
            )
            return NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("Aura Downloader")
                .setContentText(text)
                .setProgress(100, progress, progress == 0)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pi)
                .build()
        }

        fun start(ctx: Context) {
            androidx.core.content.ContextCompat.startForegroundService(
                ctx, Intent(ctx, DownloadService::class.java)
            )
        }

        fun update(ctx: Context, progress: Int) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.notify(NOTIF_ID, build(ctx, progress, "Downloading… $progress%"))
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, DownloadService::class.java))
        }
    }
}
