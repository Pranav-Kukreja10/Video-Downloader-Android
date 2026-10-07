import { registerPlugin, Capacitor } from "@capacitor/core";

const Native = registerPlugin("YtDlp");

export const isNative = Capacitor.isNativePlatform();

// In a normal browser (npm run dev) there is no native engine,
// so these stubs let you work on the UI without a phone.
const stub = {
  async download({ id }) {
    for (let p = 0; p <= 100; p += 10) {
      await new Promise((r) => setTimeout(r, 200));
      stub._emit("progress", { id, progress: p });
    }
    return { name: "demo-file.mp3", uri: "" };
  },
  async cancel() {},
  async update() { return { status: "browser-demo" }; },
  async getInfo({ url }) {
    await new Promise((r) => setTimeout(r, 600));
    return { title: "Demo Video", thumbnail: "", duration: "03:14", uploader: "Demo Uploader" };
  },
  async getVersion() { return { version: "browser-demo" }; },
  async getInitialShareUrl() { return { url: "" }; },
  async saveCookies() {},
  async clearCookies() {},
  async hasCookies() { return { value: false }; },
  async playMedia({ uri, name }) {
    console.log("Playing media:", name, uri);
    alert(`[Device Player] Opening ${name || "media"} with default video player`);
    return { success: true };
  },
  _handlers: {},
  _emit(name, data) { (stub._handlers[name] || []).forEach((h) => h(data)); },
  async addListener(name, cb) {
    (stub._handlers[name] = stub._handlers[name] || []).push(cb);
    if (name === "ready") setTimeout(() => cb({}), 400);
    return { remove: async () => { stub._handlers[name] = stub._handlers[name].filter((h) => h !== cb); } };
  },
};

export const YtDlp = isNative ? Native : stub;
