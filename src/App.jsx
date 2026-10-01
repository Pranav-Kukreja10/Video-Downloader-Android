import { useEffect, useRef, useState } from "react";
import { YtDlp } from "./ytdlp.js";

const VIDEO_QUALITY_OPTIONS = [
  { val: 2160, label: "2160p (4K Ultra HD)", sub: "Maximum resolution stream" },
  { val: 1440, label: "1440p (2K Quad HD)", sub: "Crisp high fidelity" },
  { val: 1080, label: "1080p (Full HD)", sub: "Recommended for all screens" },
  { val: 720, label: "720p (High Definition)", sub: "Fast download, sharp visual" },
  { val: 480, label: "480p (Standard)", sub: "Lightweight mobile footprint" },
  { val: 360, label: "360p (Compact)", sub: "Minimum data usage" },
];

const AUDIO_QUALITY_OPTIONS = [
  { val: 320, label: "320 kbps (High Fidelity)", sub: "Studio grade lossless MP3" },
  { val: 192, label: "192 kbps (Standard)", sub: "Balanced audio fidelity" },
  { val: 128, label: "128 kbps (Lightweight)", sub: "Fast lightweight download" },
];

const FORMAT_OPTIONS = [
  {
    id: "video_audio",
    title: "Video + Audio",
    ext: "MP4",
    desc: "Merged high fidelity video with audio",
    type: "video",
  },
  {
    id: "video",
    title: "Video Only",
    ext: "MP4",
    desc: "Lossless video stream (no audio)",
    type: "video",
  },
  {
    id: "audio",
    title: "Audio Only",
    ext: "MP3",
    desc: "Extracted high quality audio",
    type: "audio",
  },
];

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("aura_mobile_theme") || "dark");
  const [activeTab, setActiveTab] = useState("studio"); // 'studio' | 'vault'
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("video_audio");
  const [quality, setQuality] = useState(1080);
  
  // Custom dropdown states
  const [formatOpen, setFormatOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);

  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState("");
  const [hasCookies, setHasCookies] = useState(false);
  
  // In-flight download job
  const [job, setJob] = useState(null); // { id, progress }
  
  // Persistent completed download banner (Never auto-hides after 1s)
  const [downloadResult, setDownloadResult] = useState(null); // { id, name, uri, format, quality }
  const [errorMessage, setErrorMessage] = useState("");
  
  const [note, setNote] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  // Vault history state saved in localStorage
  const [vaultItems, setVaultItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("aura_vault_items") || "[]");
    } catch {
      return [];
    }
  });

  const fileRef = useRef(null);
  const busy = Boolean(job && job.progress < 100);

  // Apply Theme & Theme-Color Meta
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("aura_mobile_theme", theme);
    const meta = document.getElementById("theme-color-meta");
    if (meta) {
      meta.setAttribute("content", theme === "dark" ? "#080d1e" : "#f2f7ff");
    }
  }, [theme]);

  // Sync Vault items to localStorage
  useEffect(() => {
    localStorage.setItem("aura_vault_items", JSON.stringify(vaultItems));
  }, [vaultItems]);

  // YtDlp listeners
  useEffect(() => {
    const subs = [
      YtDlp.addListener("ready", () => setReady(true)),
      YtDlp.addListener("progress", (e) => {
        setJob((j) => (j && j.id === e.id ? { ...j, progress: e.progress } : j));
      }),
      YtDlp.addListener("fatal", (e) => {
        setErrorMessage(e.error || "Engine failed to initialize.");
        setJob(null);
      }),
    ];
    return () => subs.forEach((s) => s.then((h) => h.remove()));
  }, []);

  useEffect(() => {
    if (!ready) return;
    YtDlp.getVersion().then((r) => setVersion(r.version)).catch(() => {});
    YtDlp.hasCookies().then((r) => setHasCookies(r.value)).catch(() => {});
  }, [ready]);

  // Close dropdowns on outside tap/click anywhere on screen
  useEffect(() => {
    if (!formatOpen && !qualityOpen) return;

    const handleOutsideClick = (e) => {
      if (!e.target.closest(".dropdown-group")) {
        setFormatOpen(false);
        setQualityOpen(false);
      }
    };

    window.addEventListener("pointerdown", handleOutsideClick);
    return () => {
      window.removeEventListener("pointerdown", handleOutsideClick);
    };
  }, [formatOpen, qualityOpen]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const handleFormatChange = (fId) => {
    setFormat(fId);
    setFormatOpen(false);
    if (fId === "audio") {
      setQuality(320);
    } else if (quality === 320 || quality === 192 || quality === 128) {
      setQuality(1080);
    }
  };

  const handleQualityChange = (qVal) => {
    setQuality(qVal);
    setQualityOpen(false);
  };

  const cleanMediaUrl = (input) => {
    let u = (input || "").trim();
    if (u.includes("instagram.com")) {
      u = u.replace("/share/reel/", "/reel/").replace("/share/p/", "/p/");
      const m = u.match(/(https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+)/);
      if (m) u = m[1] + "/";
    }
    return u;
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(cleanMediaUrl(text));
    } catch {
      // Browser permission prompt or fallback
    }
  };

  const startDownload = async () => {
    const targetUrl = cleanMediaUrl(url);
    if (!targetUrl) return;
    const id = String(Date.now());
    setErrorMessage("");
    setJob({ id, progress: 0 });

    try {
      const r = await YtDlp.download({ id, url: targetUrl, format, quality });
      
      const finishedItem = {
        id,
        name: r.name || "media_file",
        uri: r.uri || "",
        format,
        quality,
        date: new Date().toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      // Persistent success result banner (stays until user dismisses or starts new)
      setDownloadResult(finishedItem);
      setJob(null);

      // Save to Vault history
      setVaultItems((prev) => [finishedItem, ...prev.slice(0, 49)]);
      setUrl("");
    } catch (e) {
      setJob(null);
      setErrorMessage(e?.message || "Download failed. Please check the URL.");
    }
  };

  const cancelDownload = async () => {
    if (job?.id) {
      await YtDlp.cancel({ id: job.id });
      setJob(null);
    }
  };

  // Play media in default device video player
  const handlePlayMedia = async (item) => {
    if (!item) return;
    try {
      await YtDlp.playMedia({ uri: item.uri, name: item.name });
    } catch (err) {
      alert(`Could not open media: ${err?.message || err}`);
    }
  };

  const updateEngine = async () => {
    setNote("Updating yt-dlp…");
    try {
      await YtDlp.update();
      const r = await YtDlp.getVersion();
      setVersion(r.version);
      setNote("yt-dlp is up to date!");
    } catch (e) {
      setNote(`Update failed: ${e?.message || "Check connection"}`);
    }
  };

  const importCookies = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await YtDlp.saveCookies({ text: await file.text() });
      setHasCookies(true);
      setNote("Cookies imported successfully.");
    } catch (err) {
      setNote(`Cookie error: ${err?.message || ""}`);
    }
    e.target.value = "";
  };

  const removeCookies = async () => {
    await YtDlp.clearCookies();
    setHasCookies(false);
    setNote("Cookies removed.");
  };

  const removeVaultItem = (id) => {
    setVaultItems((prev) => prev.filter((item) => item.id !== id));
  };

  const clearVault = () => {
    if (window.confirm("Clear all vault download history?")) {
      setVaultItems([]);
    }
  };

  const currentFormatObj = FORMAT_OPTIONS.find((f) => f.id === format) || FORMAT_OPTIONS[0];
  const qualityList = format === "audio" ? AUDIO_QUALITY_OPTIONS : VIDEO_QUALITY_OPTIONS;
  const currentQualityObj = qualityList.find((q) => q.val === quality) || qualityList[0];

  return (
    <div className="mobile-viewport">
      <div className="aura-bg" />

      {/* TOP HEADER */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v8m0 0l3-3m-3 3L9 7" />
              <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
            </svg>
          </div>
          <div className="brand-text">
            <h1>Aura</h1>
          </div>
        </div>

        <div className="header-actions">
          {/* Theme Toggle */}
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          {/* Settings / Engine Modal */}
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Engine Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {/* TAB 1: STUDIO (DOWNLOAD PAGE) */}
      {activeTab === "studio" && (
        <main className="content-container">
          {/* Great Vibes Cursive Heading */}
          <div className="hero-heading">
            <h2 className="cursive-capture">Capture</h2>
          </div>

          {/* Main Download Card (One UI 9 slight blur) */}
          <div className="studio-card">
            {/* URL Input with Paste & Clear */}
            <div className="input-group">
              <label className="input-label" htmlFor="media-url">Media Link</label>
              <div className="input-wrapper">
                <span className="input-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                </span>
                <input
                  id="media-url"
                  className="url-input"
                  type="url"
                  inputMode="url"
                  placeholder="Paste YouTube or video link"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (errorMessage) setErrorMessage("");
                  }}
                  disabled={busy}
                />
                <div className="input-actions">
                  {url ? (
                    <button className="clear-btn" onClick={() => setUrl("")} aria-label="Clear link">
                      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  ) : (
                    <button className="paste-chip" onClick={handlePaste} type="button">
                      <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                      </svg>
                      Paste
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Custom Format Dropdown */}
            <div className="dropdown-group">
              <label className="input-label">Output Format</label>
              <button
                type="button"
                className="dropdown-trigger"
                onClick={() => {
                  setFormatOpen(!formatOpen);
                  setQualityOpen(false);
                }}
                disabled={busy}
              >
                <div className="dropdown-selected">
                  <div className="format-icon-badge">
                    {currentFormatObj.type === "audio" ? (
                      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                        <line x1="7" y1="2" x2="7" y2="22" />
                        <line x1="17" y1="2" x2="17" y2="22" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <line x1="2" y1="7" x2="7" y2="7" />
                        <line x1="2" y1="17" x2="7" y2="17" />
                        <line x1="17" y1="17" x2="22" y2="17" />
                        <line x1="17" y1="7" x2="22" y2="7" />
                      </svg>
                    )}
                  </div>
                  <div className="dropdown-selected-text">
                    <div className="dropdown-selected-title">{currentFormatObj.title} ({currentFormatObj.ext})</div>
                    <div className="dropdown-selected-sub">{currentFormatObj.desc}</div>
                  </div>
                </div>
                <div className={`dropdown-caret ${formatOpen ? "open" : ""}`}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              {/* Format Menu */}
              {formatOpen && (
                <div className="dropdown-menu">
                  {FORMAT_OPTIONS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`dropdown-item ${format === f.id ? "active" : ""}`}
                      onClick={() => handleFormatChange(f.id)}
                    >
                      <div className="dropdown-item-left">
                        <span className="dropdown-item-title">{f.title} ({f.ext})</span>
                        <span className="dropdown-item-desc">{f.desc}</span>
                      </div>
                      {format === f.id && (
                        <div className="check-icon">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Custom Quality Selector Dropdown (Replaces Pills) */}
            <div className="dropdown-group">
              <label className="input-label">
                {format === "audio" ? "Audio Bitrate" : "Video Resolution"}
              </label>
              <button
                type="button"
                className="dropdown-trigger"
                onClick={() => {
                  setQualityOpen(!qualityOpen);
                  setFormatOpen(false);
                }}
                disabled={busy}
              >
                <div className="dropdown-selected">
                  <div className="format-icon-badge">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </div>
                  <div className="dropdown-selected-text">
                    <div className="dropdown-selected-title">{currentQualityObj.label}</div>
                    <div className="dropdown-selected-sub">{currentQualityObj.sub}</div>
                  </div>
                </div>
                <div className={`dropdown-caret ${qualityOpen ? "open" : ""}`}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              {/* Quality Menu */}
              {qualityOpen && (
                <div className="dropdown-menu">
                  {qualityList.map((q) => (
                    <button
                      key={q.val}
                      type="button"
                      className={`dropdown-item ${quality === q.val ? "active" : ""}`}
                      onClick={() => handleQualityChange(q.val)}
                    >
                      <div className="dropdown-item-left">
                        <span className="dropdown-item-title">{q.label}</span>
                        <span className="dropdown-item-desc">{q.sub}</span>
                      </div>
                      {quality === q.val && (
                        <div className="check-icon">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Action Download Button */}
            <button
              className="download-action-btn"
              onClick={startDownload}
              disabled={!ready || busy || !url.trim()}
              type="button"
            >
              <div className="btn-shine" />
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>{!ready ? "Starting Engine…" : busy ? "Downloading…" : "Download"}</span>
            </button>
          </div>

          {/* Active Download Progress Card */}
          {busy && (
            <div className="progress-card">
              <div className="progress-header">
                <div className="progress-title-row">
                  <div className="spin-icon">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="2" x2="12" y2="6" />
                      <line x1="12" y1="18" x2="12" y2="22" />
                      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                      <line x1="2" y1="12" x2="6" y2="12" />
                      <line x1="18" y1="12" x2="22" y2="12" />
                      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                    </svg>
                  </div>
                  <span className="progress-text">
                    {job.progress === 0 ? "Connecting & Resolving…" : "Downloading Media…"}
                  </span>
                </div>
                <span className="progress-pct">{job.progress}%</span>
              </div>

              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.max(job.progress, 5)}%` }} />
              </div>

              <div className="progress-footer">
                <span className="progress-sub">
                  {job.progress === 0 ? "Analyzing stream link" : `${job.progress}% completed`}
                </span>
                <button className="cancel-btn" onClick={cancelDownload} type="button">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Persistent Download Success Banner (Fixed: Does NOT disappear after 1 second!) */}
          {downloadResult && (
            <div className="success-banner">
              <div className="success-top-row">
                <div className="success-left">
                  <div className="success-icon">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </div>
                  <div>
                    <div className="success-title">{downloadResult.name}</div>
                    <div className="success-sub">Saved to Downloads/Capture</div>
                  </div>
                </div>
                <button
                  className="dismiss-btn"
                  onClick={() => setDownloadResult(null)}
                  title="Dismiss"
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="success-actions-row">
                <button
                  className="play-action-btn"
                  onClick={() => handlePlayMedia(downloadResult)}
                  type="button"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span>Play {downloadResult.format === "audio" ? "Audio" : "Video"}</span>
                </button>

                <button
                  className="vault-link-btn"
                  onClick={() => setActiveTab("vault")}
                  type="button"
                >
                  View Vault
                </button>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="error-banner">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{errorMessage}</span>
            </div>
          )}
        </main>
      )}

      {/* TAB 2: VAULT (DOWNLOADS HISTORY WITH PLAY VIDEO OPTION) */}
      {activeTab === "vault" && (
        <main className="content-container vault-container">
          <div className="vault-header-row">
            <h2 className="vault-title">Media Vault</h2>
            {vaultItems.length > 0 && (
              <button className="vault-clear-btn" onClick={clearVault} type="button">
                Clear All
              </button>
            )}
          </div>

          {vaultItems.length === 0 ? (
            <div className="vault-empty-card">
              <div className="empty-icon-wrap">
                <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <polyline points="12 11 12 17" />
                  <polyline points="9 14 12 17 15 14" />
                </svg>
              </div>
              <h3>Vault is Empty</h3>
              <p>Your downloaded videos and songs will be organized here once captured.</p>
              <button
                className="empty-action-btn"
                onClick={() => setActiveTab("studio")}
                type="button"
              >
                Start Downloading
              </button>
            </div>
          ) : (
            <div className="vault-list">
              {vaultItems.map((item) => (
                <div key={item.id} className="vault-item-card">
                  <div className="vault-item-left">
                    <div className="vault-item-icon">
                      {item.format === "audio" ? (
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 18V5l12-2v13" />
                          <circle cx="6" cy="18" r="3" />
                          <circle cx="18" cy="16" r="3" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="23 7 16 12 23 17 23 7" />
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                        </svg>
                      )}
                    </div>
                    <div className="vault-item-info">
                      <div className="vault-item-name">{item.name}</div>
                      <div className="vault-item-meta">
                        <span className="vault-badge">
                          {item.format === "audio" ? "MP3" : "MP4"}
                        </span>
                        <span>{item.quality ? `${item.quality}${item.format === "audio" ? "k" : "p"}` : ""}</span>
                        <span>•</span>
                        <span>{item.date}</span>
                      </div>
                    </div>
                  </div>

                  <div className="vault-actions">
                    {/* Play in Default Device Video Player Button */}
                    <button
                      className="vault-play-btn"
                      onClick={() => handlePlayMedia(item)}
                      title="Play in device video player"
                      type="button"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <polygon points="6 4 20 12 6 20 6 4" />
                      </svg>
                    </button>

                    <button
                      className="vault-del-btn"
                      onClick={() => removeVaultItem(item.id)}
                      aria-label="Delete item from history"
                      type="button"
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {/* SETTINGS / ENGINE MODAL (Hidden from main screen) */}
      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="settings-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <h3 className="sheet-title">Engine Configuration</h3>
              <button className="clear-btn" onClick={() => setShowSettings(false)}>
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="sheet-section">
              <div className="setting-row">
                <div>
                  <div className="setting-label">yt-dlp Core</div>
                  <div className="setting-sub">{version ? `v${version}` : "Bundled On-Device"}</div>
                </div>
                <button className="sheet-btn" onClick={updateEngine} disabled={!ready || busy}>
                  Update Core
                </button>
              </div>

              <div className="setting-row">
                <div>
                  <div className="setting-label">Session Cookies</div>
                  <div className="setting-sub">{hasCookies ? "Active session loaded" : "No cookies imported"}</div>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button className="sheet-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                    Import
                  </button>
                  {hasCookies && (
                    <button className="sheet-btn" onClick={removeCookies} disabled={busy}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <input ref={fileRef} type="file" accept=".txt" hidden onChange={importCookies} />
            </div>

            <p className="sheet-hint">
              Downloaded media is saved to your phone at <strong>Downloads/Capture</strong> and can be played with your default player.
            </p>

            {note && <div className="success-banner" style={{ margin: 0 }}>{note}</div>}
          </div>
        </div>
      )}

      {/* FIXED BOTTOM NAVIGATION BAR */}
      <nav className="bottom-nav">
        <button
          className={`nav-tab ${activeTab === "studio" ? "active" : ""}`}
          onClick={() => setActiveTab("studio")}
          type="button"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span className="nav-label">Studio</span>
        </button>

        <button
          className={`nav-tab ${activeTab === "vault" ? "active" : ""}`}
          onClick={() => setActiveTab("vault")}
          type="button"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="nav-label">Vault</span>
          {vaultItems.length > 0 && <span className="tab-badge">{vaultItems.length}</span>}
        </button>
      </nav>
    </div>
  );
}
