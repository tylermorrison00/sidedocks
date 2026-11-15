package com.sidedock.app

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var pendingAuthUrl: String? = null

    inner class JsBridge {
        @JavascriptInterface
        fun getVersionCode(): Int {
            return try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0)).versionCode
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getPackageInfo(packageName, 0).versionCode
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
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Could not open browser", Toast.LENGTH_SHORT).show()
            }
        }

        @JavascriptInterface
        fun canInstallPackages(): Boolean {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                packageManager.canRequestPackageInstalls()
            } else {
                true
            }
        }

        @JavascriptInterface
        fun openInstallSettings() {
            try {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:$packageName")
                    )
                )
            } catch (e: Exception) {
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES))
            }
        }

        @JavascriptInterface
        fun downloadApk(url: String) {
            downloadAndInstall(url)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Navy status & navigation bars
        window.statusBarColor = Color.parseColor("#0B1220")
        window.navigationBarColor = Color.parseColor("#131E33")

        webView = WebView(this).apply {
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
                cacheMode = WebSettings.LOAD_DEFAULT
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            }
            scrollBarStyle = View.SCROLLBARS_INSIDE_OVERLAY
            isScrollbarFadingEnabled = true

            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            cookieManager.setAcceptThirdPartyCookies(this, true)

            addJavascriptInterface(JsBridge(), "SideDockAndroid")

            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val url = request?.url?.toString() ?: return false
                    // Supabase OAuth return: sidedock://auth-callback
                    if (request.url.scheme == "sidedock") {
                        handleAuthCallback(url)
                        return true
                    }
                    // Direct APK links: download + install instead of showing binary in WebView
                    if (url.lowercase().endsWith(".apk")) {
                        downloadAndInstall(url)
                        return true
                    }
                    return false
                }

                @Deprecated("Deprecated in Java")
                override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                    if (url == null) return false
                    if (url.startsWith("sidedock://")) {
                        handleAuthCallback(url)
                        return true
                    }
                    if (url.lowercase().endsWith(".apk")) {
                        downloadAndInstall(url)
                        return true
                    }
                    return false
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    pendingAuthUrl?.let { authUrl ->
                        pendingAuthUrl = null
                        dispatchAuthCallback(authUrl)
                    }
                }
            }

            setDownloadListener(object : DownloadListener {
                override fun onDownloadStart(
                    url: String?, userAgent: String?, contentDisposition: String?,
                    mimetype: String?, contentLength: Long
                ) {
                    if (url != null && url.lowercase().endsWith(".apk")) {
                        downloadAndInstall(url)
                    } else if (url != null) {
                        try {
                            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        } catch (e: Exception) {
                        }
                    }
                }
            })
        }

        setContentView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    finish()
                }
            }
        })

        // Deep link launched the app (e.g. sidedock://auth-callback after Google login)
        intent?.data?.toString()?.let { data ->
            if (data.startsWith("sidedock://")) {
                pendingAuthUrl = data
            }
        }

        webView.loadUrl("file:///android_asset/renderer/index.html")
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.data?.toString()?.let { data ->
            if (data.startsWith("sidedock://")) {
                handleAuthCallback(data)
            }
        }
    }

    private fun handleAuthCallback(url: String) {
        // WebView may not have finished loading yet; queue it for onPageFinished.
        if (!::webView.isInitialized) {
            pendingAuthUrl = url
            return
        }
        webView.post {
            // If the page is still the blank initial load, wait for onPageFinished.
            if (webView.url == null) {
                pendingAuthUrl = url
            } else {
                dispatchAuthCallback(url)
            }
        }
    }

    private fun dispatchAuthCallback(url: String) {
        val js = "window.dispatchEvent(new CustomEvent('sidedock-auth',{detail:${JSONObject.quote(url)}}))"
        webView.evaluateJavascript(js, null)
    }

    private fun downloadAndInstall(url: String) {
        // Android 8+: the app must be allowed to install unknown apps.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            Toast.makeText(
                this,
                "Allow 'Install unknown apps' for Side Dock, then tap Update again",
                Toast.LENGTH_LONG
            ).show()
            try {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:$packageName")
                    )
                )
            } catch (e: Exception) {
            }
            return
        }
        // Direct download into the app cache (no DownloadManager): the old
        // DownloadManager flow could leave a stale/partial Side.Dock.apk in
        // Downloads, and the installer then failed on that stale file.
        Toast.makeText(this, "Downloading update...", Toast.LENGTH_SHORT).show()
        Thread {
            try {
                val apkFile = File(cacheDir, "Side.Dock.apk")
                if (apkFile.exists()) apkFile.delete()
                val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                conn.instanceFollowRedirects = true
                conn.connectTimeout = 30000
                conn.readTimeout = 60000
                conn.setRequestProperty("User-Agent", "SideDock-Android")
                if (conn.responseCode !in 200..299) {
                    runOnUiThread { Toast.makeText(this, "Download failed (server error ${conn.responseCode}). Tap Update again.", Toast.LENGTH_LONG).show() }
                    return@Thread
                }
                conn.inputStream.use { input ->
                    apkFile.outputStream().use { output -> input.copyTo(output) }
                }
                if (!apkFile.exists() || apkFile.length() < 1_000_000) {
                    runOnUiThread { Toast.makeText(this, "Download incomplete. Tap Update again.", Toast.LENGTH_LONG).show() }
                    return@Thread
                }
                runOnUiThread { installDownloadedApk(apkFile) }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this, "Download failed: ${e.message}. Tap Update again.", Toast.LENGTH_LONG).show() }
            }
        }.start()
    }

    private fun installDownloadedApk(apkFile: File) {
        try {
            if (!apkFile.exists() || apkFile.length() < 1_000_000) {
                Toast.makeText(this, "Download incomplete. Tap Update again.", Toast.LENGTH_LONG).show()
                return
            }
            val uri = FileProvider.getUriForFile(
                this,
                "com.sidedock.app.fileprovider",
                apkFile
            )
            val install = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(install)
        } catch (e: Exception) {
            Toast.makeText(this, "Install failed: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }
}
