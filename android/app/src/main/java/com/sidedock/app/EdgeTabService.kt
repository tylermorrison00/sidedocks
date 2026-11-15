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
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat

// Floating edge tab shown over ALL apps (system overlay).
// Thin strip -> drag left -> icon rail (bar) floats over the current app.
// Tap a rail icon to open that tool in the app; ">" opens the All tools list.
// Tap does nothing on the strip; app icon click opens the app itself.
// Started/stopped from Settings ("Edge tab") and restarted on boot when on.
class EdgeTabService : Service() {
    private var windowManager: WindowManager? = null
    private var stripView: View? = null
    private var railView: View? = null
    private var scrimView: View? = null
    private var floatingWindow: FloatingToolWindow? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIF_ID, buildNotification())
        showStrip()
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

    private fun overlayType(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
    }

    private fun roundedBg(color: Int, radiusDp: Int, strokeColor: Int): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(color)
            cornerRadius = radiusDp.dpToPx().toFloat()
            setStroke(1.dpToPx(), strokeColor)
        }
    }

    private fun showStrip() {
        if (stripView != null) return
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        // 38dp wide invisible grab area; the visible strip is 6dp at its right edge.
        val container = FrameLayout(this)
        val strip = View(this)
        strip.setBackgroundColor(Color.parseColor("#00D4FF"))
        val stripParams = FrameLayout.LayoutParams(6.dpToPx(), 120.dpToPx()).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }
        container.addView(strip, stripParams)
        val params = WindowManager.LayoutParams(
            38.dpToPx(), 140.dpToPx(), overlayType(),
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
                    if (moved && dragDX < -60) showRail()
                    true
                }
                else -> false
            }
        }
        stripView = container
        windowManager?.addView(container, params)
    }

    private fun hideStrip() {
        stripView?.let { try { windowManager?.removeView(it) } catch (_: Exception) {} }
        stripView = null
    }

    private fun showRail() {
        hideStrip()
        if (railView != null) return
        val wm = windowManager ?: return
        // Transparent full-screen scrim: tap outside closes the rail.
        val scrim = View(this)
        val scrimParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            overlayType(), WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT
        )
        scrim.setOnClickListener { hideRail() }
        scrimView = scrim
        wm.addView(scrim, scrimParams)

        val screenH = resources.displayMetrics.heightPixels
        val railH = minOf((screenH * 0.82).toInt(), 500.dpToPx())
        val rail = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(6.dpToPx(), 14.dpToPx(), 6.dpToPx(), 14.dpToPx())
            background = roundedBg(Color.parseColor("#131E33"), 18, Color.parseColor("#24365A"))
        }
        val railParams = WindowManager.LayoutParams(
            84.dpToPx(), railH, overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
            x = 8.dpToPx()
        }
        val items = listOf(
            Triple("📝", "Tasks", "todo-list"),
            Triple("📄", "Notes", "notes"),
            Triple("🔥", "Habits", "habit-tracker"),
            Triple("☁️", "Sync", "sync"),
            Triple("⚙️", "Settings", "settings")
        )
        items.forEach { (emoji, label, tool) ->
            rail.addView(railButton(emoji, label) { openTool(tool) })
        }
        val spacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(1, 0, 1f)
        }
        rail.addView(spacer)
        val allBtn = TextView(this).apply {
            text = "›"
            textSize = 22f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#E8EEFC"))
            background = roundedBg(Color.parseColor("#1A2947"), 22, Color.parseColor("#24365A"))
            val s = 44.dpToPx()
            layoutParams = LinearLayout.LayoutParams(s, s)
            setOnClickListener { openTool("all-tools") }
        }
        rail.addView(allBtn)
        // Drag the rail right to close it.
        var rDownX = 0f
        var rDX = 0f
        var rMoved = false
        rail.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    rDownX = event.rawX
                    rDX = 0f
                    rMoved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    rDX = maxOf(0f, event.rawX - rDownX)
                    if (rDX > 12) rMoved = true
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (rMoved && rDX > 60) hideRail()
                    true
                }
                else -> false
            }
        }
        railView = rail
        wm.addView(rail, railParams)
    }

    private fun railButton(emoji: String, label: String, onClick: () -> Unit): View {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(4.dpToPx(), 6.dpToPx(), 4.dpToPx(), 6.dpToPx())
            isClickable = true
            setOnClickListener { onClick() }
        }
        val icon = TextView(this).apply {
            text = emoji
            textSize = 20f
            gravity = Gravity.CENTER
            background = roundedBg(Color.parseColor("#1A2947"), 13, Color.parseColor("#24365A"))
            val s = 44.dpToPx()
            layoutParams = LinearLayout.LayoutParams(s, s)
        }
        val name = TextView(this).apply {
            text = label
            textSize = 11f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#8A9BB8"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        col.addView(icon)
        col.addView(name)
        return col
    }

    private fun openTool(tool: String) {
        hideRail()
        // Open the tool in a small movable floating window over the
        // current app — not the full app (like the phone's built-in sidebar).
        if (floatingWindow == null) floatingWindow = FloatingToolWindow(this)
        floatingWindow?.show(tool)
    }

    private fun hideRail() {
        railView?.let { try { windowManager?.removeView(it) } catch (_: Exception) {} }
        railView = null
        scrimView?.let { try { windowManager?.removeView(it) } catch (_: Exception) {} }
        scrimView = null
        showStrip()
    }

    private fun Int.dpToPx(): Int = (this * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        floatingWindow?.close()
        floatingWindow = null
        stripView?.let { try { windowManager?.removeView(it) } catch (_: Exception) {} }
        stripView = null
        railView?.let { try { windowManager?.removeView(it) } catch (_: Exception) {} }
        railView = null
        scrimView?.let { try { windowManager?.removeView(it) } catch (_: Exception) {} }
        scrimView = null
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
