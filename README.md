# YT Saver (Android, fully on-device)

React UI in a Capacitor WebView + a Kotlin plugin that runs yt-dlp (with bundled Python and ffmpeg) on the phone.
No server. For personal use, sideloaded. Downloading from YouTube may violate its Terms of Service, and Google Play does not allow such apps.

## Build the APK online (no Android Studio)

1. Create a GitHub repo and push this folder (the `android/` folder must be committed).
2. Open the **Actions** tab, run **Build APK** (it also runs on every push).
3. When it finishes, download the **app-debug** artifact, unzip it, copy `app-debug.apk` to your phone and install it
   (allow "Install unknown apps" for your file manager or browser).

## Develop the UI in a browser

```bash
npm install
npm run dev      # uses a fake download engine so you can style the UI
```

## Build locally

```bash
npm install
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug     # gradlew.bat on Windows (JDK 21 + Android SDK needed)
```

## Where things are

| Path | What |
|---|---|
| `src/App.jsx`, `src/styles.css` | UI |
| `src/ytdlp.js` | Bridge to the native plugin (browser stub when not on Android) |
| `android/app/src/main/java/com/example/ytapp/YtDlpPlugin.kt` | Download engine, retry chain, cookies, save to Downloads |
| `android/app/src/main/java/com/example/ytapp/DownloadService.kt` | Foreground service + notification |
| `android/app/build.gradle` | youtubedl-android dependencies (version 0.18.1) |
| `PLAN.md` | Full project plan |

Downloads are saved to `Downloads/YTSaver`.

## First things to try if something breaks

- Tap **Update yt-dlp** in the app. Most failures are an outdated yt-dlp.
- Sign-in or bot errors: export `cookies.txt` from a logged-in desktop browser and use **Import cookies**.
- Crashes: connect the phone by USB and run `adb logcat | grep -i -E "ytapp|youtubedl|python"`.
- If CI fails on the library API (for example the `execute(...)` callback signature), compare against the youtubedl-android README for the version in `android/app/build.gradle`.
