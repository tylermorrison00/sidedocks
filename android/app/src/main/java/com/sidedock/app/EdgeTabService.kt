package com.sidedock.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.core.app.NotificationCompat

// Floating edge tab shown over ALL apps (system overlay).
// The tab itself is only a thin strip; dragging it left opens Side Dock.
// Tap does nothing, same as the in-app strip. Started/stopped from
// Settings ("Edge tab") and restarted on boot when it was left on.
class EdgeTabService : Service() {
    private var windowManager: WindowManager? = null
    private var tabView: View? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIF_ID, buildNotification())
        showTab()
    }

    private fun buildNotification(): Notification {
        val channelId = "sidedock_edge_tab"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "Side Dock edge tab", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
        val openIntent = Intent(this, MainActivity::class.java)
        val pending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("Side Dock")
            .setContentText("Edge tab is on — drag it to open Side Dock")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pending)
            .setOngoing(true)
            .build()
    }

    private fun showTab() {
        if (tabView != null) return
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        // 38dp wide invisible grab area; the visible strip is 6dp at its right edge.
        val container = FrameLayout(this)
        val strip = View(this)
        strip.setBackgroundColor(Color.parseColor("#1A2947"))
        val stripParams = FrameLayout.LayoutParams(6.dpToPx(), 120.dpToPx()).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }
        container.addView(strip, stripParams)
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val params = WindowManager.LayoutParams(
            38.dpToPx(), 140.dpToPx(), type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }
        var downX = 0f
        var dragDX = 0f
        var moved = false
        container.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    dragDX = 0f
                    moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    dragDX = (event.rawX - downX).coerceAtMost(0f)
                    if (dragDX < -12) moved = true
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (moved && dragDX < -60) {
                        val open = Intent(this, MainActivity::class.java).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        startActivity(open)
                    }
                    true
                }
                else -> false
            }
        }
        tabView = container
        windowManager?.addView(container, params)
    }

    private fun Int.dpToPx(): Int = (this * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        tabView?.let { try { windowManager?.removeView(it) } catch (_: Exception) {} }
        tabView = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val NOTIF_ID = 1001
        const val PREFS = "sidedock_prefs"
        const val KEY_ENABLED = "edge_tab_enabled"

        fun isEnabled(ctx: Context): Boolean =
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

        fun setEnabled(ctx: Context, enabled: Boolean) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
            val intent = Intent(ctx, EdgeTabService::class.java)
            if (enabled) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
                else ctx.startService(intent)
            } else {
                ctx.stopService(intent)
            }
        }
    }
}
