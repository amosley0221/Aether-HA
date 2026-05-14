/* Aether — Home Assistant custom panel entry point.
   Registered via panel_custom in configuration.yaml. HA constructs
   <aether-panel/>, then sets element.hass, element.panel, element.narrow,
   element.route. We surface hass to React via window events. */

(() => {
  const BASE = "/local/aether";

  class AetherPanel extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._panel = null;
      this._narrow = false;
      this._route = null;
      this._booted = false;
    }

    async connectedCallback() {
      if (this._booted) return;
      this._booted = true;

      this.style.cssText = [
        "display:block",
        "height:100%",
        "overflow:auto",
        "color:#14181f",
        "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display','Inter',system-ui,sans-serif",
        "background:radial-gradient(900px 700px at 0% 0%, #cfe0f2 0%, rgba(207,224,242,.55) 22%, rgba(207,224,242,.18) 45%, transparent 70%), #ffffff",
        "--bg:#ffffff",
        "--bg-deep:#f4f6fa",
        "--paper:#ffffff",
        "--paper-2:#f7f9fc",
        "--hairline:rgba(15,28,46,.08)",
        "--hairline-2:rgba(15,28,46,.05)",
        "--ink:#14181f",
        "--ink-2:#46505f",
        "--ink-3:#8a93a3",
        "--ink-4:#b6bcc8",
        "--accent:#2A6FDB",
        "--accent-soft:#d7e5f3",
        "--accent-warm:#c97a52",
        "--shadow-soft:0 1px 2px rgba(0,0,0,.03), 0 8px 24px rgba(20,18,14,.05)",
        "--shadow-card:0 1px 2px rgba(0,0,0,.04), 0 12px 40px rgba(20,18,14,.06)",
        "--shadow-pop:0 1px 2px rgba(0,0,0,.05), 0 20px 60px rgba(20,18,14,.10)",
        "--radius-xl:22px",
        "--radius-lg:16px",
        "--radius-md:12px",
        "--radius-sm:10px",
      ].join(";") + ";";

      for (const css of ["styles.css", "home.css", "music.css", "dashboard.css"]) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `${BASE}/${css}`;
        this.appendChild(link);
      }

      const mount = document.createElement("div");
      mount.id = "aether-mount";
      mount.style.cssText = "min-height:100%;";
      this.appendChild(mount);

      window.__aetherMount = mount;
      window.__aetherHass = this._hass;
      window.__aetherPanel = this._panel;

      try {
        if (!window.React)    await loadScript("https://unpkg.com/react@18.3.1/umd/react.production.min.js");
        if (!window.ReactDOM) await loadScript("https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js");
        if (!window.Babel)    await loadScript("https://unpkg.com/@babel/standalone@7.29.0/babel.min.js");

        await loadJsx(`${BASE}/aether-config.js`);
        await loadJsx(`${BASE}/shared.jsx`);
        await loadJsx(`${BASE}/home.jsx`);
        await loadJsx(`${BASE}/music.jsx`);
        await loadJsx(`${BASE}/dashboard.jsx`);
        await loadJsx(`${BASE}/app.jsx`);
      } catch (err) {
        mount.innerHTML =
          `<pre style="padding:24px;color:#b6432e;font-family:ui-monospace,monospace;">
            Aether panel failed to load:\n${(err && err.stack) || err}
          </pre>`;
        console.error("[aether-panel]", err);
      }
    }

    set hass(hass) {
      this._hass = hass;
      window.__aetherHass = hass;
      window.dispatchEvent(new CustomEvent("aether-hass-update", { detail: hass }));
    }
    get hass() { return this._hass; }

    set panel(p) {
      this._panel = p;
      window.__aetherPanel = p;
      window.dispatchEvent(new CustomEvent("aether-panel-update", { detail: p }));
    }
    set narrow(n) { this._narrow = n; }
    set route(r) { this._route = r; }
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = res;
      s.onerror = () => rej(new Error(`failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  async function loadJsx(url) {
    const code = await fetch(url, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
      return r.text();
    });
    const compiled = window.Babel.transform(code, {
      presets: [["env", { targets: { esmodules: true } }], "react"],
      filename: url.split("/").pop(),
    }).code;
    (0, eval)(compiled);
  }

  if (!customElements.get("aether-panel")) {
    customElements.define("aether-panel", AetherPanel);
  }
})();
