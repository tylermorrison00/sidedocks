package com.sidedock.app

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

// Small movable floating window (like the phone's built-in sidebar):
// tapping a tool in the edge rail opens the tool in this window over
// the current app instead of opening the full app. Drag the header
// to move it anywhere; ✕ closes it back to the edge strip.
class FloatingToolWindow(private val ctx: Context) {
    private val windowManager = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val mainHandler = Handler(Looper.getMainLooper())
    private var root: View? = null
    private var webView: WebView? = null
    private var titleView: TextView? = null
    private var params: WindowManager.LayoutParams? = null
    private var currentTool: String? = null

    private fun dp(v: Int): Int = (v * ctx.resources.displayMetrics.density).toInt()

    private fun overlayType(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
    }

    private fun titleFor(tool: String): String = when (tool) {
        "todo-list" -> "Tasks"
        "notes" -> "Notes"
        "habit-tracker" -> "Habits"
        "sync", "settings" -> "Settings"
        "all-tools" -> "All tools"
        else -> "Side Dock"
    }

    inner class FloatingBridge {
        @JavascriptInterface
        fun getVersionCode(): Int {
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.PackageInfoFlags.of(0)).versionCode
                } else {
                    @Suppress("DEPRECATION")
                    ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionCode
                }
            } catch (e: Exception) {
                1
            }
        }

        @JavascriptInterface
        fun fetchUrl(url: String): String {
            return try {
                val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                conn.instanceFollowRedirects = true
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                conn.setRequestProperty("User-Agent", "SideDock-Android")
                if (conn.responseCode in 200..299) {
                    conn.inputStream.bufferedReader().use { it.readText() }
                } else ""
            } catch (e: Exception) { "" }
        }

        @JavascriptInterface
        fun openExternal(url: String) {
            try {
                ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: Exception) {
                Toast.makeText(ctx, "Could not open browser", Toast.LENGTH_SHORT).show()
            }
        }

        @JavascriptInterface
        fun canInstallPackages(): Boolean {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.packageManager.canRequestPackageInstalls()
            } else {
                true
            }
        }

        @JavascriptInterface
        fun openInstallSettings() {
            try {
                ctx.startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (e: Exception) {
                ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }

        @JavascriptInterface
        fun downloadApk(url: String) {
            // In the floating window, hand the APK to the browser to download.
            openExternal(url)
        }

        @JavascriptInterface
        fun hasOverlayPermission(): Boolean {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Settings.canDrawOverlays(ctx)
            } else {
                true
            }
        }

        @JavascriptInterface
        fun openOverlaySettings() {
            try {
                ctx.startActivity(
                    Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (e: Exception) {
                ctx.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }

        @JavascriptInterface
        fun isEdgeTabEnabled(): Boolean = EdgeTabService.isEnabled(ctx)

        @JavascriptInterface
        fun setEdgeTabEnabled(enabled: Boolean): Boolean {
            if (enabled && !hasOverlayPermission()) return false
            EdgeTabService.setEnabled(ctx, enabled)
            return true
        }

        // Called from the page's ✕ button when running inside this window.
        @JavascriptInterface
        fun closeFloatingWindow() {
            mainHandler.post { close() }
        }
    }

    fun isOpen(): Boolean = root != null

    fun show(tool: String) {
        if (root != null) {
            // Window already open: switch to the tapped tool inside it.
            currentTool = tool
            titleView?.text = titleFor(tool)
            webView?.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('sidedock-open-tool',{detail:'$tool'}))",
                null
            )
            return
        }
        currentTool = tool
        val dm = ctx.resources.displayMetrics
        val w = (dm.widthPixels * 0.85).toInt()
        val h = (dm.heightPixels * 0.70).toInt()
        params = WindowManager.LayoutParams(
            w, h, overlayType(),
            0,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.CENTER }

        val bg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(Color.parseColor("#131E33"))
            cornerRadius = dp(18).toFloat()
            setStroke(dp(1), Color.parseColor("#24365A"))
        }
        val container = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = bg
            clipToOutline = true
        }

        // Header: drag handle + title + close. Dragging it moves the window.
        val header = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#0B1220"))
            setPadding(dp(12), dp(8), dp(8), dp(8))
        }
        val grip = TextView(ctx).apply {
            text = "⋮⋮"
            textSize = 16f
            setTextColor(Color.parseColor("#8A9BB8"))
            setPadding(0, 0, dp(10), 0)
        }
        val title = TextView(ctx).apply {
            text = titleFor(tool)
            textSize = 15f
            setTextColor(Color.parseColor("#E8EEFC"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        titleView = title
        val closeBtn = TextView(ctx).apply {
            text = "✕"
            textSize = 18f
            setTextColor(Color.parseColor("#E8EEFC"))
            setPadding(dp(10), dp(2), dp(6), dp(2))
            setOnClickListener { close() }
        }
        header.addView(grip)
        header.addView(title)
        header.addView(closeBtn)

        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        header.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    startX = params?.x ?: 0
                    startY = params?.y ?: 0
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val nx = startX + (event.rawX - downX).toInt()
                    val ny = startY + (event.rawY - downY).toInt()
                    params?.let {
                        it.x = nx
                        it.y = ny
                        try { windowManager.updateViewLayout(root, it) } catch (_: Exception) {}
                    }
                    true
                }
                else -> false
            }
        }

        container.addView(header, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        webView = WebView(ctx.applicationContext).apply {
            @SuppressLint("SetJavaScriptEnabled")
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                allowFileAccessFromFileURLs = true
                allowUniversalAccessFromFileURLs = true
                loadWithOverviewMode = true
                useWideViewPort = true
            }
            CookieManager.getInstance().setAcceptCookie(true)
            addJavascriptInterface(FloatingBridge(), "SideDockAndroid")
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val url = request?.url?.toString() ?: return false
                    if (request.url.scheme == "sidedock") {
                        // OAuth return: let the main app handle the deep link.
                        try {
                            ctx.startActivity(Intent(Intent.ACTION_VIEW, request.url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        } catch (_: Exception) {}
                        return true
                    }
                    if (url.lowercase().endsWith(".apk")) {
                        openExternalApk(url)
                        return true
                    }
                    return false
                }
            }
            loadUrl("file:///android_asset/renderer/index.html#tool=$tool")
        }
        container.addView(webView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        root = container
        windowManager.addView(container, params)
    }

    private fun openExternalApk(url: String) {
        try {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {}
    }

    fun close() {
        root?.let { try { windowManager.removeView(it) } catch (_: Exception) {} }
        root = null
        webView?.destroy()
        webView = null
        titleView = null
        currentTool = null
    }
}
