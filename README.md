# Ralph Jason Burgos — Portfolio

Senior Software Engineer based in the Philippines, with 5+ years building production-grade, cross-platform apps for mobile and web.
Flutter is my daily driver. I also build with Next.js, Go and FastAPI, and lately AI tooling on Claude.

The site is a terminal you "ssh" into: a lazygit-style TUI driven by vim motions, written in plain HTML, CSS and JavaScript with no build step.

---

## Using the site

| Key | Does |
| --- | --- |
| `h` `l` / `←` `→` / `Tab` | switch panel |
| `j` `k` / `↓` `↑` | move in a list |
| `1`…`5` | jump to a panel |
| `gg` `G` | first / last item |
| `Ctrl-d` `Ctrl-u` | scroll the content |
| `/` | fuzzy finder across projects, jobs, skills and tech |
| `n` `N` | next / previous search result |
| `:` | command line with Tab completion and history (`:help`, `:e roam`, `:colo gruvbox`, `:gh`, `:q`) |
| `` ` `` | a small shell over a virtual filesystem (`ls`, `cd`, `cat`, `tree`, `grep`, `open`, `git log`, `neofetch`) |
| `Enter` / `o` / `O` / `y` | screenshots / source / live demo / yank link |
| `t` | cycle colorschemes (rlphjyson, tokyonight, gruvbox, catppuccin, dracula, nord, matrix, paper) |
| `?` | every keybinding |

Everything is clickable too, and on phones there's a quick-key bar and a panel drawer.
Every view has a deep link, for example `/#/projects/roam`.

---

## Projects

| Project | What it is |
| --- | --- |
| [Cairn UI](https://github.com/rlphjyson/cairn_ui) | 65-component Flutter library on an engineered token system, held in place by golden tests |
| [Flutter MCP Toolkit](https://github.com/rlphjyson/flutter-mcp-toolkit) | 12 MCP servers for the Flutter lifecycle, plus a gateway and CLI |
| [Cairn Site](https://github.com/rlphjyson/cairn_site) | Docs site for Cairn UI, built with Cairn UI ([live](https://rlphjyson.github.io/cairn_site/)) |
| [MCP Toolkit AI](https://github.com/rlphjyson/mcp-toolkit-ai) | 17 MCP servers behind one gateway |
| [Agent Ops Dashboard](https://github.com/rlphjyson/agent-ops-dashboard) | Watch Claude agents work live, with multiple runs in flight |
| [DocuChat AI](https://github.com/rlphjyson/docuchat-ai) | RAG chat over your documents with cited, streamed answers |
| [PRReview AI](https://github.com/rlphjyson/prreview-ai) | AI code review for GitHub pull requests |
| [LocalChat AI](https://github.com/rlphjyson/localchat-ai) | ChatGPT-like desktop app on a fully local model |
| [GenUI Flutter](https://github.com/rlphjyson/genui-flutter-sample) | Prompts compiled into native Flutter widgets at runtime |
| [Roam](https://github.com/rlphjyson/roam) | Offline-first travel companion with an explainable recommendation engine |
| [Jaspr Web Template](https://github.com/rlphjyson/jaspr-web-template) | Server-rendered Dart web app template |
| [Go Starter Kit](https://github.com/rlphjyson/go-starter-kit) | Production-shaped Go HTTP API template |
| [FastAPI Starter Kit](https://github.com/rlphjyson/fastapi-starter-kit) | Hexagonal FastAPI template |

---

## Tech stack

- **Mobile & frontend:** Flutter, Dart, Bloc, Riverpod, React, React Native, Next.js, TypeScript, Jaspr, Tailwind CSS, Electron, generative UI
- **Backend:** Go, FastAPI, Python, Node.js, Express.js, Laravel
- **Architecture:** Clean and hexagonal architecture, offline-first sync, streaming (SSE / WebSockets), MCP
- **Data:** PostgreSQL, MongoDB, MySQL, SQLite, SQLAlchemy, Drift, Hive, Chroma
- **Security:** JWT, OAuth2, RBAC / IAM, UI-level data masking
- **Cloud & DevOps:** AWS, Google Cloud, Docker, GitHub Actions, Fastlane, Firebase, Sentry
- **AI:** Claude API, Claude Agent SDK, Claude Code, RAG, Ollama
- **Testing:** unit, widget, golden and integration tests, pytest, Vitest

---

## Editing the content

All content is JSON in `data/`. No HTML changes needed.

| File | Holds |
| --- | --- |
| `data/profile.json` | name, summary, links, education |
| `data/experience.json` | jobs; `{{text}}` is highlighted |
| `data/projects.json` | projects, screenshots and the architecture diagram to show |
| `data/skills.json` | skill groups; each lists keys from `stack.json` |
| `data/stack.json` | every technology: label plus icon (`images/stack/*.svg`) or a glyph |
| `data/diagrams/` | architecture diagrams taken from each project's README (`.mmd` Mermaid or `.txt` ASCII) |

Screenshots live in `images/projects/<project-id>/` as WebP.
Tech icons are from [Devicon](https://devicon.dev) (MIT) and [Simple Icons](https://simpleicons.org) (CC0).
Mermaid diagrams render client-side with [Mermaid](https://mermaid.js.org), loaded from jsDelivr only when a project with a diagram is opened. If it can't load, the diagram source is shown instead.

## Running locally

The site fetches its JSON, so serve the folder rather than opening the file directly:

```bash
python -m http.server 8000
# or
npx serve .
```

---

## Contact

- Email: rlphjyson@gmail.com
- GitHub: [rlphjyson](https://github.com/rlphjyson)
- LinkedIn: [ralph-jason-burgos](https://www.linkedin.com/in/ralph-jason-burgos/)
