package com.example.ytapp

import android.app.Application
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import kotlin.concurrent.thread

@CapacitorPlugin(name = "YtDlp")
class YtDlpPlugin : Plugin() {

    companion object {
        @Volatile
        var instance: YtDlpPlugin? = null
        @Volatile
        var initialSharedUrl: String? = null

        fun handleIncomingIntent(intent: Intent?) {
            if (intent == null) return
            if (intent.action == Intent.ACTION_SEND && intent.type?.startsWith("text/") == true) {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                if (!text.isNullOrBlank()) {
                    initialSharedUrl = text
                    instance?.let { plugin ->
                        plugin.notifyListeners("shared_url", JSObject().put("url", text), true)
                    }
                }
            }
        }
    }

    @Volatile private var initialised = false

    override fun load() {
        instance = this
        // First launch unpacks Python + ffmpeg, so keep it off the main thread.
        thread {
            try {
                // Cleanup orphaned downloads from previous abrupt exits
                val base = context.getExternalFilesDir(null) ?: context.cacheDir
                val dlFolder = File(base, "dl")
                if (dlFolder.exists()) dlFolder.deleteRecursively()

                val app = context.applicationContext as Application
                YoutubeDL.getInstance().init(app)
                FFmpeg.getInstance().init(app)
                initialised = true
                notifyListeners("ready", JSObject(), true)
            } catch (e: Exception) {
                notifyListeners("fatal", JSObject().put("error", "Engine failed to start: ${e.message}"), true)
            }
        }
    }

    // ---------------------------------------------------------------- download
    
    private var activeDownloads = 0
    private val activeDownloadsLock = Any()

    private fun incrementDownloads() {
        synchronized(activeDownloadsLock) {
            if (activeDownloads == 0) DownloadService.start(context)
            activeDownloads++
        }
    }

    private fun decrementDownloads() {
        synchronized(activeDownloadsLock) {
            activeDownloads--
            if (activeDownloads <= 0) {
                activeDownloads = 0
                DownloadService.stop(context)
            }
        }
    }

    @PluginMethod
    fun getInfo(call: PluginCall) {
        val rawUrl = call.getString("url")
        if (rawUrl.isNullOrBlank() || !rawUrl.trim().matches(Regex("^https?://.+"))) {
            return call.reject("Enter a valid link")
        }
        val url = cleanUrl(rawUrl)
        
        thread {
            try {
                val req = YoutubeDLRequest(url)
                req.addOption("--dump-json")
                req.addOption("--no-playlist")
                req.addOption("--skip-download")
                req.addOption("--socket-timeout", "10")
                req.addOption("--force-ipv4")
                req.addOption("--no-warnings")
                if (cookiesFile().exists()) req.addOption("--cookies", cookiesFile().absolutePath)
                
                val res = YoutubeDL.getInstance().execute(req)
                val json = org.json.JSONObject(res.out ?: "{}")
                
                val title = json.optString("title", "Unknown Stream")
                val duration = json.optLong("duration", 0L)
                val uploader = json.optString("uploader", json.optString("channel", "Web Stream"))
                
                var thumb = json.optString("thumbnail", "")
                if (thumb.isEmpty() && json.has("thumbnails")) {
                    val thumbs = json.optJSONArray("thumbnails")
                    if (thumbs != null && thumbs.length() > 0) {
                        thumb = thumbs.getJSONObject(thumbs.length() - 1).optString("url", "")
                    }
                }
                
                val minutes = duration / 60
                val seconds = duration % 60
                val durationStr = if (duration > 0) String.format("%02d:%02d", minutes, seconds) else "Live Stream"

                call.resolve(
                    JSObject()
                        .put("title", title)
                        .put("thumbnail", thumb)
                        .put("duration", durationStr)
                        .put("uploader", uploader)
                )
            } catch (e: Exception) {
                call.reject(explain(e.message ?: "Failed to fetch info"))
            }
        }
    }

    @PluginMethod
    fun download(call: PluginCall) {
        val rawUrl = call.getString("url")
        if (rawUrl.isNullOrBlank() || !rawUrl.trim().matches(Regex("^https?://.+"))) {
            return call.reject("Enter a link that starts with http:// or https://")
        }
        if (!initialised) return call.reject("The download engine is still starting. Try again in a moment.")

        val url = cleanUrl(rawUrl)
        val format = call.getString("format") ?: "video_audio"
        val quality = call.getInt("quality") ?: 1080
        val id = call.getString("id") ?: System.currentTimeMillis().toString()

        val base = context.getExternalFilesDir(null) ?: context.cacheDir
        val outDir = File(base, "dl/$id").apply { mkdirs() }

        incrementDownloads()
        notifyListeners("progress", JSObject().put("id", id).put("progress", 0))

        thread {
            var lastError = "Unknown error"
            try {
                // full -> safe, then the same two again with cookies if the user imported them
                val attempts = mutableListOf(false to false, true to false) // (safe, cookies)
                if (cookiesFile().exists()) attempts += listOf(false to true, true to true)

                var done: File? = null
                for ((safe, cookies) in attempts) {
                    try {
                        outDir.listFiles()?.forEach { it.deleteRecursively() }
                        val req = buildRequest(url, format, quality, outDir, safe, cookies)
                        var last = -1
                        YoutubeDL.getInstance().execute(req, id) { progress, _, line ->
                            val p = progress.toInt().coerceIn(0, 99)
                            if (p != last) {
                                last = p
                                notifyListeners("progress", JSObject().put("id", id).put("progress", p))
                                DownloadService.update(context, p)
                            }
                            if (line.contains("ERROR:")) {
                                notifyListeners("realtime_error", JSObject().put("id", id).put("error", line.substringAfter("ERROR:").trim()))
                            }
                        }
                        done = newestMedia(outDir)
                        if (done != null) break
                        lastError = "Download finished but no output file was found"
                    } catch (e: Exception) {
                        lastError = e.message ?: e.toString()
                        if (isFatal(lastError)) break // retrying cannot help
                    }
                }

                val file = done
                if (file == null) {
                    call.reject(explain(lastError))
                } else {
                    val uri = saveToDownloads(file)
                    call.resolve(
                        JSObject().put("name", file.name).put("uri", uri?.toString() ?: "")
                    )
                }
            } catch (e: Exception) {
                call.reject(explain(e.message ?: e.toString()))
            } finally {
                outDir.deleteRecursively()
                decrementDownloads()
            }
        }
    }

    private fun cleanUrl(raw: String): String {
        var u = raw.trim()
        val urlMatch = Regex("""(https?://[^\s]+)""").find(u)
        if (urlMatch != null) {
            u = urlMatch.groupValues[1]
        }

        if (u.contains("instagram.com")) {
            u = u.replace("/share/reel/", "/reel/")
                .replace("/share/p/", "/p/")
            val regex = Regex("""(https?://(?:www\.|m\.)?instagram\.com/(?:reel|reels|p|tv)/[A-Za-z0-9_-]+)""")
            val match = regex.find(u)
            if (match != null) {
                u = match.groupValues[1] + "/"
            }
        } else if (u.contains("youtu.be/")) {
            val m = Regex("""(https?://youtu\.be/[A-Za-z0-9_-]+)""").find(u)
            if (m != null) u = m.groupValues[1]
        } else if (u.contains("youtube.com/watch")) {
            val m = Regex("""(https?://(?:www\.|m\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]+)""").find(u)
            if (m != null) u = m.groupValues[1]
        } else if (u.contains("youtube.com/shorts/")) {
            val m = Regex("""(https?://(?:www\.|m\.)?youtube\.com/shorts/[A-Za-z0-9_-]+)""").find(u)
            if (m != null) u = m.groupValues[1]
        } else if (u.contains("twitter.com/") || u.contains("x.com/")) {
            val m = Regex("""(https?://(?:www\.)?(?:twitter|x)\.com/[A-Za-z0-9_]+/status/\d+)""").find(u)
            if (m != null) u = m.groupValues[1]
        }
        return u
    }

    private fun buildRequest(
        url: String, format: String, q: Int, outDir: File, safe: Boolean, cookies: Boolean
    ): YoutubeDLRequest {
        val req = YoutubeDLRequest(url)
        req.addOption("--no-playlist")
        req.addOption("--windows-filenames")
        req.addOption("--no-mtime")
        req.addOption("--retries", "5")
        req.addOption("--fragment-retries", "5")
        req.addOption("--extractor-retries", "3")
        req.addOption("--socket-timeout", "10")
        req.addOption("--force-ipv4") // Fixes initial 5-10s hang on networks with broken IPv6
        req.addOption("-N", "4") // Multi-threaded 4 concurrent fragment streams for fast download
        req.addOption("-o", "${outDir.absolutePath}/%(title).150B.%(ext)s")
        
        // Let yt-dlp use its default user-agent and extractor logic
        // Forcing a custom user-agent breaks YouTube's Android API client (causing throttling) 
        // and breaks Instagram's extractor.
        if (cookies) req.addOption("--cookies", cookiesFile().absolutePath)

        when (format) {
            "audio" -> {
                req.addOption("-f", "bestaudio/best")
                req.addOption("-x")
                req.addOption("--audio-format", "mp3")
                req.addOption("--audio-quality", "${q}K")
                if (!safe) { // thumbnail + tags are nice-to-have; safe mode skips them
                    req.addOption("--embed-thumbnail")
                    req.addOption("--convert-thumbnails", "jpg")
                    req.addOption("--add-metadata")
                }
            }
            "video" -> {
                val f = if (safe) {
                    "b[height<=$q]/b[width<=$q]/bestvideo/best"
                } else {
                    "bv*[height<=$q]/bv*[width<=$q]/b[height<=$q]/b[width<=$q]/bestvideo/best"
                }
                req.addOption("-f", f)
                req.addOption("-S", "res,ext:mp4:m4a")
            }
            else -> {
                val f = if (safe) {
                    "b[height<=$q]/b[width<=$q]/bv*+ba/best"
                } else {
                    "bv*[height<=$q]+ba/bv*[width<=$q]+ba/b[height<=$q]/b[width<=$q]/bv*+ba/best"
                }
                req.addOption("-f", f)
                req.addOption("-S", "res,ext:mp4:m4a")
                req.addOption("--merge-output-format", "mp4")
            }
        }
        return req
    }

    // ------------------------------------------------------------------ other

    @PluginMethod
    fun cancel(call: PluginCall) {
        YoutubeDL.getInstance().destroyProcessById(call.getString("id") ?: "")
        call.resolve()
    }

    @PluginMethod
    fun update(call: PluginCall) {
        thread {
            try {
                val r = YoutubeDL.getInstance().updateYoutubeDL(context)
                call.resolve(JSObject().put("status", r.toString()))
            } catch (e: Exception) {
                call.reject(e.message ?: "Update failed")
            }
        }
    }

    @PluginMethod
    fun getVersion(call: PluginCall) {
        thread {
            val v = try { YoutubeDL.getInstance().version(context) } catch (e: Exception) { null }
            call.resolve(JSObject().put("version", v ?: "unknown"))
        }
    }

    @PluginMethod
    fun saveCookies(call: PluginCall) {
        val text = call.getString("text")
        if (text.isNullOrBlank()) return call.reject("The cookies file is empty")
        cookiesFile().writeText(text)
        call.resolve()
    }

    @PluginMethod
    fun clearCookies(call: PluginCall) {
        cookiesFile().delete()
        call.resolve()
    }

    @PluginMethod
    fun hasCookies(call: PluginCall) {
        call.resolve(JSObject().put("value", cookiesFile().exists()))
    }

    @PluginMethod
    fun playMedia(call: PluginCall) {
        val uriStr = call.getString("uri")
        val name = call.getString("name") ?: ""
        if (uriStr.isNullOrBlank()) {
            return call.reject("No media URI provided")
        }

        try {
            val uri = Uri.parse(uriStr)
            val ext = name.substringAfterLast('.', "").lowercase()
            val mime = when (ext) {
                "mp3" -> "audio/mpeg"
                "m4a" -> "audio/mp4"
                "opus" -> "audio/ogg"
                "webm" -> "video/webm"
                "mkv" -> "video/x-matroska"
                else -> "video/*"
            }

            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Could not open media player: ${e.message}")
        }
    }

    @PluginMethod
    fun getInitialShareUrl(call: PluginCall) {
        val u = initialSharedUrl ?: ""
        initialSharedUrl = null
        call.resolve(JSObject().put("url", u))
    }

    // ---------------------------------------------------------------- helpers

    private fun cookiesFile() = File(context.filesDir, "cookies.txt")

    private val mediaExt = setOf("mp3", "mp4", "mkv", "webm", "m4a", "opus", "mov")

    private fun newestMedia(dir: File): File? =
        dir.listFiles()
            ?.filter { it.isFile && it.extension.lowercase() in mediaExt }
            ?.maxByOrNull { it.lastModified() }

    /** Copies the finished file into Downloads/Capture so it shows up in Files and media players. */
    private fun saveToDownloads(file: File): Uri? {
        val mime = when (file.extension.lowercase()) {
            "mp3" -> "audio/mpeg"
            "m4a" -> "audio/mp4"
            "opus" -> "audio/ogg"
            "webm" -> "video/webm"
            "mkv" -> "video/x-matroska"
            else -> "video/mp4"
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Capture")
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw RuntimeException("Could not create the file in Downloads")
        resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
        file.delete()
        return uri
    }

    private val fatalMarkers = listOf(
        "private video", "video unavailable", "unsupported url", "has been removed",
        "members-only", "this live event", "not a valid url"
    )

    private fun isFatal(msg: String) = fatalMarkers.any { msg.lowercase().contains(it) }

    private fun explain(msg: String): String {
        val low = msg.lowercase()
        return when {
            "sign in" in low || "not a bot" in low || "confirm your age" in low ->
                "Site requested sign-in check. Import cookies.txt or tap Update Core."
            "instagram" in low && ("login" in low || "checkpoint" in low || "redirect" in low) ->
                "Instagram requested login for this reel. Import cookies.txt or tap Update Core."
            "ffmpeg" in low || "ffprobe" in low -> "ffmpeg problem. Reinstall the app."
            "private video" in low -> "This video is private."
            "unavailable" in low || "removed" in low -> "This video is unavailable."
            "429" in low || "too many requests" in low -> "YouTube is rate-limiting you. Wait a few minutes."
            "unable to resolve" in low || "timed out" in low || "urlopen" in low || "getaddrinfo" in low ->
                "Network problem. Check your connection."
            "nsig" in low || "challenge" in low || "requested format is not available" in low ->
                "YouTube changed something. Tap Update yt-dlp and try again."
            else -> msg.take(300)
        }
    }
}
