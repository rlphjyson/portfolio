/* ==========================================================================
   rlphjyson.dev — a terminal you can ssh into (sort of).
   Vanilla JS, no build step. Content lives in data/*.json.

   Modes:   NORMAL   vim motions over the panels
            COMMAND  `:` ex-style command line (tab completion, history)
            SEARCH   `/` telescope-style fuzzy finder
            TERMINAL `` ` `` or :term — a tiny shell over a virtual filesystem
            VIEW     screenshot viewer
            HELP     `?`
   ========================================================================== */
(() => {
  "use strict";

  /* ---------- tiny helpers ---------------------------------------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const isMobile = () => window.matchMedia("(max-width: 860px)").matches;
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const store = {
    get(k) {
      try { return localStorage.getItem("rlphjyson:" + k); } catch (e) { return null; }
    },
    set(k, v) {
      try { localStorage.setItem("rlphjyson:" + k, v); } catch (e) { /* private mode */ }
    },
    sget(k) {
      try { return sessionStorage.getItem("rlphjyson:" + k); } catch (e) { return null; }
    },
    sset(k, v) {
      try { sessionStorage.setItem("rlphjyson:" + k, v); } catch (e) { /* ignore */ }
    },
  };

  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const HL_COLORS = ["c-cyan", "c-orange", "c-green", "c-magenta", "c-yellow", "c-blue"];

  /** "{{word}}" → coloured span. Deterministic so colours don't flicker. */
  const colorize = (s) => {
    let i = 0;
    return esc(s).replace(/\{\{(.+?)\}\}/g, (_, m) => `<span class="${HL_COLORS[i++ % HL_COLORS.length]}">${m}</span>`);
  };
  const plain = (s) => String(s ?? "").replace(/\{\{(.+?)\}\}/g, "$1");

  const hash7 = (s) => {
    let h = 2166136261;
    for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return (h >>> 0).toString(16).padStart(8, "0").slice(0, 7);
  };

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  const openUrl = (url) => window.open(url, "_blank", "noopener");

  /* ---------- state ------------------------------------------------------- */

  const THEMES = ["rlphjyson", "tokyonight", "gruvbox", "catppuccin", "dracula", "nord", "matrix", "paper"];

  const S = {
    data: null,
    panels: [],
    p: 0,
    sel: {},
    mode: "NORMAL",
    pending: "",
    hl: "", // active search highlight
    lastSearch: { query: "", results: [], idx: -1 },
    cmdHistory: [],
    cmdHistIdx: -1,
    wild: { items: [], idx: -1, base: "" },
    lb: { images: [], i: 0, title: "" },
    diagrams: new Map(),
    mermaid: null,
    theme: document.documentElement.getAttribute("data-theme") || "rlphjyson",
    term: { cwd: ["home", "guest"], history: [], hIdx: -1 },
  };

  /* ---------- data -------------------------------------------------------- */

  async function loadData() {
    const get = async (f) => {
      const r = await fetch(f, { cache: "no-cache" });
      if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
      return r.json();
    };
    const [profile, experience, projects, skills, stack] = await Promise.all([
      get("data/profile.json"),
      get("data/experience.json"),
      get("data/projects.json"),
      get("data/skills.json"),
      get("data/stack.json"),
    ]);
    return { profile, experience: experience.data, projects: projects.data, skills: skills.data, stack };
  }

  async function loadDiagram(file) {
    if (S.diagrams.has(file)) return S.diagrams.get(file);
    const p = fetch(file)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
      .catch(() => null);
    S.diagrams.set(file, p);
    return p;
  }

  const stackOf = (key) => S.data.stack[key] || { label: key, glyph: "•" };

  function iconHTML(key, cls = "") {
    const t = stackOf(key);
    if (t.icon) return `<img class="${cls}" src="images/stack/${t.icon}.svg" alt="" width="16" height="16" loading="lazy" decoding="async" />`;
    return `<span class="glyph ${cls}" aria-hidden="true">${esc(t.glyph || "•")}</span>`;
  }

  function chipHTML(key, { clickable = true } = {}) {
    const t = stackOf(key);
    const inner = `${iconHTML(key)}<span>${esc(t.label)}</span>`;
    return clickable
      ? `<button type="button" class="chip" data-tech="${esc(key)}" title="Where I've used ${esc(t.label)}">${inner}</button>`
      : `<span class="chip">${inner}</span>`;
  }

  const skillIndexFor = (key) => S.data.skills.findIndex((s) => s.items.includes(key));

  function usedIn(key) {
    const projects = S.data.projects.filter((p) => p.stack.includes(key));
    const jobs = S.data.experience.filter((e) => (e.stack || []).includes(key));
    return { projects, jobs };
  }

  function careerUptime() {
    const start = new Date(S.data.profile.careerStart);
    const now = new Date();
    let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    const y = Math.floor(months / 12);
    months %= 12;
    return `${y} years, ${months} month${months === 1 ? "" : "s"}`;
  }

  function shortRange(date, current) {
    const years = date.match(/\d{4}/g) || [];
    if (current) return `${years[0]}–now`;
    if (years.length < 2 || years[0] === years[1]) return years[0] || "";
    return `${years[0]}–${years[1].slice(2)}`;
  }

  /* ---------- panels ------------------------------------------------------ */

  function buildPanels() {
    const { experience, projects, skills, profile } = S.data;
    S.panels = [
      { id: "whoami", title: "whoami", items: [] },
      {
        id: "experience",
        title: "experience",
        items: experience.map((e) => ({
          id: e.id,
          label: e.company,
          meta: shortRange(e.date, e.current),
          glyph: e.current ? "●" : "○",
        })),
      },
      {
        id: "projects",
        title: "projects",
        items: projects.map((p) => ({ id: p.id, label: p.name, icon: p.stack[0], meta: p.pub ? "pub.dev" : (p.date.match(/\d{4}/g) || [""]).pop() })),
      },
      {
        id: "skills",
        title: "skills",
        items: skills.map((s) => ({ id: s.id, label: s.name, img: s.icon, glyph: s.glyph })),
      },
      {
        id: "contact",
        title: "contact",
        items: [
          { id: "email", label: "email", glyph: "✉", meta: "mail", url: `mailto:${profile.email}`, value: profile.email },
          { id: "github", label: "github", img: "github", meta: "rlphjyson", url: profile.github, value: profile.github },
          { id: "linkedin", label: "linkedin", glyph: "in", meta: "Ralph Burgos", url: profile.linkedin, value: profile.linkedin },
        ],
      },
    ];
    S.panels.forEach((p) => (S.sel[p.id] = 0));
  }

  function itemIconHTML(it) {
    if (it.icon) return iconHTML(it.icon);
    if (it.img) return `<img src="images/stack/${esc(it.img)}.svg" alt="" width="16" height="16" />`;
    if (it.glyph) return `<span class="glyph" aria-hidden="true">${esc(it.glyph)}</span>`;
    return "";
  }

  function renderSidebar() {
    const { profile } = S.data;
    const side = $("#sidebar");
    side.innerHTML = S.panels
      .map((panel, pi) => {
        let body;
        if (panel.id === "whoami") {
          body = `<dl class="whoami-mini">
              <dt>user</dt><dd>${esc(profile.name)}</dd>
              <dt>role</dt><dd>${esc(profile.role)}</dd>
              <dt>loc</dt><dd>Batangas, PH</dd>
              <dt>uptime</dt><dd>${esc(careerUptime())}</dd>
            </dl>`;
        } else {
          body = `<ul class="list" role="listbox" aria-label="${esc(panel.title)}">${panel.items
            .map(
              (it, i) => `<li class="item" role="option" data-i="${i}" aria-selected="false">
                ${itemIconHTML(it)}<span class="label">${esc(it.label)}</span>${it.meta ? `<span class="meta">${esc(it.meta)}</span>` : ""}
              </li>`,
            )
            .join("")}</ul>`;
        }
        const footer = panel.items.length ? `<div class="box-footer" data-footer>1 of ${panel.items.length}</div>` : "";
        return `<section class="box panel" data-panel="${panel.id}" data-p="${pi}">
            <div class="box-title">[${pi + 1}] ${esc(panel.title)}</div>
            ${body}${footer}
          </section>`;
      })
      .join("");

    $("#tabs").innerHTML = S.panels
      .map((p, i) => `<button type="button" data-p="${i}" aria-current="false">${i + 1}:${esc(p.title)}</button>`)
      .join("");
  }

  function updateSidebar() {
    $$("#sidebar .panel").forEach((el, pi) => {
      const panel = S.panels[pi];
      const active = pi === S.p;
      el.classList.toggle("active", active);
      const sel = S.sel[panel.id];
      $$(".item", el).forEach((li, i) => {
        const on = i === sel;
        li.classList.toggle("selected", on);
        li.setAttribute("aria-selected", on && active ? "true" : "false");
      });
      const f = $("[data-footer]", el);
      if (f) f.textContent = `${sel + 1} of ${panel.items.length}`;
      const cur = $(".item.selected", el);
      const list = $(".list", el);
      if (cur && list && !isMobile()) {
        const top = cur.offsetTop - list.offsetTop;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + cur.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + cur.offsetHeight - list.clientHeight;
      }
    });
    $$("#tabs button").forEach((b, i) => b.setAttribute("aria-current", i === S.p ? "true" : "false"));
  }

  const currentPanel = () => S.panels[S.p];
  const currentItem = () => {
    const p = currentPanel();
    return p.items[S.sel[p.id]];
  };

  /* ---------- views ------------------------------------------------------- */

  function pathFor(panelId, item) {
    switch (panelId) {
      case "whoami": return "~/README.md";
      case "experience": return `~/experience/${item.id}.log`;
      case "projects": return `~/projects/${item.id}/README.md`;
      case "skills": return `~/skills/${item.id}.txt`;
      case "contact": return "~/contact.txt";
      default: return "~";
    }
  }

  const tildes = (n = 6) => `<div class="tilde" aria-hidden="true">${"~<br>".repeat(n)}</div>`;

  const BANNER = String.raw`██████╗  █████╗ ██╗     ██████╗ ██╗  ██╗
██╔══██╗██╔══██╗██║     ██╔══██╗██║  ██║
██████╔╝███████║██║     ██████╔╝███████║
██╔══██╗██╔══██║██║     ██╔═══╝ ██╔══██║
██║  ██║██║  ██║███████╗██║     ██║  ██║
╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝`;

  function viewWhoami() {
    const { profile, projects } = S.data;
    const langs = ["dart", "typescript", "go", "python"].map((k) => stackOf(k).label).join(", ");
    const favs = ["flutter", "dart", "nextjs", "typescript", "go", "fastapi", "postgresql", "docker", "githubactions", "claude"];
    const latest = projects.slice(0, 4);
    return `<article class="doc">
      <pre class="banner" aria-label="Ralph">${BANNER}</pre>
      <p class="prompt-line"><span class="ps1">guest@rlphjyson<span class="p">:~$</span></span> neofetch</p>
      <dl class="neofetch">
        <dt>user</dt><dd>${esc(profile.name)} <span class="c-dim">(${esc(profile.handle)})</span></dd>
        <div class="sep" aria-hidden="true">──────────────────────────────</div>
        <dt>role</dt><dd>${esc(profile.role)}</dd>
        <dt>host</dt><dd>${esc(profile.location)}</dd>
        <dt>uptime</dt><dd>${esc(careerUptime())} shipping software</dd>
        <dt>kernel</dt><dd>Flutter / Dart</dd>
        <dt>langs</dt><dd>${esc(langs)}</dd>
        <dt>shell</dt><dd>zsh + vim motions</dd>
        <dt>editor</dt><dd>neovim</dd>
        <dt>edu</dt><dd>${esc(profile.education.degree)}, FAITH <span class="c-dim">(${esc(profile.education.date)})</span></dd>
        <dt>projects</dt><dd>${projects.length} repositories</dd>
        <dt>colors</dt><dd><span class="swatches" aria-hidden="true">${["--red", "--orange", "--yellow", "--green", "--cyan", "--blue", "--magenta", "--fg"]
          .map((v) => `<span style="background:var(${v})"></span>`)
          .join("")}</span></dd>
      </dl>
      <div class="chips">${favs.map((k) => chipHTML(k)).join("")}</div>

      <h2>about</h2>
      ${profile.summary.map((s) => `<p>${colorize(s)}</p>`).join("")}

      <h2>recent work</h2>
      <div class="card-list">${latest
        .map(
          (p) => `<button type="button" class="card" data-go="projects:${esc(p.id)}">
            <div class="t">${esc(p.name)}</div>
            <div class="s">${esc(p.tagline)}</div>
          </button>`,
        )
        .join("")}</div>

      <h2>getting around</h2>
      <div class="hint-grid">
        <div><kbd>h</kbd><kbd>l</kbd><span>switch panel</span></div>
        <div><kbd>j</kbd><kbd>k</kbd><span>move in a list</span></div>
        <div><kbd>/</kbd><span>fuzzy find anything</span></div>
        <div><kbd>:</kbd><span>run a command</span></div>
        <div><kbd>\`</kbd><span>open a real-ish shell</span></div>
        <div><kbd>t</kbd><span>cycle colorscheme</span></div>
        <div><kbd>?</kbd><span>all keybindings</span></div>
        <div><kbd>1</kbd>…<kbd>5</kbd><span>jump to a panel</span></div>
      </div>
      ${tildes()}
    </article>`;
  }

  function viewExperience(item) {
    const e = S.data.experience.find((x) => x.id === item.id);
    const all = S.data.experience;
    const refs = e.current ? `(<span class="head">HEAD -&gt; main</span>, current)` : `(tag: ${esc(shortRange(e.date))})`;
    return `<article class="doc">
      <div class="commit">commit ${hash7(e.id + e.company)} <span class="ref">${refs}</span></div>
      <dl class="kv">
        <dt>Author:</dt><dd>Ralph Burgos &lt;${esc(S.data.profile.email)}&gt;</dd>
        <dt>Company:</dt><dd class="c-orange">${esc(e.company)}</dd>
        <dt>Date:</dt><dd class="c-yellow">${esc(e.date)}</dd>
        <dt>Where:</dt><dd>${esc(e.location)}</dd>
      </dl>
      <h1>${esc(e.role)}</h1>
      ${e.stack?.length ? `<div class="chips">${e.stack.map((k) => chipHTML(k)).join("")}</div>` : ""}
      <ul class="diff">${e.content.map((c) => `<li>${colorize(c)}</li>`).join("")}</ul>

      <h2>git log --graph --oneline</h2>
      <ul class="timeline">${all
        .map(
          (x) => `<li class="${x.id === e.id ? "here" : ""}">
            <span class="node" aria-hidden="true">${x.id === e.id ? "◉" : "○"}</span>
            <button type="button" data-go="experience:${esc(x.id)}"><span class="c-yellow">${hash7(x.id + x.company)}</span> <span class="t-role">${esc(x.role)}</span> <span class="c-dim">@ ${esc(x.company)}</span></button>
            <span class="c-dim">${esc(shortRange(x.date, x.current))}</span>
          </li>`,
        )
        .join("")}</ul>
      ${tildes(4)}
    </article>`;
  }

  function galleryHTML(p) {
    if (!p.images?.length) return "";
    return `<div class="gallery">${p.images
      .map(
        (im, i) => `<button type="button" class="shot${i === 0 ? " hero" : ""}" data-shot="${i}" aria-label="Open screenshot ${i + 1}: ${esc(im.caption)}">
          <img src="${esc(im.src)}" alt="${esc(im.caption)}" loading="lazy" decoding="async" />
          <span class="idx">${i + 1}/${p.images.length}</span>
          <figcaption>${esc(im.caption)}</figcaption>
        </button>`,
      )
      .join("")}</div>`;
  }

  function viewProject(item, { preview = false } = {}) {
    const p = S.data.projects.find((x) => x.id === item.id);
    const idx = S.data.projects.indexOf(p);
    const prev = S.data.projects[idx - 1];
    const next = S.data.projects[idx + 1];
    const actions = [
      p.github && `<a class="btn" href="${esc(p.github)}" target="_blank" rel="noopener"><kbd>o</kbd> source ↗</a>`,
      p.pub && `<a class="btn" href="${esc(p.pub)}" target="_blank" rel="noopener"><kbd>p</kbd> pub.dev ↗</a>`,
      p.demo && `<a class="btn" href="${esc(p.demo)}" target="_blank" rel="noopener"><kbd>O</kbd> live demo ↗</a>`,
      p.images?.length && `<button type="button" class="btn" data-shot="0"><kbd>⏎</kbd> screenshots</button>`,
      p.github && `<button type="button" class="btn" data-yank="${esc(p.github)}"><kbd>y</kbd> yank url</button>`,
    ].filter(Boolean);

    const diagram = p.diagram
      ? `<h2>architecture</h2>
        <figure class="diagram" data-diagram="${esc(p.diagram.file)}" data-type="${esc(p.diagram.type)}">
          <div class="diagram-bar"><span>${esc(p.diagram.title)}</span><span>${p.diagram.type === "mermaid" ? "mermaid" : "ascii"} · from README</span></div>
          <div class="diagram-body"><pre class="c-dim">loading…</pre></div>
        </figure>`
      : "";

    return `<article class="doc">
      <h1>${esc(p.name)}</h1>
      <p class="lead">${esc(p.tagline)}</p>
      <div class="meta-row">
        <span><b>date</b> ${esc(p.date)}</span>
        <span><b>type</b> ${esc(p.category)}</span>
        ${p.pub ? `<span><b>package</b> <a href="${esc(p.pub)}" target="_blank" rel="noopener">pub.dev/packages/${esc(p.pub.split("/").pop())}</a></span>` : ""}
        ${p.images?.length ? `<span><b>shots</b> ${p.images.length}</span>` : ""}
      </div>
      <div class="chips">${p.stack.map((k) => chipHTML(k)).join("")}</div>
      ${preview ? "" : `<div class="actions">${actions.join("")}</div>`}
      ${preview && p.images?.[0] ? `<div class="gallery"><div class="shot hero"><img src="${esc(p.images[0].src)}" alt="" loading="lazy" /></div></div>` : preview ? "" : galleryHTML(p)}
      <h2>readme</h2>
      ${p.content.map((c) => `<p>${colorize(c)}</p>`).join("")}
      ${p.highlights?.length ? `<h2>highlights</h2><ul class="checks">${p.highlights.map((h) => `<li>${colorize(h)}</li>`).join("")}</ul>` : ""}
      ${preview ? "" : diagram}
      ${preview ? "" : `<div class="actions" style="margin-top:2rem">
        ${prev ? `<button type="button" class="btn" data-go="projects:${esc(prev.id)}"><kbd>k</kbd> ${esc(prev.name)}</button>` : ""}
        ${next ? `<button type="button" class="btn" data-go="projects:${esc(next.id)}"><kbd>j</kbd> ${esc(next.name)}</button>` : ""}
      </div>`}
      ${preview ? "" : tildes(3)}
    </article>`;
  }

  function viewSkill(item) {
    const s = S.data.skills.find((x) => x.id === item.id);
    const rows = s.items
      .map((k) => {
        const { projects, jobs } = usedIn(k);
        const refs = [
          ...jobs.map((j) => `<button type="button" class="c-orange" data-go="experience:${esc(j.id)}">${esc(j.company)}</button>`),
          ...projects.map((p) => `<button type="button" class="c-cyan" data-go="projects:${esc(p.id)}">${esc(p.name)}</button>`),
        ];
        return `<dt>${chipHTML(k, { clickable: false })}</dt><dd>${refs.length ? refs.join('<span class="c-dim"> · </span>') : '<span class="c-dim">daily work</span>'}</dd>`;
      })
      .join("");
    return `<article class="doc">
      <h1>${esc(s.name)}</h1>
      ${s.content.map((c) => `<p>${colorize(c)}</p>`).join("")}
      <h2>grep -r --count . <span class="c-dim">(where each one shows up)</span></h2>
      <dl class="kv" style="row-gap:.45rem;align-items:center">${rows}</dl>
      ${tildes(4)}
    </article>`;
  }

  function viewContact() {
    const p = currentPanel().id === "contact" ? S.sel.contact : -1;
    const items = S.panels[4].items;
    return `<article class="doc">
      <p class="prompt-line"><span class="ps1">guest@rlphjyson<span class="p">:~$</span></span> cat contact.txt</p>
      <h1>Let's build something</h1>
      <p>I'm open to senior mobile / frontend and AI-tooling roles, remote or hybrid from the Philippines. The fastest way to reach me is email.</p>
      <dl class="kv" style="row-gap:.4rem">
        ${items
          .map(
            (it, i) => `<dt class="${i === p ? "c-green b" : ""}">${i === p ? "▸ " : "  "}${esc(it.label)}</dt>
              <dd><a href="${esc(it.url)}" ${it.id === "email" ? "" : 'target="_blank" rel="noopener"'}>${esc(it.value)}</a></dd>`,
          )
          .join("")}
      </dl>
      <div class="actions">
        <a class="btn" href="mailto:${esc(S.data.profile.email)}?subject=${encodeURIComponent("Hello from your portfolio")}"><kbd>⏎</kbd> send email</a>
        <button type="button" class="btn" data-yank="${esc(S.data.profile.email)}"><kbd>y</kbd> yank email</button>
      </div>
      <p class="c-dim">Shortcuts: <kbd>:mail</kbd> <kbd>:gh</kbd> <kbd>:linkedin</kbd>, or <kbd>\`</kbd> then <span class="c-green">mail</span>.</p>
      ${tildes(5)}
    </article>`;
  }

  function viewFor(panelId, item, opts) {
    switch (panelId) {
      case "whoami": return viewWhoami();
      case "experience": return viewExperience(item);
      case "projects": return viewProject(item, opts);
      case "skills": return viewSkill(item);
      case "contact": return viewContact();
      default: return "";
    }
  }

  function renderMain() {
    const panel = currentPanel();
    const item = currentItem();
    const viewer = $("#viewer");
    viewer.innerHTML = viewFor(panel.id, item);
    viewer.scrollTop = 0;
    const path = pathFor(panel.id, item);
    $("#main-title").textContent = path;
    $("#st-file").textContent = path;
    hydrateDiagrams(viewer);
    if (S.hl) applyHighlight(S.hl);
    updateScrollPct();
  }

  /* ---------- architecture diagrams --------------------------------------- */

  async function hydrateDiagrams(root) {
    for (const fig of $$("[data-diagram]", root)) {
      const body = $(".diagram-body", fig);
      const src = await loadDiagram(fig.dataset.diagram);
      if (!fig.isConnected) return;
      if (src == null) {
        body.innerHTML = `<pre class="c-red">E484: Can't open file ${esc(fig.dataset.diagram)}</pre>`;
        continue;
      }
      if (fig.dataset.type === "mermaid") {
        renderMermaid(body, src);
      } else {
        body.innerHTML = `<pre>${esc(src.replace(/\s+$/, ""))}</pre>`;
      }
    }
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  async function getMermaid() {
    if (!S.mermaid) {
      S.mermaid = import("https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs").then((m) => m.default);
    }
    const mermaid = await S.mermaid;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: "Fira Mono, ui-monospace, monospace",
      flowchart: { curve: "basis", padding: 12 },
      themeVariables: {
        darkMode: S.theme !== "paper",
        background: cssVar("--bg-alt"),
        fontFamily: "Fira Mono, ui-monospace, monospace",
        fontSize: "13px",
        primaryColor: cssVar("--bg-hl-dim"),
        primaryTextColor: cssVar("--fg"),
        primaryBorderColor: cssVar("--border-active"),
        secondaryColor: cssVar("--bg-hl"),
        tertiaryColor: cssVar("--bg"),
        lineColor: cssVar("--fg-dim"),
        textColor: cssVar("--fg"),
        clusterBkg: cssVar("--bg"),
        clusterBorder: cssVar("--border"),
        edgeLabelBackground: cssVar("--bg-alt"),
        nodeTextColor: cssVar("--fg"),
        titleColor: cssVar("--cyan"),
      },
    });
    return mermaid;
  }

  let mermaidSeq = 0;
  async function renderMermaid(body, src) {
    body.dataset.src = src;
    body.innerHTML = `<div class="mermaid"><span class="c-dim">rendering diagram…</span></div>`;
    try {
      const mermaid = await getMermaid();
      // GitHub accepts "\n" inside labels; mermaid wants <br/>.
      const code = src.replaceAll("\\n", "<br/>");
      const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, code);
      if (body.isConnected) $(".mermaid", body).innerHTML = svg;
    } catch (e) {
      // offline or CDN blocked: show the source, which is still readable
      body.innerHTML = `<pre>${esc(src.replace(/\s+$/, ""))}</pre>`;
    }
  }

  function rerenderMermaid() {
    $$(".diagram-body[data-src]").forEach((b) => renderMermaid(b, b.dataset.src));
  }

  /* ---------- navigation -------------------------------------------------- */

  function go(p, i, { fromHash = false } = {}) {
    p = clamp(p, 0, S.panels.length - 1);
    const panel = S.panels[p];
    if (i == null) i = S.sel[panel.id];
    i = panel.items.length ? clamp(i, 0, panel.items.length - 1) : 0;
    const changed = p !== S.p || i !== S.sel[panel.id] || !S.rendered;
    const prevPanel = currentPanel()?.id;
    S.p = p;
    S.sel[panel.id] = i;
    S.rendered = true;
    updateSidebar();
    if (changed || (panel.id === "contact" && prevPanel === "contact")) renderMain();
    if (!fromHash) {
      const it = currentItem();
      const h = `#/${panel.id}${it ? "/" + it.id : ""}`;
      if (location.hash !== h) history.replaceState(null, "", h);
    }
    updateStatus();
    if (isMobile()) closeDrawer();
  }

  function goTo(panelId, itemId) {
    const p = S.panels.findIndex((x) => x.id === panelId);
    if (p < 0) return false;
    const i = itemId ? S.panels[p].items.findIndex((x) => x.id === itemId) : null;
    go(p, i != null && i < 0 ? 0 : i);
    return true;
  }

  function fromHash() {
    const m = location.hash.match(/^#\/([\w-]+)(?:\/([\w-]+))?/);
    if (!m) return false;
    const p = S.panels.findIndex((x) => x.id === m[1]);
    if (p < 0) return false;
    const i = m[2] ? S.panels[p].items.findIndex((x) => x.id === m[2]) : 0;
    go(p, Math.max(0, i), { fromHash: true });
    return true;
  }

  const moveItem = (d) => {
    const panel = currentPanel();
    if (!panel.items.length) return scrollMain(d * 60);
    go(S.p, S.sel[panel.id] + d);
  };

  const movePanel = (d) => go((S.p + d + S.panels.length) % S.panels.length);

  function scrollMain(px) {
    $("#viewer").scrollBy({ top: px, behavior: reducedMotion() ? "auto" : "smooth" });
  }

  function updateScrollPct() {
    const v = $("#viewer");
    const max = v.scrollHeight - v.clientHeight;
    let txt = "All";
    if (max > 4) {
      const pct = Math.round((v.scrollTop / max) * 100);
      txt = pct <= 1 ? "Top" : pct >= 99 ? "Bot" : `${pct}%`;
    }
    $("#st-pct").textContent = txt;
  }

  function updateStatus() {
    const panel = currentPanel();
    $("#st-pos").textContent = panel.items.length ? `${S.sel[panel.id] + 1}/${panel.items.length}` : "1/1";
    $("#st-theme").textContent = S.theme;
    const ls = S.lastSearch;
    $("#st-search").textContent = S.hl && ls.results.length ? `/${S.hl} [${ls.idx + 1}/${ls.results.length}]` : "";
  }

  function setMode(m) {
    S.mode = m;
    const el = $("#mode");
    el.textContent = m;
    el.dataset.mode = m;
  }

  /* ---------- messages (vim's bottom line) -------------------------------- */

  let msgTimer = 0;
  function msg(html, kind = "info", sticky = false) {
    const el = $("#cmd-msg");
    el.className = kind;
    el.innerHTML = html;
    el.hidden = false;
    clearTimeout(msgTimer);
    if (!sticky) msgTimer = setTimeout(() => { el.innerHTML = ""; }, 4500);
  }

  /* ---------- theme -------------------------------------------------------- */

  function setTheme(name, announce = true) {
    if (!THEMES.includes(name)) {
      msg(`E185: Cannot find color scheme '${esc(name)}'`, "error");
      return;
    }
    S.theme = name;
    document.documentElement.setAttribute("data-theme", name);
    store.set("theme", name);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", cssVar("--bg"));
    updateStatus();
    rerenderMermaid();
    if (announce) msg(`colorscheme <span class="c-cyan">${esc(name)}</span>`, "info");
  }

  const cycleTheme = () => setTheme(THEMES[(THEMES.indexOf(S.theme) + 1) % THEMES.length]);

  /* ---------- search ------------------------------------------------------- */

  function buildIndex() {
    const { projects, experience, skills, stack } = S.data;
    const idx = [];
    projects.forEach((p) =>
      idx.push({
        kind: "proj",
        title: p.name,
        sub: p.category,
        text: [p.tagline, ...p.content, ...(p.highlights || []), ...p.stack.map((k) => stackOf(k).label)].map(plain).join(" "),
        target: ["projects", p.id],
      }),
    );
    experience.forEach((e) =>
      idx.push({
        kind: "job",
        title: `${e.role} @ ${e.company}`,
        sub: shortRange(e.date, e.current),
        text: [...e.content, ...(e.stack || []).map((k) => stackOf(k).label), e.location].map(plain).join(" "),
        target: ["experience", e.id],
      }),
    );
    skills.forEach((s) =>
      idx.push({
        kind: "skill",
        title: s.name,
        sub: `${s.items.length} tools`,
        text: [...s.content, ...s.items.map((k) => stackOf(k).label)].map(plain).join(" "),
        target: ["skills", s.id],
      }),
    );
    Object.keys(stack).forEach((k) => {
      const si = skillIndexFor(k);
      if (si < 0) return;
      const n = usedIn(k);
      idx.push({
        kind: "tech",
        title: stack[k].label,
        sub: `${n.projects.length + n.jobs.length} uses`,
        text: skills[si].name,
        target: ["skills", skills[si].id],
        tech: k,
      });
    });
    idx.push({ kind: "page", title: "whoami / about", sub: "neofetch", text: plain(S.data.profile.summary.join(" ")), target: ["whoami"] });
    idx.push({ kind: "page", title: "contact", sub: S.data.profile.email, text: "email github linkedin hire mail", target: ["contact"] });
    THEMES.forEach((t) => idx.push({ kind: "cmd", title: `:colorscheme ${t}`, sub: "theme", text: "theme color", run: () => setTheme(t) }));
    S.index = idx;
  }

  function fuzzy(q, s) {
    const t = s.toLowerCase();
    const sub = t.indexOf(q);
    if (sub >= 0) {
      const idx = [];
      for (let i = sub; i < sub + q.length; i++) idx.push(i);
      return { score: 120 - sub + (sub === 0 ? 30 : 0) - t.length * 0.1, idx };
    }
    let qi = 0;
    let last = -1;
    let gaps = 0;
    const idx = [];
    for (let i = 0; i < t.length && qi < q.length; i++) {
      if (t[i] === q[qi]) {
        if (last >= 0) gaps += i - last - 1;
        idx.push(i);
        last = i;
        qi++;
      }
    }
    if (qi < q.length) return null;
    const score = 60 - gaps * 2 - idx[0];
    return score > 0 ? { score, idx } : null;
  }

  function search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return S.index.filter((e) => e.kind !== "cmd" && e.kind !== "tech").map((e) => ({ e, score: 0, idx: [] }));
    const words = q.split(/\s+/);
    const out = [];
    for (const e of S.index) {
      const f = fuzzy(q, e.title);
      const text = (e.text + " " + e.sub).toLowerCase();
      const textHit = words.every((w) => text.includes(w) || e.title.toLowerCase().includes(w));
      if (!f && !textHit) continue;
      let score = f ? f.score : 0;
      if (textHit) score += 20 + words.length;
      if (e.kind === "cmd") score -= 15;
      out.push({ e, score, idx: f ? f.idx : [] });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 60);
  }

  function markTitle(title, idx) {
    if (!idx.length) return esc(title);
    const set = new Set(idx);
    return [...title].map((ch, i) => (set.has(i) ? `<b>${esc(ch)}</b>` : esc(ch))).join("");
  }

  const tele = { results: [], i: 0 };

  function openSearch(initial = "") {
    closeOverlays();
    setMode("SEARCH");
    const ov = $("#telescope");
    ov.hidden = false;
    const input = $("#tele-input");
    input.value = initial;
    updateTele();
    input.focus();
    input.select();
  }

  function updateTele() {
    const q = $("#tele-input").value;
    tele.results = search(q);
    tele.i = 0;
    $("#tele-count").textContent = `${tele.results.length}/${S.index.length}`;
    renderTeleList();
  }

  function renderTeleList() {
    const ul = $("#tele-results");
    if (!tele.results.length) {
      ul.innerHTML = `<li class="empty">no matches. try "flutter", "go", "rag"…</li>`;
      $("#tele-preview").innerHTML = "";
      return;
    }
    ul.innerHTML = tele.results
      .map(
        (r, i) => `<li role="option" data-i="${i}" class="${i === tele.i ? "sel" : ""}" aria-selected="${i === tele.i}">
          <span class="kind">${r.e.kind}</span>
          <span class="ttl">${markTitle(r.e.title, r.idx)}</span>
          <span class="sub">${esc(r.e.sub || "")}</span>
        </li>`,
      )
      .join("");
    const sel = $("li.sel", ul);
    sel?.scrollIntoView({ block: "nearest" });
    renderTelePreview();
  }

  function renderTelePreview() {
    const r = tele.results[tele.i];
    const pv = $("#tele-preview");
    if (!r) return (pv.innerHTML = "");
    if (r.e.run) {
      pv.innerHTML = `<div class="doc"><p class="c-dim">Runs <span class="c-yellow">${esc(r.e.title)}</span></p></div>`;
      return;
    }
    const [panelId, itemId] = r.e.target;
    const panel = S.panels.find((p) => p.id === panelId);
    const item = itemId ? panel.items.find((x) => x.id === itemId) : null;
    pv.innerHTML = panelId === "contact" ? viewContact() : viewFor(panelId, item, { preview: true });
    const q = $("#tele-input").value.trim();
    if (q) highlightIn(pv, q);
  }

  function chooseTele(i = tele.i) {
    const r = tele.results[i];
    const q = $("#tele-input").value.trim();
    closeOverlays();
    if (!r) return;
    if (r.e.run) return r.e.run();
    S.lastSearch = { query: q, results: tele.results.filter((x) => !x.e.run), idx: 0 };
    S.lastSearch.idx = Math.max(0, S.lastSearch.results.indexOf(r));
    S.hl = q;
    goTo(...r.e.target);
    if (q) applyHighlight(q);
    updateStatus();
  }

  function nextResult(d) {
    const ls = S.lastSearch;
    if (!ls.results.length) {
      msg("E35: No previous regular expression", "error");
      return;
    }
    ls.idx = (ls.idx + d + ls.results.length) % ls.results.length;
    S.hl = ls.query;
    const r = ls.results[ls.idx];
    goTo(...r.e.target);
    applyHighlight(ls.query);
    updateStatus();
    msg(`/${esc(ls.query)} <span class="c-dim">[${ls.idx + 1}/${ls.results.length}] ${esc(r.e.title)}</span>`);
  }

  function highlightIn(root, q) {
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) return [];
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement.closest("pre, mark, .banner, svg, script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const marks = [];
    for (const n of nodes) {
      if (!re.test(n.nodeValue)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      n.nodeValue.replace(re, (m, _g, off) => {
        frag.append(n.nodeValue.slice(last, off));
        const mk = document.createElement("mark");
        mk.textContent = m;
        frag.append(mk);
        marks.push(mk);
        last = off + m.length;
      });
      frag.append(n.nodeValue.slice(last));
      n.replaceWith(frag);
    }
    return marks;
  }

  function applyHighlight(q) {
    const marks = highlightIn($("#viewer"), q);
    if (marks[0]) {
      marks[0].classList.add("current");
      marks[0].scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }

  function clearHighlight() {
    S.hl = "";
    renderMain();
    updateStatus();
  }

  /* ---------- command line ------------------------------------------------- */

  const projectIds = () => S.data.projects.map((p) => p.id);
  const anyIds = () => [...projectIds(), ...S.data.experience.map((e) => e.id), ...S.data.skills.map((s) => s.id), "whoami", "contact"];

  const COMMANDS = [
    { name: "help", alias: ["h"], desc: "show keybindings and commands", run: () => openHelp() },
    { name: "edit", alias: ["e", "open", "o"], args: anyIds, desc: "open a project, job or skill", run: (a) => openTarget(a) },
    { name: "whoami", alias: ["neofetch", "about"], desc: "who is this guy", run: () => goTo("whoami") },
    { name: "experience", alias: ["exp", "log"], desc: "work history", run: () => goTo("experience") },
    { name: "projects", alias: ["ls", "repos"], desc: "the projects list", run: () => goTo("projects") },
    { name: "skills", alias: ["stack"], desc: "skills and tools", run: () => goTo("skills") },
    { name: "contact", alias: ["hire"], desc: "how to reach me", run: () => goTo("contact") },
    { name: "buffer", alias: ["b"], args: () => ["1", "2", "3", "4", "5"], desc: "jump to panel N", run: (a) => go(parseInt(a, 10) - 1 || 0) },
    { name: "bnext", alias: ["bn"], desc: "next item", run: () => moveItem(1) },
    { name: "bprevious", alias: ["bp", "bprev"], desc: "previous item", run: () => moveItem(-1) },
    { name: "colorscheme", alias: ["colo", "theme"], args: () => THEMES, desc: "switch theme", run: (a) => (a ? setTheme(a) : msg(`${S.theme} <span class="c-dim">(${THEMES.join(" ")})</span>`)) },
    { name: "search", alias: ["find", "grep", "telescope"], desc: "fuzzy finder", run: (a) => openSearch(a) },
    { name: "nohlsearch", alias: ["noh"], desc: "clear search highlight", run: () => clearHighlight() },
    { name: "terminal", alias: ["term", "sh", "shell", "zsh", "bash"], desc: "open the shell", run: () => openTerminal() },
    { name: "github", alias: ["gh", "source"], args: projectIds, desc: "open GitHub (or a project's repo)", run: (a) => openGithub(a) },
    { name: "pub", alias: ["pubdev"], desc: "open Cairn UI on pub.dev", run: () => openPub(true) },
    { name: "linkedin", alias: ["li"], desc: "open LinkedIn", run: () => openUrl(S.data.profile.linkedin) },
    { name: "mail", alias: ["email"], desc: "write me an email", run: () => (location.href = `mailto:${S.data.profile.email}`) },
    { name: "yank", alias: ["y"], desc: "copy a link to this page", run: () => yank(location.href) },
    { name: "reboot", alias: [], desc: "replay the login", run: () => boot({ force: true }) },
    { name: "quit", alias: ["q", "q!", "wq", "x", "qa", "qa!", "exit", "logout"], desc: "log out", run: () => logout() },
    { name: "write", alias: ["w", "w!"], desc: "", hidden: true, run: () => msg("E45: 'readonly' option is set. This portfolio is read-only, but my inbox isn't: :mail", "error") },
    { name: "sudo", alias: [], desc: "", hidden: true, run: () => msg("guest is not in the sudoers file. This incident will be reported.", "error") },
  ];

  function findCommand(name) {
    return COMMANDS.find((c) => c.name === name || c.alias.includes(name));
  }

  function execCommand(line) {
    const raw = line.trim();
    if (!raw) return;
    S.cmdHistory = [raw, ...S.cmdHistory.filter((h) => h !== raw)].slice(0, 50);
    if (/^\d+$/.test(raw)) {
      const panel = currentPanel();
      if (panel.items.length) go(S.p, parseInt(raw, 10) - 1);
      return;
    }
    if (raw.startsWith("!")) return openTerminal(raw.slice(1).trim());
    const [name, ...rest] = raw.split(/\s+/);
    const cmd = findCommand(name) || (name.length >= 3 && COMMANDS.find((c) => !c.hidden && c.name.startsWith(name)));
    if (!cmd) {
      msg(`E492: Not an editor command: ${esc(raw)}`, "error");
      return;
    }
    cmd.run(rest.join(" "));
  }

  function openTarget(a) {
    if (!a) return msg("E32: No file name. Try <span class='c-yellow'>:e roam</span> (Tab completes)", "error");
    const q = a.toLowerCase();
    for (const panel of S.panels) {
      if (panel.id === q) return goTo(panel.id);
      const it = panel.items.find((x) => x.id === q) || panel.items.find((x) => x.id.startsWith(q) || x.label.toLowerCase().startsWith(q));
      if (it) return goTo(panel.id, it.id);
    }
    openSearch(a);
  }

  function openGithub(a) {
    if (a) {
      const p = S.data.projects.find((x) => x.id === a || x.id.startsWith(a));
      if (p) return openUrl(p.github);
      return msg(`E94: No matching repo for ${esc(a)}`, "error");
    }
    if (currentPanel().id === "projects") return openUrl(S.data.projects[S.sel.projects].github);
    openUrl(S.data.profile.github);
  }

  async function yank(text) {
    const ok = await copyText(text);
    msg(ok ? `yanked <span class="c-cyan">${esc(text)}</span>` : "E353: Nothing in register (clipboard blocked)", ok ? "ok" : "error");
  }

  function enterCommand(prefill = "") {
    setMode("COMMAND");
    const input = $("#cmd-input");
    $("#cmd-prefix").textContent = ":";
    $("#cmd-msg").hidden = true;
    input.hidden = false;
    input.value = prefill;
    S.cmdHistIdx = -1;
    resetWild();
    input.focus();
  }

  function leaveCommand() {
    const input = $("#cmd-input");
    input.hidden = true;
    input.blur();
    $("#cmd-prefix").textContent = "";
    $("#cmd-msg").hidden = false;
    hideWild();
    setMode("NORMAL");
  }

  function completions(value) {
    const parts = value.split(/\s+/);
    if (parts.length <= 1) {
      const q = parts[0] || "";
      const names = COMMANDS.filter((c) => !c.hidden).flatMap((c) => [c.name, ...c.alias.filter((x) => x.length > 2)]);
      return { base: "", items: [...new Set(names)].filter((n) => n.startsWith(q)).sort() };
    }
    const cmd = findCommand(parts[0]);
    if (!cmd?.args) return { base: "", items: [] };
    const q = parts.slice(1).join(" ");
    return { base: parts[0] + " ", items: cmd.args().filter((x) => x.startsWith(q)) };
  }

  function resetWild() {
    S.wild = { items: [], idx: -1, base: "" };
  }

  function hideWild() {
    $("#wildmenu").hidden = true;
    resetWild();
  }

  function tabComplete(dir = 1) {
    const input = $("#cmd-input");
    if (S.wild.idx === -1) {
      const c = completions(input.value);
      if (!c.items.length) return;
      S.wild = { items: c.items, idx: -1, base: c.base };
    }
    const w = S.wild;
    w.idx = (w.idx + dir + w.items.length) % w.items.length;
    input.value = w.base + w.items[w.idx];
    const menu = $("#wildmenu");
    menu.innerHTML = w.items
      .slice(0, 40)
      .map((x, i) => `<span class="${i === w.idx ? "sel" : ""}">${esc(x)}</span>`)
      .join("");
    menu.hidden = w.items.length < 2;
  }

  function onCmdKey(e) {
    const input = e.target;
    if (e.key === "Escape" || (e.key === "c" && e.ctrlKey) || (e.key === "[" && e.ctrlKey)) {
      e.preventDefault();
      leaveCommand();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const v = input.value;
      leaveCommand();
      execCommand(v);
    } else if (e.key === "Tab") {
      e.preventDefault();
      tabComplete(e.shiftKey ? -1 : 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const h = S.cmdHistory;
      if (!h.length) return;
      S.cmdHistIdx = clamp(S.cmdHistIdx + (e.key === "ArrowUp" ? 1 : -1), -1, h.length - 1);
      input.value = S.cmdHistIdx === -1 ? "" : h[S.cmdHistIdx];
    } else if (e.key === "Backspace" && input.value === "") {
      e.preventDefault();
      leaveCommand();
    } else if (e.key.length === 1 || e.key === "Backspace") {
      hideWild();
    }
  }

  /* ---------- help --------------------------------------------------------- */

  function openHelp() {
    closeOverlays();
    setMode("HELP");
    const keys = [
      ["Navigation", [
        ["h l  ← →  Tab", "previous / next panel"],
        ["j k  ↓ ↑", "next / previous item"],
        ["1 … 5", "jump to panel"],
        ["gg  G", "first / last item"],
        ["Ctrl-d  Ctrl-u", "scroll content half a page"],
        ["J K  Ctrl-e Ctrl-y", "scroll content a few lines"],
        ["PgDn PgUp  Space", "scroll content"],
      ]],
      ["Actions", [
        ["Enter", "open screenshots / link"],
        ["o  O  p", "open source / live demo / pub.dev"],
        ["y  Y", "yank url / link to this page"],
        ["t", "cycle colorscheme"],
        ["`  :term", "open the shell"],
        ["ZZ  :q", "log out"],
      ]],
      ["Search", [
        ["/", "fuzzy find (telescope)"],
        ["n  N", "next / previous result"],
        [":noh  Esc", "clear highlight"],
        ["Ctrl-n Ctrl-p", "move in results"],
      ]],
      ["Screenshot viewer", [
        ["h l  ← →", "previous / next"],
        ["Esc  q", "close"],
      ]],
    ];
    const cmds = COMMANDS.filter((c) => !c.hidden)
      .map((c) => `<div><code>:${esc(c.name)}${c.alias.length ? `<span class="c-dim"> ${esc(c.alias.slice(0, 2).join(" "))}</span>` : ""}</code><span>${esc(c.desc)}</span></div>`)
      .join("");
    $("#help-body").innerHTML =
      keys
        .map(
          ([title, rows]) => `<h3>${esc(title)}</h3><div class="keymap">${rows
            .map(([k, d]) => `<div><code>${esc(k)}</code><span>${esc(d)}</span></div>`)
            .join("")}</div>`,
        )
        .join("") +
      `<h3>Commands <span class="c-dim">(Tab completes, ↑↓ history)</span></h3><div class="keymap">${cmds}</div>
       <h3>Shell</h3><p>Inside <kbd>\`</kbd> try <span class="c-green">ls</span>, <span class="c-green">cd projects</span>, <span class="c-green">cat roam/README.md</span>, <span class="c-green">tree</span>, <span class="c-green">grep flutter</span>, <span class="c-green">open docuchat-ai</span>, <span class="c-green">git log</span>, <span class="c-green">neofetch</span>.</p>
       <p class="c-dim" style="margin-top:.75rem">No mouse required, but everything is clickable too.</p>`;
    $("#help").hidden = false;
    $("#help .help-body").focus?.();
  }

  /* ---------- screenshot viewer ------------------------------------------- */

  function openLightbox(images, i, title) {
    if (!images?.length) return msg("no screenshots for this one, but there is an architecture diagram below", "info");
    closeOverlays();
    setMode("VIEW");
    S.lb = { images, i, title };
    $("#lightbox").hidden = false;
    showLb();
  }

  function showLb() {
    const { images, i, title } = S.lb;
    const im = images[i];
    const img = $("#lb-img");
    img.src = im.src;
    img.alt = im.caption;
    $("#lb-caption").textContent = im.caption;
    $("#lb-count").textContent = `${i + 1}/${images.length}`;
    $("#lb-title").textContent = `feh — ${title} — ${im.src.split("/").pop()}`;
    const many = images.length > 1;
    $(".lb-prev").hidden = !many;
    $(".lb-next").hidden = !many;
    // preload neighbour
    if (many) new Image().src = images[(i + 1) % images.length].src;
  }

  function lbStep(d) {
    const n = S.lb.images.length;
    S.lb.i = (S.lb.i + d + n) % n;
    showLb();
  }

  function openProjectShots(index = 0) {
    if (currentPanel().id !== "projects") return;
    const p = S.data.projects[S.sel.projects];
    openLightbox(p.images, index, p.name);
  }

  /* ---------- overlays ----------------------------------------------------- */

  function closeOverlays() {
    $$(".overlay").forEach((o) => (o.hidden = true));
    if (S.mode !== "COMMAND") setMode("NORMAL");
    $("#viewer").focus({ preventScroll: true });
  }

  const overlayOpen = () => $$(".overlay").find((o) => !o.hidden);

  /* ---------- drawer (mobile) ---------------------------------------------- */

  function toggleDrawer(force) {
    const side = $("#sidebar");
    side.classList.toggle("open", force ?? !side.classList.contains("open"));
  }
  const closeDrawer = () => toggleDrawer(false);

  /* ---------- shell -------------------------------------------------------- */

  function buildFS() {
    const { profile, experience, projects, skills } = S.data;
    const file = (content, extra = {}) => ({ type: "file", content, ...extra });
    const dir = (children, extra = {}) => ({ type: "dir", children, ...extra });

    const projDirs = {};
    projects.forEach((p) => {
      const children = {
        "README.md": file(
          () =>
            [
              `# ${p.name}`,
              p.tagline,
              "",
              `date:  ${p.date}`,
              `type:  ${p.category}`,
              `stack: ${p.stack.map((k) => stackOf(k).label).join(", ")}`,
              `repo:  ${p.github}`,
              p.pub ? `pub:   ${p.pub}` : null,
              p.demo ? `demo:  ${p.demo}` : null,
              "",
              ...p.content.map(plain),
              "",
              ...(p.highlights || []).map((h) => `  [x] ${plain(h)}`),
            ]
              .filter((x) => x !== null)
              .join("\n"),
          { open: ["projects", p.id] },
        ),
      };
      if (p.diagram) children["ARCHITECTURE.txt"] = file(() => loadDiagram(p.diagram.file).then((s) => s ?? "cat: read error"), { open: ["projects", p.id] });
      if (p.images?.length) {
        const shots = {};
        p.images.forEach((im, i) => (shots[im.src.split("/").pop()] = file(null, { binary: true, image: [p, i] })));
        children["screenshots"] = dir(shots);
      }
      projDirs[p.id] = dir(children, { open: ["projects", p.id] });
    });

    const expFiles = {};
    experience.forEach((e) => {
      expFiles[`${e.id}.log`] = file(
        () => [`${e.role} @ ${e.company}`, `${e.date} · ${e.location}`, "", ...e.content.map((c) => `+ ${plain(c)}`)].join("\n"),
        { open: ["experience", e.id] },
      );
    });

    const skillFiles = {};
    skills.forEach((s) => {
      skillFiles[`${s.id}.txt`] = file(
        () => [s.name, "", ...s.content.map(plain), "", "tools: " + s.items.map((k) => stackOf(k).label).join(", ")].join("\n"),
        { open: ["skills", s.id] },
      );
    });

    const home = dir({
      "README.md": file(
        () =>
          [
            `${profile.name} — ${profile.role}`,
            profile.location,
            "",
            ...profile.summary.map(plain),
            "",
            "try: ls, cd projects, cat roam/README.md, tree, grep flutter, open cairn-ui",
          ].join("\n"),
        { open: ["whoami"] },
      ),
      "contact.txt": file(() => [`email     ${profile.email}`, `github    ${profile.github}`, `linkedin  ${profile.linkedin}`].join("\n"), { open: ["contact"] }),
      "education.txt": file(() => [profile.education.degree, profile.education.school, profile.education.date].join("\n")),
      experience: dir(expFiles, { open: ["experience"] }),
      projects: dir(projDirs, { open: ["projects"] }),
      skills: dir(skillFiles, { open: ["skills"] }),
      ".vimrc": file(() => '" yes, the whole site runs on vim motions\nset number relativenumber\nnnoremap ; :\ncolorscheme ' + S.theme),
    });
    S.fs = dir({ home: dir({ guest: home }) });
  }

  function resolve(path) {
    const t = S.term;
    let parts;
    if (!path || path === "~") parts = ["home", "guest"];
    else if (path.startsWith("~/")) parts = ["home", "guest", ...path.slice(2).split("/")];
    else if (path.startsWith("/")) parts = path.slice(1).split("/");
    else parts = [...t.cwd, ...path.split("/")];
    const out = [];
    for (const p of parts) {
      if (!p || p === ".") continue;
      if (p === "..") out.pop();
      else out.push(p);
    }
    let node = S.fs;
    for (const p of out) {
      if (node?.type !== "dir") return { node: null, parts: out };
      node = node.children[p];
    }
    return { node: node || null, parts: out };
  }

  const prettyPath = (parts) => {
    const s = "/" + parts.join("/");
    return s === "/home/guest" ? "~" : s.startsWith("/home/guest/") ? "~/" + s.slice(12) : s;
  };

  function termPrint(html, cls = "") {
    const out = $("#term-out");
    const div = document.createElement("div");
    div.className = "line " + cls;
    div.innerHTML = html;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
  }

  const ps1 = () => `<span class="ps1">guest@rlphjyson<span class="p">:${esc(prettyPath(S.term.cwd))}$</span></span>`;

  function openTerminal(run) {
    closeOverlays();
    setMode("TERMINAL");
    $("#terminal").hidden = false;
    if (!S.termStarted) {
      S.termStarted = true;
      termPrint(`<span class="c-dim">zsh 5.9 · type</span> <span class="c-green">help</span> <span class="c-dim">to see what this shell can do,</span> <span class="c-green">exit</span> <span class="c-dim">or Esc to close.</span>`);
    }
    $("#term-ps1").innerHTML = ps1();
    const input = $("#term-input");
    input.value = "";
    input.focus();
    if (run) runShell(run);
  }

  function lsHTML(node, long) {
    const names = Object.keys(node.children).filter((n) => long || !n.startsWith(".")).sort();
    if (long) {
      return names
        .map((n) => {
          const c = node.children[n];
          const d = c.type === "dir";
          return `${d ? "dr-xr-xr-x" : "-r--r--r--"}  ralph  ${d ? '<span class="ls-dir">' + esc(n) + "/</span>" : esc(n)}`;
        })
        .join("\n");
    }
    return names.map((n) => (node.children[n].type === "dir" ? `<span class="ls-dir">${esc(n)}/</span>` : `<span class="ls-file">${esc(n)}</span>`)).join("   ");
  }

  function treeHTML(node, prefix = "", depth = 0) {
    if (depth > 3) return "";
    const names = Object.keys(node.children).filter((n) => !n.startsWith(".")).sort();
    return names
      .map((n, i) => {
        const last = i === names.length - 1;
        const c = node.children[n];
        const line = `${prefix}${last ? "└── " : "├── "}${c.type === "dir" ? `<span class="ls-dir">${esc(n)}</span>` : esc(n)}`;
        const sub = c.type === "dir" ? treeHTML(c, prefix + (last ? "    " : "│   "), depth + 1) : "";
        return sub ? line + "\n" + sub : line;
      })
      .join("\n");
  }

  function walkFiles(node, parts, out) {
    for (const [n, c] of Object.entries(node.children)) {
      if (c.type === "dir") walkFiles(c, [...parts, n], out);
      else if (typeof c.content === "function" && !n.endsWith("ARCHITECTURE.txt")) out.push({ path: prettyPath([...parts, n]), c });
    }
    return out;
  }

  function neofetchText() {
    const p = S.data.profile;
    return `<span class="c-cyan">${esc(BANNER)}</span>

<span class="c-cyan b">user</span>     ${esc(p.name)}
<span class="c-cyan b">role</span>     ${esc(p.role)}
<span class="c-cyan b">host</span>     ${esc(p.location)}
<span class="c-cyan b">uptime</span>   ${esc(careerUptime())}
<span class="c-cyan b">kernel</span>   Flutter / Dart
<span class="c-cyan b">langs</span>    Dart, TypeScript, Go, Python
<span class="c-cyan b">repos</span>    ${S.data.projects.length}`;
  }

  const SHELL_HELP = [
    ["ls [-la] [dir]", "list files"],
    ["cd <dir>", "change directory"],
    ["cat <file>", "print a file"],
    ["open <file|name>", "open it in the main pane (also: vim, less)"],
    ["tree", "show the filesystem"],
    ["grep <text>", "search every file"],
    ["git log", "work history, one line each"],
    ["neofetch", "system info"],
    ["whoami / pwd / date / echo", "the classics"],
    ["theme <name>", "switch colorscheme"],
    ["mail / gh / linkedin", "get in touch"],
    ["history / clear / exit", "housekeeping"],
  ];

  const SHELL_CMDS = ["help", "ls", "cd", "cat", "open", "vim", "nvim", "less", "tree", "grep", "git", "neofetch", "whoami", "pwd", "date", "echo", "theme", "mail", "gh", "linkedin", "history", "clear", "exit", "uname", "man", "sudo", "rm", "ssh", "hire"];

  async function runShell(line) {
    const t = S.term;
    termPrint(`${ps1()} ${esc(line)}`);
    if (!line.trim()) return;
    t.history.push(line);
    t.hIdx = -1;
    const [cmd, ...args] = line.trim().split(/\s+/);
    const flags = args.filter((a) => a.startsWith("-")).join("");
    const target = args.find((a) => !a.startsWith("-"));

    const openNode = (node, path) => {
      if (node?.image) {
        const [p, i] = node.image;
        return openLightbox(p.images, i, p.name);
      }
      if (node?.open) {
        closeOverlays();
        goTo(...node.open);
        return;
      }
      termPrint(`${esc(cmd)}: ${esc(path)}: nothing to open`, "c-red");
    };

    switch (cmd) {
      case "help":
        termPrint(SHELL_HELP.map(([a, b]) => `  <span class="c-green">${esc(a.padEnd(28))}</span>${esc(b)}`).join("\n"));
        break;
      case "ls":
      case "ll":
      case "la": {
        const { node, parts } = resolve(target || ".");
        if (!node) termPrint(`ls: cannot access '${esc(target)}': No such file or directory`, "c-red");
        else if (node.type === "file") termPrint(esc(parts[parts.length - 1]));
        else termPrint(lsHTML(node, cmd !== "ls" || flags.includes("l") || flags.includes("a")));
        break;
      }
      case "cd": {
        const { node, parts } = resolve(target || "~");
        if (!node) termPrint(`cd: no such file or directory: ${esc(target)}`, "c-red");
        else if (node.type !== "dir") termPrint(`cd: not a directory: ${esc(target)}`, "c-red");
        else t.cwd = parts;
        break;
      }
      case "pwd":
        termPrint(esc("/" + t.cwd.join("/")));
        break;
      case "cat":
      case "less":
      case "more":
      case "head": {
        if (!target) return termPrint(`${cmd}: missing file operand`, "c-red");
        const { node } = resolve(target);
        if (!node) termPrint(`${esc(cmd)}: ${esc(target)}: No such file or directory`, "c-red");
        else if (node.type === "dir") termPrint(`${esc(cmd)}: ${esc(target)}: Is a directory`, "c-red");
        else if (node.binary) termPrint(`${esc(cmd)}: ${esc(target)}: binary image. try: open ${esc(target)}`, "c-yellow");
        else termPrint(esc(await node.content()));
        break;
      }
      case "open":
      case "xdg-open":
      case "vim":
      case "nvim":
      case "vi":
      case "code": {
        if (!target) return termPrint(`${cmd}: what should I open? e.g. ${cmd} roam`, "c-yellow");
        let { node } = resolve(target);
        if (!node) {
          const p = S.data.projects.find((x) => x.id === target || x.id.startsWith(target) || x.name.toLowerCase().startsWith(target.toLowerCase()));
          if (p) return (closeOverlays(), goTo("projects", p.id));
          return termPrint(`${esc(cmd)}: ${esc(target)}: No such file or directory`, "c-red");
        }
        openNode(node, target);
        break;
      }
      case "tree": {
        const { node, parts } = resolve(target || ".");
        if (node?.type !== "dir") return termPrint(`tree: ${esc(target)}: not a directory`, "c-red");
        termPrint(`<span class="ls-dir">${esc(prettyPath(parts))}</span>\n${treeHTML(node)}`);
        break;
      }
      case "grep":
      case "rg":
      case "ag": {
        const q = args.filter((a) => !a.startsWith("-")).join(" ").replace(/^["']|["']$/g, "");
        if (!q) return termPrint("usage: grep <text>", "c-yellow");
        const files = walkFiles(resolve("~").node, ["home", "guest"], []);
        const hits = [];
        for (const f of files) {
          const lines = String(await f.c.content()).split("\n");
          lines.forEach((l, i) => {
            if (l.toLowerCase().includes(q.toLowerCase())) hits.push({ path: f.path, n: i + 1, l });
          });
        }
        if (!hits.length) return termPrint(`<span class="c-dim">no matches for "${esc(q)}"</span>`);
        const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        termPrint(
          hits
            .slice(0, 40)
            .map((h) => {
              const text = h.l.length > 110 ? h.l.slice(0, 110) + "…" : h.l;
              return `<span class="c-magenta">${esc(h.path)}</span>:<span class="c-green">${h.n}</span>: ${esc(text).replace(re, (m) => `<mark>${m}</mark>`)}`;
            })
            .join("\n") + (hits.length > 40 ? `\n<span class="c-dim">… ${hits.length - 40} more</span>` : ""),
        );
        break;
      }
      case "git":
        if (args[0] === "log") {
          termPrint(
            S.data.experience
              .map((e, i) => `<span class="c-yellow">${hash7(e.id + e.company)}</span> ${i === 0 ? '<span class="c-cyan">(<span class="c-green b">HEAD -&gt; main</span>)</span> ' : ""}${esc(e.role)} @ ${esc(e.company)} <span class="c-dim">${esc(e.date)}</span>`)
              .join("\n"),
          );
        } else if (args[0] === "status") {
          termPrint("On branch main\nnothing to commit, working tree clean\n<span class=\"c-dim\">(currently open to new opportunities: try `mail`)</span>");
        } else termPrint("usage: git log | git status", "c-yellow");
        break;
      case "neofetch":
      case "fastfetch":
        termPrint(neofetchText());
        break;
      case "whoami":
        termPrint("guest  <span class=\"c-dim\">(you're looking for</span> <span class=\"c-green\">cat ~/README.md</span><span class=\"c-dim\">)</span>");
        break;
      case "id":
        termPrint("uid=1000(guest) gid=1000(guest) groups=1000(guest),100(recruiters)");
        break;
      case "uname":
        termPrint(flags.includes("a") ? "rlphjyson 5.1.0-portfolio #1 SMP x86_64 GNU/Linux" : "Linux");
        break;
      case "hostname":
        termPrint("rlphjyson.dev");
        break;
      case "date":
        termPrint(esc(new Date().toString()));
        break;
      case "echo":
        termPrint(esc(args.join(" ").replace(/\$USER/g, "guest").replace(/\$HOME/g, "/home/guest")));
        break;
      case "theme":
      case "colorscheme":
        if (!target) termPrint(THEMES.map((x) => (x === S.theme ? `<span class="c-green">* ${x}</span>` : `  ${x}`)).join("\n"));
        else if (THEMES.includes(target)) {
          setTheme(target, false);
          termPrint(`colorscheme → <span class="c-cyan">${esc(target)}</span>`);
        } else termPrint(`theme: unknown '${esc(target)}'. try: ${THEMES.join(", ")}`, "c-red");
        break;
      case "mail":
      case "hire":
        termPrint(`opening mail to <span class="c-cyan">${esc(S.data.profile.email)}</span>…`);
        location.href = `mailto:${S.data.profile.email}?subject=${encodeURIComponent("Hello from your portfolio")}`;
        break;
      case "gh":
        termPrint(`opening ${esc(S.data.profile.github)}`);
        openUrl(S.data.profile.github);
        break;
      case "linkedin":
        termPrint(`opening ${esc(S.data.profile.linkedin)}`);
        openUrl(S.data.profile.linkedin);
        break;
      case "history":
        termPrint(t.history.map((h, i) => `${String(i + 1).padStart(4)}  ${esc(h)}`).join("\n"));
        break;
      case "clear":
        $("#term-out").innerHTML = "";
        break;
      case "man":
        termPrint(target ? `No manual entry for ${esc(target)}. Try <span class="c-green">help</span>.` : "What manual page do you want?", "c-yellow");
        break;
      case "sudo":
        termPrint("guest is not in the sudoers file. This incident will be reported.", "c-red");
        break;
      case "rm":
        termPrint(`rm: cannot remove '${esc(target || "")}': Read-only file system`, "c-red");
        break;
      case "ssh":
        termPrint("you're already in. welcome :)", "c-green");
        break;
      case "exit":
      case "logout":
      case "quit":
      case ":q":
        closeOverlays();
        break;
      default:
        termPrint(`zsh: command not found: ${esc(cmd)} <span class="c-dim">(try help)</span>`, "c-red");
    }
    $("#term-ps1").innerHTML = ps1();
  }

  function shellComplete(input) {
    const v = input.value;
    const parts = v.split(/\s+/);
    if (parts.length <= 1) {
      const m = SHELL_CMDS.filter((c) => c.startsWith(parts[0]));
      if (m.length === 1) input.value = m[0] + " ";
      else if (m.length > 1) termPrint(m.join("  "), "c-dim");
      return;
    }
    const arg = parts[parts.length - 1];
    const slash = arg.lastIndexOf("/");
    const dirPart = slash >= 0 ? arg.slice(0, slash + 1) : "";
    const stem = arg.slice(slash + 1);
    const { node } = resolve(dirPart || ".");
    if (node?.type !== "dir") return;
    const m = Object.keys(node.children).filter((n) => n.startsWith(stem));
    if (m.length === 1) {
      const isDir = node.children[m[0]].type === "dir";
      parts[parts.length - 1] = dirPart + m[0] + (isDir ? "/" : "");
      input.value = parts.join(" ");
    } else if (m.length > 1) {
      termPrint(m.join("  "), "c-dim");
      let common = m[0];
      for (const x of m) while (!x.startsWith(common)) common = common.slice(0, -1);
      parts[parts.length - 1] = dirPart + common;
      input.value = parts.join(" ");
    }
  }

  function onTermKey(e) {
    const input = e.target;
    const t = S.term;
    if (e.key === "Enter") {
      e.preventDefault();
      const v = input.value;
      input.value = "";
      runShell(v);
    } else if (e.key === "Tab") {
      e.preventDefault();
      shellComplete(input);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!t.history.length) return;
      if (t.hIdx === -1) t.hIdx = t.history.length;
      t.hIdx = clamp(t.hIdx + (e.key === "ArrowUp" ? -1 : 1), 0, t.history.length);
      input.value = t.history[t.hIdx] ?? "";
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      $("#term-out").innerHTML = "";
    } else if (e.key === "c" && e.ctrlKey && !window.getSelection().toString()) {
      e.preventDefault();
      termPrint(`${ps1()} ${esc(input.value)}^C`);
      input.value = "";
    } else if (e.key === "Escape" || (e.key === "d" && e.ctrlKey)) {
      e.preventDefault();
      closeOverlays();
    }
  }

  /* ---------- boot / ssh login --------------------------------------------- */

  async function boot({ force = false, data = null } = {}) {
    const bootEl = $("#boot");
    const log = $("#boot-log");
    const app = $("#app");
    bootEl.hidden = false;
    bootEl.classList.remove("fade");
    $("#boot-skip").hidden = false;
    log.innerHTML = "";
    let skip = reducedMotion() || (!force && store.sget("booted") === "1");
    const onSkip = () => (skip = true);
    window.addEventListener("keydown", onSkip, { once: true });
    bootEl.addEventListener("click", onSkip, { once: true });

    const write = async (html, delay = 70) => {
      log.insertAdjacentHTML("beforeend", html);
      if (!skip) await sleep(delay);
    };
    const type = async (text, speed = 32) => {
      for (const ch of text) {
        log.insertAdjacentText("beforeend", ch);
        if (!skip) await sleep(speed + Math.random() * 30);
      }
    };

    const last = store.get("lastLogin");
    const now = new Date();
    store.set("lastLogin", now.toString());
    const ds = (d) => d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

    await write(`<span class="prompt">visitor@internet</span>:<span class="path">~</span>$ `, 250);
    await type("ssh guest@rlphjyson.dev");
    await write("\n", 220);
    await write(`Connecting to rlphjyson.dev port 22…\n`, 260);
    await write(`Authenticated to rlphjyson.dev using "none" (you're welcome here).\n`, 160);
    await write(last ? `Last login: ${esc(ds(new Date(last)))} <span class="warn">(your previous visit)</span>\n\n` : `First login detected. Welcome!\n\n`, 180);
    await write(`  rlphjyson.dev · portfolio shell · ${esc(now.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }))}\n\n`, 120);

    const d = data || S.data;
    const okLines = d
      ? [
          `Mounted <span class="path">~/projects</span> (${d.projects.length} repositories)`,
          `Loaded experience.log (${d.experience.length} entries, ${careerUptime()})`,
          `Indexed skills (${Object.keys(d.stack).length} technologies)`,
          `Started vim-motions.service`,
          `Reached target <span class="path">portfolio</span>.`,
        ]
      : [];
    for (const l of okLines) await write(` [ <span class="ok">OK</span> ] ${l}\n`, 110);
    await write(`\n<span class="prompt">guest@rlphjyson</span>:<span class="path">~</span>$ `, 200);
    await type("tmux attach -t portfolio", 26);
    await write(`<span class="cursor"></span>`, 320);

    window.removeEventListener("keydown", onSkip);
    store.sset("booted", "1");
    app.removeAttribute("aria-hidden");
    $("#boot-skip").hidden = true;
    if (skip && !force) {
      bootEl.hidden = true;
    } else {
      bootEl.classList.add("fade");
      await sleep(360);
      bootEl.hidden = true;
    }
    $("#viewer").focus({ preventScroll: true });
  }

  function logout() {
    const bootEl = $("#boot");
    bootEl.hidden = false;
    bootEl.classList.remove("fade");
    $("#boot-skip").hidden = true;
    $("#app").setAttribute("aria-hidden", "true");
    $("#boot-log").innerHTML =
      `<span class="prompt">guest@rlphjyson</span>:<span class="path">~</span>$ logout\nConnection to rlphjyson.dev closed.\n\n` +
      `Thanks for stopping by. Reach me at <a href="mailto:${esc(S.data.profile.email)}">${esc(S.data.profile.email)}</a>.\n\n` +
      `<span class="prompt">visitor@internet</span>:<span class="path">~</span>$ <span class="c-dim">press any key to reconnect</span><span class="cursor"></span>`;
    const again = (e) => {
      if (e.target.closest?.("a")) return;
      window.removeEventListener("keydown", again, true);
      bootEl.removeEventListener("click", again);
      if (e.preventDefault) e.preventDefault();
      boot({ force: true });
    };
    setTimeout(() => {
      window.addEventListener("keydown", again, true);
      bootEl.addEventListener("click", again);
    }, 150);
  }

  /* ---------- keyboard: normal mode --------------------------------------- */

  function onKey(e) {
    if (!$("#boot").hidden) return;
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    const ov = overlayOpen();
    if (ov) return onOverlayKey(e, ov);

    const { key, ctrlKey, metaKey, altKey } = e;
    if (metaKey || altKey) return;

    // two-key sequences: gg, ZZ
    if (S.pending) {
      const seq = S.pending + key;
      S.pending = "";
      if (seq === "gg") return (e.preventDefault(), go(S.p, 0));
      if (seq === "ZZ" || seq === "ZQ") return (e.preventDefault(), logout());
    }

    if (ctrlKey) {
      const map = { d: () => scrollMain(window.innerHeight / 2), u: () => scrollMain(-window.innerHeight / 2), e: () => scrollMain(60), y: () => scrollMain(-60), f: () => scrollMain(window.innerHeight * 0.85), b: () => scrollMain(-window.innerHeight * 0.85), n: () => moveItem(1), p: () => moveItem(-1), k: () => openSearch() };
      if (map[key]) {
        e.preventDefault();
        map[key]();
      }
      return;
    }

    const actions = {
      j: () => moveItem(1),
      ArrowDown: () => moveItem(1),
      k: () => moveItem(-1),
      ArrowUp: () => moveItem(-1),
      h: () => movePanel(-1),
      ArrowLeft: () => movePanel(-1),
      l: () => movePanel(1),
      ArrowRight: () => movePanel(1),
      Tab: () => movePanel(e.shiftKey ? -1 : 1),
      G: () => go(S.p, currentPanel().items.length - 1),
      Home: () => go(S.p, 0),
      End: () => go(S.p, currentPanel().items.length - 1),
      g: () => (S.pending = "g"),
      Z: () => (S.pending = "Z"),
      J: () => scrollMain(80),
      K: () => scrollMain(-80),
      PageDown: () => scrollMain(window.innerHeight * 0.7),
      PageUp: () => scrollMain(-window.innerHeight * 0.7),
      " ": () => scrollMain(e.shiftKey ? -window.innerHeight * 0.7 : window.innerHeight * 0.7),
      "/": () => openSearch(),
      ":": () => enterCommand(),
      ";": () => enterCommand(),
      "?": () => openHelp(),
      "`": () => openTerminal(),
      "~": () => openTerminal(),
      n: () => nextResult(1),
      N: () => nextResult(-1),
      t: () => cycleTheme(),
      T: () => setTheme(THEMES[(THEMES.indexOf(S.theme) - 1 + THEMES.length) % THEMES.length]),
      Enter: () => activate(),
      o: () => openPrimary(),
      O: () => openDemo(),
      p: () => openPub(),
      y: () => yankCurrent(),
      Y: () => yank(location.href),
      Escape: () => (S.hl ? clearHighlight() : msg("")),
      q: () => msg('type <kbd>:q</kbd> and <kbd>Enter</kbd> to log out', "info"),
      i: () => msg('-- INSERT -- is disabled: this buffer is read-only. Try <kbd>`</kbd> for a shell.', "info"),
      a: () => msg('-- INSERT -- is disabled: this buffer is read-only. Try <kbd>`</kbd> for a shell.', "info"),
      u: () => msg("Already at oldest change", "info"),
    };
    if (/^[1-9]$/.test(key)) {
      e.preventDefault();
      const n = parseInt(key, 10) - 1;
      if (n < S.panels.length) go(n);
      return;
    }
    const fn = actions[key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }

  function activate() {
    const panel = currentPanel();
    if (panel.id === "projects") return openProjectShots(0);
    if (panel.id === "contact") {
      const it = currentItem();
      return it.id === "email" ? (location.href = it.url) : openUrl(it.url);
    }
    $("#viewer").focus();
    scrollMain(window.innerHeight / 3);
  }

  function openPrimary() {
    const panel = currentPanel();
    if (panel.id === "projects") return openUrl(S.data.projects[S.sel.projects].github);
    if (panel.id === "contact") return activate();
    openUrl(S.data.profile.github);
  }

  function openDemo() {
    if (currentPanel().id !== "projects") return msg("only projects have demos", "info");
    const p = S.data.projects[S.sel.projects];
    if (p.demo) openUrl(p.demo);
    else msg(`${esc(p.name)} has no hosted demo. <kbd>o</kbd> opens the source.`, "info");
  }

  function openPub(anywhere = false) {
    const onProject = currentPanel().id === "projects";
    const p = onProject ? S.data.projects[S.sel.projects] : null;
    if (p?.pub) return openUrl(p.pub);
    const pkg = S.data.projects.find((x) => x.pub);
    if (anywhere && pkg) return openUrl(pkg.pub);
    msg(onProject ? `${esc(p.name)} isn't a published package. <kbd>:pub</kbd> opens Cairn UI on pub.dev.` : "<kbd>:pub</kbd> opens Cairn UI on pub.dev", "info");
  }

  function yankCurrent() {
    const panel = currentPanel();
    if (panel.id === "projects") return yank(S.data.projects[S.sel.projects].github);
    if (panel.id === "contact") return yank(currentItem().value);
    yank(location.href);
  }

  function onOverlayKey(e, ov) {
    const { key } = e;
    if (key === "Escape" || key === "q") {
      e.preventDefault();
      return closeOverlays();
    }
    if (ov.id === "lightbox") {
      if (["l", "ArrowRight", "j", " ", "n"].includes(key)) (e.preventDefault(), lbStep(1));
      else if (["h", "ArrowLeft", "k", "p", "N"].includes(key)) (e.preventDefault(), lbStep(-1));
      else if (key === "o") openUrl(S.lb.images[S.lb.i].src);
    } else if (ov.id === "help") {
      const body = $("#help-body");
      if (key === "j" || key === "ArrowDown") (e.preventDefault(), body.scrollBy({ top: 60 }));
      else if (key === "k" || key === "ArrowUp") (e.preventDefault(), body.scrollBy({ top: -60 }));
      else if (key === "?") (e.preventDefault(), closeOverlays());
    }
  }

  function onTeleKey(e) {
    const k = e.key;
    const move = (d) => {
      e.preventDefault();
      if (!tele.results.length) return;
      tele.i = (tele.i + d + tele.results.length) % tele.results.length;
      renderTeleList();
    };
    if (k === "ArrowDown" || (e.ctrlKey && (k === "n" || k === "j")) || (k === "Tab" && !e.shiftKey)) move(1);
    else if (k === "ArrowUp" || (e.ctrlKey && (k === "p" || k === "k")) || (k === "Tab" && e.shiftKey)) move(-1);
    else if (k === "Enter") {
      e.preventDefault();
      chooseTele();
    } else if (k === "Escape" || (e.ctrlKey && k === "c")) {
      e.preventDefault();
      closeOverlays();
    }
  }

  /* ---------- mouse / touch ----------------------------------------------- */

  function initPointer() {
    $("#sidebar").addEventListener("click", (e) => {
      const panelEl = e.target.closest(".panel");
      if (!panelEl) return;
      const p = parseInt(panelEl.dataset.p, 10);
      const li = e.target.closest(".item");
      if (li) {
        const i = parseInt(li.dataset.i, 10);
        const same = p === S.p && i === S.sel[S.panels[p].id];
        go(p, i);
        if (same && S.panels[p].id === "contact") activate();
      } else go(p);
    });

    $("#tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) go(parseInt(b.dataset.p, 10));
    });

    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-go],[data-tech],[data-shot],[data-yank],[data-close]");
      if (!el) return;
      if (el.dataset.close != null) return closeOverlays();
      if (el.dataset.go) {
        const [panel, id] = el.dataset.go.split(":");
        closeOverlays();
        goTo(panel, id);
      } else if (el.dataset.tech) {
        const si = skillIndexFor(el.dataset.tech);
        if (si >= 0) {
          closeOverlays();
          goTo("skills", S.data.skills[si].id);
          S.hl = stackOf(el.dataset.tech).label;
          applyHighlight(S.hl);
          S.lastSearch = { query: S.hl, results: [], idx: -1 };
          updateStatus();
        }
      } else if (el.dataset.shot != null) {
        openProjectShots(parseInt(el.dataset.shot, 10));
      } else if (el.dataset.yank) {
        yank(el.dataset.yank);
      }
    });

    // click on the backdrop closes overlays
    $$(".overlay").forEach((ov) =>
      ov.addEventListener("mousedown", (e) => {
        if (e.target === ov) closeOverlays();
      }),
    );

    $("#tele-results").addEventListener("mousemove", (e) => {
      const li = e.target.closest("li[data-i]");
      if (!li) return;
      const i = parseInt(li.dataset.i, 10);
      if (i !== tele.i) {
        tele.i = i;
        $$("#tele-results li").forEach((x, j) => x.classList.toggle("sel", j === i));
        renderTelePreview();
      }
    });
    $("#tele-results").addEventListener("click", (e) => {
      const li = e.target.closest("li[data-i]");
      if (li) chooseTele(parseInt(li.dataset.i, 10));
    });

    $(".lb-prev").addEventListener("click", () => lbStep(-1));
    $(".lb-next").addEventListener("click", () => lbStep(1));
    let touchX = null;
    $(".lb-stage").addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
    $(".lb-stage").addEventListener("touchend", (e) => {
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 40) lbStep(dx < 0 ? 1 : -1);
      touchX = null;
    });

    $("#drawer-toggle").addEventListener("click", () => toggleDrawer());
    $("#help-btn").addEventListener("click", () => openHelp());
    $("#cmdline").addEventListener("click", (e) => {
      if (S.mode === "NORMAL" && !e.target.closest("a")) enterCommand();
    });
    $("#terminal").addEventListener("click", (e) => {
      if (!window.getSelection().toString() && !e.target.closest("button,a")) $("#term-input").focus();
    });

    $("#keybar").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const k = b.dataset.key;
      if (k === "drawer") toggleDrawer();
      else if (k === "prev") moveItem(-1);
      else if (k === "next") moveItem(1);
      else if (k === "/") openSearch();
      else if (k === ":") enterCommand();
      else if (k === "term") openTerminal();
      else if (k === "?") openHelp();
    });

    $("#viewer").addEventListener("scroll", updateScrollPct, { passive: true });

    // swipe between items on the main pane (mobile)
    let sx = null;
    let sy = null;
    $("#viewer").addEventListener("touchstart", (e) => ((sx = e.touches[0].clientX), (sy = e.touches[0].clientY)), { passive: true });
    $("#viewer").addEventListener("touchend", (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 40) moveItem(dx < 0 ? 1 : -1);
      sx = sy = null;
    });
  }

  /* ---------- clock -------------------------------------------------------- */

  function tick() {
    const d = new Date();
    $("#st-clock").textContent = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  /* ---------- init ------------------------------------------------------- */

  async function init() {
    let data;
    try {
      data = await loadData();
    } catch (err) {
      $("#boot-log").innerHTML =
        `<span class="prompt">visitor@internet</span>:<span class="path">~</span>$ ssh guest@rlphjyson.dev\n` +
        `<span class="c-red">ssh: could not load portfolio data (${esc(err.message)})</span>\n\n` +
        `If you opened index.html straight from disk, serve the folder instead:\n  npx serve .   or   python -m http.server\n`;
      return;
    }
    S.data = data;
    buildPanels();
    renderSidebar();
    buildIndex();
    buildFS();

    $("#cmd-input").addEventListener("keydown", onCmdKey);
    $("#cmd-input").addEventListener("blur", () => S.mode === "COMMAND" && setTimeout(() => S.mode === "COMMAND" && leaveCommand(), 120));
    $("#tele-input").addEventListener("input", updateTele);
    $("#tele-input").addEventListener("keydown", onTeleKey);
    $("#term-input").addEventListener("keydown", onTermKey);
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", () => fromHash());
    initPointer();

    if (!fromHash()) go(0, 0);
    setTheme(S.theme, false);
    tick();
    setInterval(tick, 15000);

    await boot({ data });
  }

  init();
})();
