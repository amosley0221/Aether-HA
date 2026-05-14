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

      this.style.cssText = "display:block;height:100%;overflow:auto;";

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
