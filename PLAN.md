# Plan: Standalone Android YouTube Downloader (React + Capacitor + yt-dlp)

Goal: an APK where the React UI and the download engine both run on the phone. No server, no PC, no HTTP.

```
React UI (WebView)  <-- Capacitor bridge -->  Kotlin plugin  -->  youtubedl-android (yt-dlp + Python + ffmpeg)
```

Personal-use tool, sideloaded. Google Play does not allow YouTube downloaders, and downloading may violate YouTube's ToS.

---

## 0. Decisions already made

| Topic | Choice | Why |
|---|---|---|
| UI | React + Vite | Reuse the existing frontend |
| Shell | Capacitor | Wraps the web build into an APK, easy native plugins |
| Engine | youtubedl-android (junkfood02 fork) | Bundles yt-dlp, Python and ffmpeg for Android |
| Backend | None. Native Kotlin plugin | Replaces FastAPI, jobs and polling become events |
| Build | GitHub Actions (Android Studio optional) | Gradle does the real build |
| Distribution | Sideloaded debug/release APK | Play Store bans downloaders |

---

## 1. Prerequisites

- Node 20+, npm, Git, a GitHub account
- An Android phone (Android 8+; **Android 10+ recommended**, see MediaStore below)
- USB cable plus `adb` (platform-tools) for reading crash logs
- Optional: Android Studio for Logcat and debugging

---

## 2. Phase 1: Project scaffold

```bash
npm create vite@latest ytapp -- --template react
cd ytapp
npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap init ytapp com.example.ytapp --web-dir=dist
npm run build
npx cap add android
git init && git add . && git commit -m "scaffold"
```

Commit the `android/` folder. CI needs it.

**Done when:** `android/` exists and `npm run build` succeeds.

---

## 3. Phase 2: Gradle configuration

Edit `android/app/build.gradle`:

```gradle
android {
    defaultConfig {
        minSdk 29   // simplifies storage (MediaStore); use 24 only if you need older phones
    }
    packagingOptions {
        jniLibs { useLegacyPackaging = true }  // required so bundled binaries can be extracted
    }
}

dependencies {
    implementation "io.github.junkfood02.youtubedl-android:library:<latest>"
    implementation "io.github.junkfood02.youtubedl-android:ffmpeg:<latest>"
}
```

- Look up the current version in the library's README (check the repo's releases page). Do not guess it.
- Make sure `AndroidManifest.xml` has `INTERNET` permission.
- If the Gradle resolver can't find the artifact, check the README for the correct repository setup.

**Done when:** `./gradlew assembleDebug` compiles with the dependencies added.

---

## 4. Phase 3: Native plugin (`YtDlpPlugin.kt`)

Location: `android/app/src/main/java/com/example/ytapp/YtDlpPlugin.kt`

Responsibilities:

| Method / event | Purpose |
|---|---|
| `load()` | Init YoutubeDL and FFmpeg on a background thread (first launch unpacks Python and ffmpeg, so it is slow). Emits `ready` or `fatal`. |
| `download({id, url, format, quality})` | Builds the yt-dlp request, runs it on a worker thread, emits `progress`, resolves with the output path. |
| `cancel({id})` | `destroyProcessById(id)` |
| `update()` | Updates the bundled yt-dlp (STABLE channel) |

Format mapping (ported from the FastAPI version):

- **audio:** `-f bestaudio/best -x --audio-format mp3 --audio-quality {q}K --embed-thumbnail --convert-thumbnails jpg --add-metadata`
- **video (no audio):** `-f "bv*[height<=Q]/b[height<=Q]/bv*/b" -S "res,ext:mp4:m4a"`
- **video + audio:** `-f "bv*[height<=Q]+ba/b[height<=Q]/bv*+ba/b" -S "res,ext:mp4:m4a" --merge-output-format mp4`
- Always: `--no-playlist --windows-filenames --retries 10 --fragment-retries 10 -o "<dir>/%(title).150B.%(ext)s"`

Register in `MainActivity.kt`, **before** `super.onCreate`:

```kotlin
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(YtDlpPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
```

**Done when:** the app launches, the `ready` event fires, and a test download writes a file into the app's external files dir.

---

## 4b. Reliability: retry chain (port of the "safe mode")

In the `download` method, wrap execution in an attempt list:

1. **Full:** all options, including thumbnail embedding.
2. **Safe:** same, but drop `--embed-thumbnail`, `--convert-thumbnails` and `--add-metadata`, and use simple formats (`b[height<=Q]/b`).
3. **With cookies:** if `cookies.txt` exists, add `--cookies <path>` to both attempts.

Skip the retries when the error text contains: `private video`, `unavailable`, `removed`, `unsupported url`. Clear partial files in the output dir between attempts.

Map errors to friendly messages (sign-in or bot check, network, rate limit 429, ffmpeg problem), as the backend's `explain()` did.

---

## 5. Phase 4: React UI

Replace `fetch` and polling with the plugin:

```jsx
import { registerPlugin } from "@capacitor/core";
const YtDlp = registerPlugin("YtDlp");
```

State: `ready`, `job {id, status, progress, error, name}`.

- Listen to `ready`, `progress`, `fatal` in a `useEffect` and remove the listeners on cleanup.
- `start()` calls `YtDlp.download(...)` and awaits the result.
- Disable the Download button until `ready`. Show "Preparing…" on first launch.
- Buttons: Cancel (while running), Update yt-dlp, and later Import cookies.
- Quality lists: audio `128/192/320`, video `144 … 2160`, reset the default when the format changes.

**Done when:** the UI shows a progress bar and a saved filename after a real download.

---

## 6. Phase 5: Build online (GitHub Actions)

`.github/workflows/build.yml`:

```yaml
name: Build APK
on:
  push:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21 }  # Capacitor 6 -> 17, Capacitor 7 -> 21; check your version
      - run: npm ci
      - run: npm run build
      - run: npx cap sync android
      - name: Build debug APK
        working-directory: android
        run: |
          chmod +x gradlew
          ./gradlew assembleDebug
      - uses: actions/upload-artifact@v4
        with:
          name: app-debug
          path: android/app/build/outputs/apk/debug/app-debug.apk
```

Install flow: Actions tab, open the run, download the `app-debug` artifact, unzip, copy the APK to the phone, allow "Install unknown apps", install.

Debugging crashes: connect the phone over USB with USB debugging on and run `adb logcat | grep -i -E "ytapp|youtubedl|python"`.

**Done when:** pushing to GitHub produces an installable APK.

---

## 7. Phase 6: Save to the public Downloads folder (MediaStore)

By default files land in `Android/data/<package>/files/Download/`, which is hidden from most apps. After a successful download, copy the file into MediaStore, then delete the original:

```kotlin
private fun saveToDownloads(file: File, mime: String): Uri? {
    val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
        put(MediaStore.MediaColumns.MIME_TYPE, mime)
        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/YTDL")
    }
    val resolver = context.contentResolver
    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
    resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
    file.delete()
    return uri
}
```

- Mime types: `audio/mpeg` for mp3, `video/mp4` for mp4.
- Return the `uri` to JS so the UI can show "Saved to Downloads/YTDL".
- With `minSdk 29`, no storage permission is needed for this.

**Done when:** the file appears in the phone's Files app and music/video player.

---

## 8. Phase 7: Background downloads (foreground service)

Without this, Android kills downloads when the app is backgrounded.

1. Create `DownloadService : Service` that calls `startForeground()` with a notification ("Downloading…", with a progress bar).
2. Manifest: declare the service with `android:foregroundServiceType="dataSync"`, and add `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC` and `POST_NOTIFICATIONS` permissions.
3. Request `POST_NOTIFICATIONS` at runtime on Android 13+.
4. Start the service in `download()`, update the notification from the progress callback, and stop it when finished or cancelled.
5. Optionally ask the user to disable battery optimization for the app on aggressive OEM skins (Xiaomi, Oppo, etc.).

Check the current Android foreground-service type rules for the Android version you target. They have been tightened in recent releases.

**Done when:** a download continues with the screen off and the app in the background.

---

## 9. Phase 8: Cookies for sign-in and bot checks

There is no `COOKIE_BROWSER` on a phone.

1. Export `cookies.txt` (Netscape format) from a desktop browser extension, and send it to the phone.
2. Add a UI button "Import cookies" using a file picker (`<input type="file">` works in the Capacitor WebView), then pass the file text to a plugin method `saveCookies({text})`.
3. The plugin writes it to `context.filesDir/cookies.txt`.
4. `download()` adds `--cookies <path>` when the file exists (see 4b).

Treat the cookies file as sensitive. It's a login session. Keep it in app-private storage and never log it.

---

## 10. Phase 9: Keeping yt-dlp alive

yt-dlp breaks regularly when YouTube changes. On-device this is the main maintenance task.

- Call `YtDlp.update()` on app launch (if online) and expose the manual button.
- Show the current yt-dlp version in the UI (`YoutubeDL.getInstance().version(context)`).
- YouTube's JavaScript-challenge requirements for recent yt-dlp versions may need extra support on Android. Check the youtubedl-android issues and the Seal / YTDLnis apps for how they handle it, since this is the most likely source of "it stopped working".

---

## 11. Test checklist

- [ ] First launch: "Preparing…" then ready
- [ ] MP3 128 / 192 / 320 with thumbnail and tags
- [ ] Video, no audio (720p)
- [ ] Video + audio 1080p merges to mp4 and plays
- [ ] Quality missing (ask 2160p on a 720p video) falls back and still downloads
- [ ] Private / removed video shows a friendly error
- [ ] Cancel mid-download, partial files cleaned up
- [ ] Airplane mode mid-download gives a network error, no crash
- [ ] App backgrounded or screen off, download finishes
- [ ] File visible in Downloads/YTDL and plays in the system player
- [ ] Update button works
- [ ] Cookies import makes an age-restricted or sign-in video work

---

## 12. Known risks

| Risk | Mitigation |
|---|---|
| YouTube changes break yt-dlp | Auto-update on launch, manual update button |
| JS-challenge requirements on Android | Check library issues; watch Seal / YTDLnis |
| Foreground-service rules change | Check docs for your target API |
| APK size (~100 MB+) | Expected: Python + ffmpeg are bundled. Optionally build per-ABI APKs |
| Battery optimisation kills downloads | Foreground service + ask user to exempt the app |
| Play Store rejection | Sideload only |

---

## 13. Suggested order of work

1. Scaffold + Gradle deps + CI build that produces an APK (empty UI is fine)
2. Plugin with `load` + `download` (audio only), test on phone
3. React UI wired to the plugin, all three formats
4. Retry chain + error messages
5. MediaStore saving
6. Foreground service + notification
7. Cookies import
8. Update-on-launch, version display, polish (dark theme, progress ring)
9. Optional: signed release build with a keystore stored as a GitHub secret

## 14. Fallback if the native route stalls

Run the existing FastAPI backend inside **Termux** (`pkg install python ffmpeg`, `pip install fastapi uvicorn yt-dlp`) and serve the built React app as static files. Less polished, but still fully on-device and works with almost no code changes.
