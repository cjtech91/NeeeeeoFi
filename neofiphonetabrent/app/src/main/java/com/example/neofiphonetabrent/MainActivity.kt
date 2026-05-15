package com.example.neofiphonetabrent

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private val prefs by lazy { getSharedPreferences("neofi_rental", Context.MODE_PRIVATE) }

    private val defaultBaseUrl = "http://10.0.0.1"
    private var baseUrl: String = defaultBaseUrl
    private val statusPollMs = 2500L

    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    private lateinit var webView: WebView
    private lateinit var rentalStatusText: TextView
    private lateinit var btnShowPortal: Button
    private lateinit var btnShowApps: Button
    private lateinit var btnAdmin: ImageButton
    private lateinit var dashboardContainer: View
    private lateinit var portalContainer: View
    private lateinit var appsGrid: GridLayout
    private lateinit var dashboardHint: TextView
    private lateinit var fakeStatusBar: View
    private lateinit var fakeWifiText: TextView
    private lateinit var fakeBatteryText: TextView
    private lateinit var fakeTimeText: TextView

    @Volatile
    private var lastMainFrameLoadFailed: Boolean = false

    @Volatile
    private var isUnlocked: Boolean = false

    @Volatile
    private var isLoadingPortal: Boolean = false

    @Volatile
    private var serverUnlocked: Boolean = false

    @Volatile
    private var adminSessionUntilMs: Long = 0L

    @Volatile
    private var lastTimeRemainingSec: Int = 0

    private val keyAdminPin = "admin_pin"
    private val keyBaseUrl = "base_url"
    private val keyAdminBypass = "admin_bypass"
    private val keyAdminOverrideUntil = "admin_override_unlocked_until"
    private val keyHomeLauncher = "kiosk_home_launcher"
    private val keyUnlockedAppPkg = "unlocked_app_pkg"
    private val keyUnlockedAppLabel = "unlocked_app_label"
    private val keyLaunchOnUnlock = "launch_on_unlock"
    private val keyAllowedAppsJson = "allowed_apps_json"

    @Volatile
    private var lastLaunchSig: String = ""

    @Volatile
    private var pendingOpenCoinModal: Boolean = false

    @Volatile
    private var coinOnlyMode: Boolean = false

    private val clockFormat = SimpleDateFormat("HH:mm", Locale.getDefault())

    @Volatile
    private var expectedBackgroundUntilMs: Long = 0L

    @Volatile
    private var lastGatewayFallbackAttemptMs: Long = 0L

    private val uiTickRunnable = object : Runnable {
        override fun run() {
            updateFakeStatusBar()
            mainHandler.postDelayed(this, 30_000L)
        }
    }

    private val pollRunnable = object : Runnable {
        override fun run() {
            pollStatusOnce()
            mainHandler.postDelayed(this, statusPollMs)
        }
    }

    private val kioskGuardRunnable = object : Runnable {
        override fun run() {
            try {
                val now = System.currentTimeMillis()
                if (!prefs.getBoolean(keyAdminBypass, false) && now >= adminSessionUntilMs) {
                    val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
                    if (dpm?.isDeviceOwnerApp(packageName) == true) {
                        try {
                            if (!isLockTaskModeActiveSafe()) {
                                startLockTask()
                            }
                        } catch (_: Throwable) {}
                        try {
                            val admin = ComponentName(this@MainActivity, AdminReceiver::class.java)
                            dpm.setStatusBarDisabled(admin, true)
                        } catch (_: Throwable) {}
                    }
                    applyImmersiveMode()
                }
            } catch (_: Throwable) {}
            mainHandler.postDelayed(this, 900L)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)

        baseUrl = normalizeBaseUrl(prefs.getString(keyBaseUrl, defaultBaseUrl) ?: defaultBaseUrl)

        webView = findViewById(R.id.webview)
        rentalStatusText = findViewById(R.id.rental_status)
        btnAdmin = findViewById(R.id.btn_admin)
        btnShowPortal = findViewById(R.id.btn_show_portal)
        btnShowApps = findViewById(R.id.btn_show_apps)
        dashboardContainer = findViewById(R.id.dashboard_container)
        portalContainer = findViewById(R.id.portal_container)
        appsGrid = findViewById(R.id.apps_grid)
        dashboardHint = findViewById(R.id.dashboard_hint)
        fakeStatusBar = findViewById(R.id.fake_status_bar)
        fakeWifiText = findViewById(R.id.fake_wifi)
        fakeBatteryText = findViewById(R.id.fake_battery)
        fakeTimeText = findViewById(R.id.fake_time)

        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.loadsImagesAutomatically = true
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url?.toString() ?: ""
                return if (!isUnlocked) !isAllowedWhileLocked(url) else false
            }

            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                return if (!isUnlocked) !isAllowedWhileLocked(url) else false
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                lastMainFrameLoadFailed = true
                handleMainFrameLoadFailure()
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (!request.isForMainFrame) return
                val code = try { errorResponse.statusCode } catch (_: Throwable) { 0 }
                if (code >= 400) {
                    lastMainFrameLoadFailed = true
                    handleMainFrameLoadFailure()
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (pendingOpenCoinModal && url.contains("/portal")) {
                    pendingOpenCoinModal = false
                    openCoinModalInWeb()
                }
            }
        }

        btnShowPortal.setOnClickListener {
            if (!isUnlocked) {
                showInsertCoinModal()
            } else {
                showPortal()
            }
        }
        btnShowApps.setOnClickListener { showApps() }
        btnAdmin.setOnClickListener { openAdminPanel() }

        renderAppsGrid()
        showApps()
        applyLockedState(true)
        ensureKioskMode()
    }

    private fun showOfflinePage() {
        val html = """
            <!doctype html>
            <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1" />
              <style>
                body { font-family: sans-serif; margin: 0; padding: 24px; background: #ffffff; color: #111; }
                .box { max-width: 520px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; }
                h2 { margin: 0 0 10px 0; font-size: 18px; }
                p { margin: 8px 0; line-height: 1.35; color: #374151; }
                .mono { font-family: monospace; background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
                .btn { display:inline-block; margin-top: 12px; background:#111; color:#fff; padding:10px 14px; border-radius:10px; text-decoration:none; }
                .hint { font-size: 12px; color: #6b7280; margin-top: 14px; }
              </style>
            </head>
            <body>
              <div class="box">
                <h2>Portal not reachable</h2>
                <p>Connect this device to NeoFi WiFi, then open the app again.</p>
                <p>Current gateway: <span class="mono">${baseUrl}</span></p>
                <a class="btn" href="#" onclick="location.href='${baseUrl}/portal?ts='+Date.now(); return false;">Retry</a>
                <p class="hint">Admin: tap the Admin button to change gateway.</p>
              </div>
            </body>
            </html>
        """.trimIndent()
        try {
            webView.loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", null)
        } catch (_: Throwable) {}
    }

    private fun handleMainFrameLoadFailure() {
        val now = System.currentTimeMillis()
        if (baseUrl != defaultBaseUrl && now - lastGatewayFallbackAttemptMs > 30_000L) {
            lastGatewayFallbackAttemptMs = now
            baseUrl = defaultBaseUrl
            prefs.edit().putString(keyBaseUrl, baseUrl).apply()
            lastMainFrameLoadFailed = false
            if (coinOnlyMode) {
                pendingOpenCoinModal = true
            }
            try {
                isLoadingPortal = true
                webView.loadUrl("$baseUrl/portal")
                mainHandler.postDelayed({ isLoadingPortal = false }, 1500)
            } catch (_: Throwable) {}
            return
        }
        showOfflinePage()
    }

    override fun onStart() {
        super.onStart()
        ensureKioskMode()
        updateFakeStatusBar()
        mainHandler.removeCallbacks(uiTickRunnable)
        mainHandler.post(uiTickRunnable)
        mainHandler.removeCallbacks(pollRunnable)
        mainHandler.post(pollRunnable)
        mainHandler.removeCallbacks(kioskGuardRunnable)
        mainHandler.post(kioskGuardRunnable)
    }

    override fun onResume() {
        super.onResume()
        ensureKioskMode()
        applyImmersiveMode()
    }

    override fun onPause() {
        super.onPause()
        if (shouldForceReturnToForeground()) {
            mainHandler.post {
                bringTaskToFront()
                ensureKioskMode()
            }
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (shouldForceReturnToForeground()) {
            mainHandler.post { bringTaskToFront() }
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!prefs.getBoolean(keyAdminBypass, false) && System.currentTimeMillis() >= adminSessionUntilMs) {
            if (event.keyCode == KeyEvent.KEYCODE_APP_SWITCH) {
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onStop() {
        super.onStop()
        mainHandler.removeCallbacks(pollRunnable)
        mainHandler.removeCallbacks(uiTickRunnable)
        mainHandler.removeCallbacks(kioskGuardRunnable)
    }

    override fun onDestroy() {
        super.onDestroy()
        executor.shutdownNow()
        webView.destroy()
    }

    override fun onBackPressed() {
        if (portalContainer.visibility == View.VISIBLE) {
            if (webView.canGoBack()) {
                webView.goBack()
                return
            }
            showApps()
            return
        }
        return
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            applyImmersiveMode()
        }
    }

    private fun ensureKioskMode() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return
        val admin = ComponentName(this, AdminReceiver::class.java)
        val isOwner = dpm.isDeviceOwnerApp(packageName)
        val bypass = prefs.getBoolean(keyAdminBypass, false)
        if (!isOwner) {
            if (!bypass) {
                try {
                    fakeStatusBar.visibility = View.VISIBLE
                } catch (_: Throwable) {}
            }
            applyImmersiveMode()
            return
        }

        if (bypass) {
            try {
                fakeStatusBar.visibility = View.GONE
            } catch (_: Throwable) {}
            try {
                if (isLockTaskModeActiveSafe()) {
                    stopLockTask()
                }
            } catch (_: Throwable) {}
            try {
                dpm.setStatusBarDisabled(admin, false)
            } catch (_: Throwable) {}
            try {
                dpm.setKeyguardDisabled(admin, false)
            } catch (_: Throwable) {}
            try {
                setAsPersistentHomeLauncher(admin, enable = false)
            } catch (_: Throwable) {}
            return
        }

        try {
            fakeStatusBar.visibility = View.VISIBLE
        } catch (_: Throwable) {}

        try {
            if (!prefs.contains(keyHomeLauncher) || !prefs.getBoolean(keyHomeLauncher, false)) {
                prefs.edit().putBoolean(keyHomeLauncher, true).apply()
            }
            setAsPersistentHomeLauncher(admin, enable = true)
        } catch (_: Throwable) {}

        val extra = getConfiguredLockTaskPackages()
        try {
            val pkgs = ArrayList<String>()
            pkgs.add(packageName)
            pkgs.addAll(extra)
            dpm.setLockTaskPackages(admin, pkgs.distinct().toTypedArray())
        } catch (_: Throwable) {}

        try {
            dpm.setLockTaskFeatures(admin, 0)
        } catch (_: Throwable) {}

        try {
            if (!isLockTaskModeActiveSafe()) {
                startLockTask()
            }
        } catch (_: Throwable) {}
        try {
            mainHandler.postDelayed({
                if (!prefs.getBoolean(keyAdminBypass, false)) {
                    val dpm2 = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
                    if (dpm2?.isDeviceOwnerApp(packageName) == true && !isLockTaskModeActiveSafe()) {
                        try {
                            startLockTask()
                        } catch (_: Throwable) {}
                    }
                }
            }, 350L)
        } catch (_: Throwable) {}

        try {
            dpm.setKeyguardDisabled(admin, true)
        } catch (_: Throwable) {}

        try {
            dpm.setStatusBarDisabled(admin, true)
        } catch (_: Throwable) {}

        applyImmersiveMode()
    }

    private fun updateFakeStatusBar() {
        try {
            fakeTimeText.text = clockFormat.format(Date())
        } catch (_: Throwable) {}

        try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
            val wifi = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
            fakeWifiText.text = if (wifi) "WiFi" else "No WiFi"
        } catch (_: Throwable) {}

        try {
            val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            if (i != null) {
                val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                val status = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
                val pct = if (level >= 0 && scale > 0) ((level * 100f) / scale).toInt() else -1
                fakeBatteryText.text = if (pct >= 0) "${pct}%${if (charging) " +" else ""}" else "—"
            }
        } catch (_: Throwable) {}
    }

    private fun getConfiguredLockTaskPackages(): List<String> {
        val set = LinkedHashSet<String>()
        val defaultPkg = prefs.getString(keyUnlockedAppPkg, null)?.trim().orEmpty()
        if (defaultPkg.isNotBlank()) set.add(defaultPkg)
        for (a in loadAllowedApps()) {
            if (a.packageName.isNotBlank()) set.add(a.packageName)
        }
        return set.toList()
    }

    private fun setAsPersistentHomeLauncher(admin: ComponentName, enable: Boolean) {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return
        if (!dpm.isDeviceOwnerApp(packageName)) return

        if (!enable) {
            try {
                dpm.clearPackagePersistentPreferredActivities(admin, packageName)
            } catch (_: Throwable) {}
            return
        }

        val filter = IntentFilter(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
        val activity = ComponentName(this, MainActivity::class.java)
        try {
            dpm.addPersistentPreferredActivity(admin, filter, activity)
        } catch (_: Throwable) {}
    }

    private fun isLockTaskModeActiveSafe(): Boolean {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return false
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
            } else {
                false
            }
        } catch (_: Throwable) {
            false
        }
    }

    private fun applyImmersiveMode() {
        val bypass = prefs.getBoolean(keyAdminBypass, false)
        val isOwner = try {
            val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            dpm?.isDeviceOwnerApp(packageName) == true
        } catch (_: Throwable) { false }

        try {
            WindowCompat.setDecorFitsSystemWindows(window, false)
        } catch (_: Throwable) {}

        try {
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            if (bypass) {
                controller.show(WindowInsetsCompat.Type.systemBars())
            } else if (isOwner) {
                controller.hide(WindowInsetsCompat.Type.statusBars())
                controller.show(WindowInsetsCompat.Type.navigationBars())
            } else {
                controller.hide(WindowInsetsCompat.Type.systemBars())
            }
        } catch (_: Throwable) {}

        try {
            window.decorView.systemUiVisibility =
                if (bypass) {
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                } else if (isOwner) {
                    (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            or View.SYSTEM_UI_FLAG_FULLSCREEN
                            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
                } else {
                    (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            or View.SYSTEM_UI_FLAG_FULLSCREEN
                            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
                }
        } catch (_: Throwable) {}
    }

    private fun pollStatusOnce() {
        executor.execute {
            try {
                val statusUrl = "$baseUrl/api/status"
                val conn = (URL(statusUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 1500
                    readTimeout = 1500
                    requestMethod = "GET"
                    setRequestProperty("Cache-Control", "no-store")
                    instanceFollowRedirects = true
                }

                val code = conn.responseCode
                if (code != 200) {
                    conn.disconnect()
                    return@execute
                }

                val reader = BufferedReader(InputStreamReader(conn.inputStream))
                val sb = StringBuilder()
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    sb.append(line)
                }
                reader.close()
                conn.disconnect()

                val json = JSONObject(sb.toString())
                val timeRemaining = json.optInt("time_remaining", 0)
                val paused = json.optInt("is_paused", 0)
                val unlockedNow = timeRemaining > 0 && paused == 0
                serverUnlocked = unlockedNow
                lastTimeRemainingSec = timeRemaining
                val effectiveUnlocked = computeEffectiveUnlocked()

                if (effectiveUnlocked != isUnlocked) {
                    isUnlocked = effectiveUnlocked
                    mainHandler.post {
                        applyLockedState(!effectiveUnlocked)
                        if (effectiveUnlocked) {
                            maybeLaunchUnlockedApp()
                        } else {
                            lastLaunchSig = ""
                        }
                    }
                } else {
                    mainHandler.post { updateStatusUi() }
                }
            } catch (_: Throwable) {
            }
        }
    }

    private fun maybeLaunchUnlockedApp() {
        val now = System.currentTimeMillis()
        val pkg = prefs.getString(keyUnlockedAppPkg, null)?.trim().orEmpty().ifBlank {
            loadAllowedApps().firstOrNull()?.packageName.orEmpty()
        }
        if (pkg.isBlank()) return
        if (!prefs.getBoolean(keyLaunchOnUnlock, true)) return

        val sig = "$pkg:${now / 10_000L}"
        if (sig == lastLaunchSig) return
        lastLaunchSig = sig

        val intent = packageManager.getLaunchIntentForPackage(pkg) ?: return
        try {
            markExpectedBackground(8_000L)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        } catch (_: Throwable) {}
    }

    private fun applyLockedState(locked: Boolean) {
        if (locked && !isLoadingPortal) {
            isLoadingPortal = true
            webView.loadUrl("$baseUrl/portal")
            mainHandler.postDelayed({ isLoadingPortal = false }, 1500)
        }
        updateStatusUi()
        renderAppsGrid()
        applyImmersiveMode()
    }

    private fun updateStatusUi() {
        val locked = !isUnlocked
        val label = if (locked) "Locked" else "Unlocked"
        rentalStatusText.text = "$label • ${formatSecondsToHms(lastTimeRemainingSec)}"
        btnShowPortal.text = if (locked) "Insert Coins" else "Portal"
        dashboardHint.text = if (locked) {
            "Select an app. Insert coin first to unlock."
        } else {
            "Select an app."
        }
    }

    private fun showPortal() {
        coinOnlyMode = false
        portalContainer.visibility = View.VISIBLE
        dashboardContainer.visibility = View.GONE
        if (!lastMainFrameLoadFailed && !isLoadingPortal) {
            isLoadingPortal = true
            webView.loadUrl("$baseUrl/portal")
            mainHandler.postDelayed({ isLoadingPortal = false }, 1200)
        }
        applyImmersiveMode()
    }

    private fun showInsertCoinModal() {
        coinOnlyMode = true
        pendingOpenCoinModal = true
        portalContainer.visibility = View.VISIBLE
        dashboardContainer.visibility = View.GONE

        val current = try { webView.url ?: "" } catch (_: Throwable) { "" }
        if (current.contains("/portal") && !isLoadingPortal && !lastMainFrameLoadFailed) {
            pendingOpenCoinModal = false
            openCoinModalInWeb()
            return
        }

        if (!lastMainFrameLoadFailed && !isLoadingPortal) {
            isLoadingPortal = true
            webView.loadUrl("$baseUrl/portal")
            mainHandler.postDelayed({ isLoadingPortal = false }, 1200)
        }
        applyImmersiveMode()
    }

    private fun showApps() {
        if (coinOnlyMode) {
            coinOnlyMode = false
            try {
                webView.evaluateJavascript(
                    "(function(){try{if(typeof closeCoinModal==='function'){closeCoinModal();}}catch(e){};try{var st=document.getElementById('neofi-coin-only-style'); if(st) st.remove();}catch(e){};return true;})();",
                    null
                )
            } catch (_: Throwable) {}
        }
        portalContainer.visibility = View.GONE
        dashboardContainer.visibility = View.VISIBLE
        applyImmersiveMode()
    }

    private fun openCoinModalInWeb() {
        val js = """
            (function(){
              try{
                if (${coinOnlyMode}) {
                  var st = document.getElementById('neofi-coin-only-style');
                  if (!st) {
                    st = document.createElement('style');
                    st.id = 'neofi-coin-only-style';
                    st.textContent = 'body > * { visibility:hidden !important; } ' +
                      '#coin-modal, #device-modal { visibility:visible !important; } ' +
                      '#coin-modal *, #device-modal * { visibility:visible !important; }';
                    document.head.appendChild(st);
                  }
                }
                if (typeof insertCoins === 'function') { insertCoins(); return true; }
                var btn = document.getElementById('btn-insert');
                if (btn) { btn.click(); return true; }
                var any = document.querySelector('button[onclick*="insert"],button[onclick*="Insert"]');
                if (any) { any.click(); return true; }
                if (typeof openModal === 'function') { openModal('coin-modal'); return true; }
                var m = document.getElementById('coin-modal');
                if (m) { m.style.display = 'flex'; setTimeout(function(){ m.classList.add('show'); }, 10); return true; }
              }catch(e){}
              return false;
            })();
        """.trimIndent()
        try {
            webView.evaluateJavascript(js, null)
        } catch (_: Throwable) {}
    }

    private fun formatSecondsToHms(totalSeconds: Int): String {
        val s = if (totalSeconds > 0) totalSeconds else 0
        val h = s / 3600
        val m = (s % 3600) / 60
        val ss = (s % 60)
        fun pad(n: Int) = n.toString().padStart(2, '0')
        return "${pad(h)}:${pad(m)}:${pad(ss)}"
    }

    private data class AllowedApp(val label: String, val packageName: String)

    private fun loadAllowedApps(): List<AllowedApp> {
        val raw = prefs.getString(keyAllowedAppsJson, null)?.trim().orEmpty()
        if (raw.isBlank()) return emptyList()
        return try {
            val json = JSONObject(raw)
            val arr = json.optJSONArray("apps") ?: return emptyList()
            val result = ArrayList<AllowedApp>()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val pkg = o.optString("pkg", "").trim()
                val label = o.optString("label", "").trim()
                if (pkg.isNotBlank()) {
                    result.add(AllowedApp(label.ifBlank { pkg }, pkg))
                }
            }
            result.distinctBy { it.packageName }
        } catch (_: Throwable) {
            emptyList()
        }
    }

    private fun saveAllowedApps(apps: List<AllowedApp>) {
        try {
            val arr = org.json.JSONArray()
            for (a in apps) {
                val o = JSONObject()
                o.put("pkg", a.packageName)
                o.put("label", a.label)
                arr.put(o)
            }
            val root = JSONObject()
            root.put("apps", arr)
            prefs.edit().putString(keyAllowedAppsJson, root.toString()).apply()
        } catch (_: Throwable) {
        }
    }

    private fun renderAppsGrid() {
        val allowed = loadAllowedApps()
        appsGrid.removeAllViews()
        appsGrid.columnCount = 3

        if (allowed.isEmpty()) {
            val tv = TextView(this).apply {
                text = "No apps assigned. Ask admin to add allowed apps."
                textSize = 14f
            }
            appsGrid.addView(tv)
            return
        }

        val pm = packageManager
        val density = resources.displayMetrics.density
        val pad = (density * 10).toInt()
        val iconSize = (density * 44).toInt()
        val margin = (density * 6).toInt()

        for (a in allowed) {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(pad, pad, pad, pad)
                isClickable = true
                isFocusable = true
                setBackgroundResource(android.R.drawable.list_selector_background)
            }

            val icon = ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams(iconSize, iconSize).apply {
                    bottomMargin = (density * 6).toInt()
                }
                try {
                    setImageDrawable(pm.getApplicationIcon(a.packageName))
                } catch (_: Throwable) {
                }
            }

            val label = TextView(this).apply {
                text = a.label
                textSize = 12f
                maxLines = 2
            }

            card.addView(icon)
            card.addView(label)

            card.setOnClickListener {
                if (isUnlocked) {
                    launchPackage(a.packageName)
                } else {
                    showLockedPrompt()
                }
            }

            val lp = GridLayout.LayoutParams().apply {
                width = 0
                columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
                setMargins(margin, margin, margin, margin)
            }
            appsGrid.addView(card, lp)
        }
    }

    private fun launchPackage(pkg: String) {
        val intent = packageManager.getLaunchIntentForPackage(pkg) ?: return
        try {
            markExpectedBackground(8_000L)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        } catch (_: Throwable) {}
    }

    private fun showLockedPrompt() {
        AlertDialog.Builder(this)
            .setTitle("Locked")
            .setMessage("Insert coin first to unlock this device.")
            .setPositiveButton("Open Portal") { _, _ -> showPortal() }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun isAllowedWhileLocked(url: String?): Boolean {
        if (url == null) return false
        val u = url.lowercase(Locale.US)
        val b = baseUrl.lowercase(Locale.US)
        if (u.startsWith("$b/portal")) return true
        if (u.startsWith("$b/api/")) return true
        if (u == b || u == "$b/") return true
        return false
    }

    private fun computeEffectiveUnlocked(): Boolean {
        val now = System.currentTimeMillis()
        val overrideUntil = prefs.getLong(keyAdminOverrideUntil, 0L)
        if (overrideUntil > now) return true
        return serverUnlocked
    }

    private fun normalizeBaseUrl(raw: String): String {
        val v = raw.trim()
        if (v.startsWith("http://") || v.startsWith("https://")) return v.trimEnd('/')
        if (v.contains("://")) return defaultBaseUrl
        return ("http://" + v).trimEnd('/')
    }

    private fun openAdminPanel() {
        val now = System.currentTimeMillis()
        if (now < adminSessionUntilMs) {
            showAdminMenu()
            return
        }

        val existingPin = prefs.getString(keyAdminPin, null)
        if (existingPin.isNullOrBlank()) {
            showSetPinDialog()
        } else {
            showLoginDialog(existingPin)
        }
    }

    private fun showSetPinDialog() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 0)
        }
        val pin1 = EditText(this).apply {
            hint = "Set Admin PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val pin2 = EditText(this).apply {
            hint = "Confirm Admin PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        layout.addView(pin1)
        layout.addView(pin2)

        AlertDialog.Builder(this)
            .setTitle("Admin Setup")
            .setView(layout)
            .setCancelable(true)
            .setPositiveButton("Save") { _, _ ->
                val a = pin1.text?.toString()?.trim().orEmpty()
                val b = pin2.text?.toString()?.trim().orEmpty()
                if (a.length < 4 || a != b) {
                    return@setPositiveButton
                }
                prefs.edit().putString(keyAdminPin, a).apply()
                adminSessionUntilMs = System.currentTimeMillis() + 10 * 60 * 1000L
                showAdminMenu()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showLoginDialog(expectedPin: String) {
        val pin = EditText(this).apply {
            hint = "Admin PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        AlertDialog.Builder(this)
            .setTitle("Admin Login")
            .setView(pin)
            .setCancelable(true)
            .setPositiveButton("Login") { _, _ ->
                val entered = pin.text?.toString()?.trim().orEmpty()
                if (entered == expectedPin) {
                    adminSessionUntilMs = System.currentTimeMillis() + 10 * 60 * 1000L
                    showAdminMenu()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showAdminMenu() {
        val bypass = prefs.getBoolean(keyAdminBypass, false)
        val isOwner = try {
            val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            dpm?.isDeviceOwnerApp(packageName) == true
        } catch (_: Throwable) { false }
        val homeEnabled = prefs.getBoolean(keyHomeLauncher, false)
        val selectedLabel = prefs.getString(keyUnlockedAppLabel, null)?.takeIf { it.isNotBlank() }
        val selectedPkg = prefs.getString(keyUnlockedAppPkg, null)?.takeIf { it.isNotBlank() }
        val selectedText = selectedLabel ?: selectedPkg ?: "Not set"
        val launchOnUnlock = prefs.getBoolean(keyLaunchOnUnlock, true)
        val allowedCount = loadAllowedApps().size
        val items = arrayOf(
            if (bypass) "Return to Kiosk" else "Exit Kiosk (Bypass)",
            "Admin Unlock (30 min)",
            "Lock Now",
            "Set Gateway IP/URL",
            "Manage Allowed Apps ($allowedCount)",
            "Set Default Auto-Open App ($selectedText)",
            if (launchOnUnlock) "Disable Auto Open App" else "Enable Auto Open App",
            if (isOwner) (if (homeEnabled) "Disable Home Launcher Override" else "Enable Home Launcher Override") else "Home Launcher Override (Device Owner required)",
            "Open Selected App Now",
            "Change Admin PIN",
            "Open Android Settings",
            "Logout Admin"
        )

        AlertDialog.Builder(this)
            .setTitle("Admin")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> toggleBypass()
                    1 -> adminOverrideUnlock()
                    2 -> adminLockNow()
                    3 -> setGatewayDialog()
                    4 -> manageAllowedAppsDialog()
                    5 -> selectDefaultAutoOpenDialog()
                    6 -> toggleLaunchOnUnlock()
                    7 -> toggleHomeLauncherOverride()
                    8 -> openSelectedAppNow()
                    9 -> changePinDialog()
                    10 -> openSystemSettings()
                    11 -> logoutAdmin()
                }
            }
            .setCancelable(true)
            .show()
    }

    private fun toggleLaunchOnUnlock() {
        val next = !prefs.getBoolean(keyLaunchOnUnlock, true)
        prefs.edit().putBoolean(keyLaunchOnUnlock, next).apply()
    }

    private fun toggleHomeLauncherOverride() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager ?: return
        if (!dpm.isDeviceOwnerApp(packageName)) return
        val admin = ComponentName(this, AdminReceiver::class.java)
        val next = !prefs.getBoolean(keyHomeLauncher, false)
        prefs.edit().putBoolean(keyHomeLauncher, next).apply()
        try {
            setAsPersistentHomeLauncher(admin, enable = next)
        } catch (_: Throwable) {}
        ensureKioskMode()
    }

    private fun openSelectedAppNow() {
        val pkg = prefs.getString(keyUnlockedAppPkg, null)?.trim().orEmpty()
        if (pkg.isBlank()) return
        val intent = packageManager.getLaunchIntentForPackage(pkg) ?: return
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        } catch (_: Throwable) {}
    }

    private data class LaunchableApp(val label: String, val packageName: String)

    private fun selectDefaultAutoOpenDialog() {
        val pm = packageManager
        val queryIntent = Intent(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) }
        val list = try {
            pm.queryIntentActivities(queryIntent, 0)
        } catch (_: Throwable) {
            emptyList()
        }

        val apps = list
            .mapNotNull { ri ->
                val pkg = ri.activityInfo?.packageName?.trim().orEmpty()
                if (pkg.isBlank()) return@mapNotNull null
                val label = try { ri.loadLabel(pm)?.toString()?.trim().orEmpty() } catch (_: Throwable) { "" }
                LaunchableApp(label.ifBlank { pkg }, pkg)
            }
            .distinctBy { it.packageName }
            .sortedBy { it.label.lowercase(Locale.US) }

        if (apps.isEmpty()) return

        val currentPkg = prefs.getString(keyUnlockedAppPkg, null)?.trim().orEmpty()
        val labels = apps.map { it.label }.toTypedArray()
        val selectedIndex = apps.indexOfFirst { it.packageName == currentPkg }.coerceAtLeast(0)
        var picked = selectedIndex

        AlertDialog.Builder(this)
            .setTitle("Default Auto-Open App")
            .setSingleChoiceItems(labels, selectedIndex) { _, which -> picked = which }
            .setPositiveButton("Save") { _, _ ->
                val chosen = apps.getOrNull(picked) ?: return@setPositiveButton
                prefs.edit()
                    .putString(keyUnlockedAppPkg, chosen.packageName)
                    .putString(keyUnlockedAppLabel, chosen.label)
                    .apply()
                ensureKioskMode()
            }
            .setNeutralButton("Clear") { _, _ ->
                prefs.edit()
                    .remove(keyUnlockedAppPkg)
                    .remove(keyUnlockedAppLabel)
                    .apply()
                ensureKioskMode()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun manageAllowedAppsDialog() {
        val pm = packageManager
        val queryIntent = Intent(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) }
        val list = try {
            pm.queryIntentActivities(queryIntent, 0)
        } catch (_: Throwable) {
            emptyList()
        }

        val apps = list
            .mapNotNull { ri ->
                val pkg = ri.activityInfo?.packageName?.trim().orEmpty()
                if (pkg.isBlank()) return@mapNotNull null
                val label = try { ri.loadLabel(pm)?.toString()?.trim().orEmpty() } catch (_: Throwable) { "" }
                LaunchableApp(label.ifBlank { pkg }, pkg)
            }
            .distinctBy { it.packageName }
            .sortedBy { it.label.lowercase(Locale.US) }

        if (apps.isEmpty()) return

        val current = loadAllowedApps().map { it.packageName }.toSet()
        val labels = apps.map { it.label }.toTypedArray()
        val checked = BooleanArray(apps.size) { idx -> current.contains(apps[idx].packageName) }

        AlertDialog.Builder(this)
            .setTitle("Allowed Apps (Client Dashboard)")
            .setMultiChoiceItems(labels, checked) { _, which, isChecked ->
                checked[which] = isChecked
            }
            .setPositiveButton("Save") { _, _ ->
                val next = ArrayList<AllowedApp>()
                for (i in apps.indices) {
                    if (checked[i]) {
                        val a = apps[i]
                        next.add(AllowedApp(a.label, a.packageName))
                    }
                }
                saveAllowedApps(next)
                ensureKioskMode()
                renderAppsGrid()
            }
            .setNeutralButton("Clear") { _, _ ->
                saveAllowedApps(emptyList())
                ensureKioskMode()
                renderAppsGrid()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun toggleBypass() {
        val next = !prefs.getBoolean(keyAdminBypass, false)
        val editor = prefs.edit().putBoolean(keyAdminBypass, next)
        if (next) {
            editor.putBoolean(keyHomeLauncher, false)
        }
        editor.apply()

        ensureKioskMode()

        if (next) {
            try {
                markExpectedBackground(8_000L)
                startActivity(Intent(Intent.ACTION_MAIN).apply {
                    addCategory(Intent.CATEGORY_HOME)
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                })
            } catch (_: Throwable) {}
            try {
                finishAffinity()
            } catch (_: Throwable) {}
        } else {
            applyImmersiveMode()
        }
    }

    private fun adminOverrideUnlock() {
        val until = System.currentTimeMillis() + 30 * 60 * 1000L
        prefs.edit().putLong(keyAdminOverrideUntil, until).apply()
        val effectiveUnlocked = computeEffectiveUnlocked()
        if (effectiveUnlocked != isUnlocked) {
            isUnlocked = effectiveUnlocked
            applyLockedState(!effectiveUnlocked)
        } else {
            applyLockedState(false)
        }
    }

    private fun adminLockNow() {
        prefs.edit().putLong(keyAdminOverrideUntil, 0L).apply()
        val effectiveUnlocked = computeEffectiveUnlocked()
        isUnlocked = effectiveUnlocked
        applyLockedState(true)
    }

    private fun setGatewayDialog() {
        val input = EditText(this).apply {
            hint = "Gateway (e.g., 10.0.0.1)"
            setText(baseUrl)
            inputType = InputType.TYPE_CLASS_TEXT
        }
        AlertDialog.Builder(this)
            .setTitle("Gateway URL")
            .setView(input)
            .setPositiveButton("Save") { _, _ ->
                val raw = input.text?.toString().orEmpty()
                baseUrl = normalizeBaseUrl(raw)
                prefs.edit().putString(keyBaseUrl, baseUrl).apply()
                applyLockedState(!isUnlocked)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun changePinDialog() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 24, 48, 0)
        }
        val pin1 = EditText(this).apply {
            hint = "New Admin PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val pin2 = EditText(this).apply {
            hint = "Confirm New Admin PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        layout.addView(pin1)
        layout.addView(pin2)

        AlertDialog.Builder(this)
            .setTitle("Change PIN")
            .setView(layout)
            .setPositiveButton("Save") { _, _ ->
                val a = pin1.text?.toString()?.trim().orEmpty()
                val b = pin2.text?.toString()?.trim().orEmpty()
                if (a.length < 4 || a != b) return@setPositiveButton
                prefs.edit().putString(keyAdminPin, a).apply()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun openSystemSettings() {
        try {
            markExpectedBackground(15_000L)
            startActivity(Intent(android.provider.Settings.ACTION_SETTINGS))
        } catch (_: Throwable) {}
    }

    private fun markExpectedBackground(durationMs: Long) {
        expectedBackgroundUntilMs = System.currentTimeMillis() + durationMs
    }

    private fun shouldForceReturnToForeground(): Boolean {
        val now = System.currentTimeMillis()
        if (prefs.getBoolean(keyAdminBypass, false)) return false
        if (now < adminSessionUntilMs) return false
        if (now < expectedBackgroundUntilMs) return false
        if (isLockTaskModeActiveSafe()) return false
        return true
    }

    private fun bringTaskToFront() {
        try {
            val i = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(i)
        } catch (_: Throwable) {}
        applyImmersiveMode()
    }

    private fun logoutAdmin() {
        adminSessionUntilMs = 0L
    }

    private fun normalizeUrl(raw: String?): String {
        val v = raw?.trim() ?: ""
        if (v.isEmpty()) return ""
        if (v.startsWith("http://") || v.startsWith("https://")) return v
        if (v.contains("://")) return ""
        return "https://$v"
    }
}
