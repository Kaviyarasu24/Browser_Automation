# 🍓 Strawberry

> **AI-first desktop browser.** An autonomous browser agent that drives your real, authenticated desktop browsing session with a live, persistent virtual cursor.

Strawberry is an AI desktop browser built with **Electron**, **TypeScript**, **Vite**, and **React**. Unlike conventional headless agents or Playwright-based bots that spin up empty, ephemeral browser contexts every run, Strawberry operates directly within your persistent user partition (`persist:strawberry`). 

Because it runs inside your genuine desktop session with stored cookies and local credentials, the agent can interact with your logged-in services without triggering login walls, multi-factor prompts, or bot-detection heuristics.

---

## ✨ Features

- **Speed & Token Optimization Suite**: Auto-reads updated DOM snapshots on navigations and clicks to cut steps in half, prunes historical DOM snapshots from conversation history to reduce tokens by ~70%, and displays a live token counter in the sidebar.
- **Persistent Real-User Sessions**: Uses Electron's persistent storage partition (`persist:strawberry`) and a desktop Chrome User-Agent string. Your logins, cookies, and local storage persist across sessions and app restarts.
- **Always-Active Virtual Mouse**: A high-visibility on-screen cursor that stays active throughout the entire agent run. A background watchdog guarantees the cursor never disappears across page navigations, redirects, or SPA route transitions.
- **CSP & Trusted Types Immune**: Built using safe programmatic DOM & SVG node construction inside a Shadow Root (`attachShadow`), rendering reliably on strict sites (e.g., Google, Cricbuzz) without being blocked by Content Security Policy.
- **Animated URL Navigation**: When opening an address, the virtual cursor visibly glides to the address bar, clicks to focus, types the destination URL at **2x speed** with a live keystroke badge, and presses Enter in sync with the browser's address bar.
- **Link & Target Element Highlighting**: Before clicking any button or link, the cursor glides to the target, paints an animated glowing highlight box around the element, and displays a preview action badge.
- **2x Speed Typing with Live Caret**: Form fields and search inputs are filled character-by-character at brisk 2x speed (~25ms/char) with a live typing badge and blinking cursor (`Typing: "..."▎`), followed by animated `⏎ Enter` submissions.
- **Smooth Window Scrolling with Wheel Events**: Replaces instant jump scrolls with smooth multi-step window scrolling paired with hardware-level `mouseWheel` events and floating directional indicators.
- **Human-in-the-Loop Safeguards**: Automatically pauses execution and alerts the user for approval via an interactive banner when high-risk operations are detected (purchases/checkout, account deletion, sensitive credential typing, or cross-domain hops).
- **Native OS Input Events**: Dispatches real hardware-level input events via `WebContentsView.sendInputEvent` and `insertText` instead of synthetic `element.click()`, ensuring compatibility with React/Vue frameworks and bypassing bot heuristics.
- **Dynamic Coordinate Resolution**: Evaluates page state and re-verifies interactive element coordinates immediately before taking actions, preventing misclicks caused by layout shifts or lazy-loaded content.
- **OpenAI-Compatible LLM Integration**: Connects to any provider speaking the OpenAI Chat Completions protocol (OpenRouter, OpenAI, Groq, local vLLM, Ollama, etc.) with automated tool calling.

---

## 🎬 Live Cursor Action Matrix

Every action performed by the agent is visually animated through the on-screen cursor:

| Action | Cursor Animation & Visual Feedback |
| :--- | :--- |
| **`navigate`** | Glides to the address bar, clicks, types out URL at 2x speed, flashes `⏎ Enter`, and navigates |
| **`read_page`** | Performs a radar scanning sweep across the viewport with badge: `🔍 Scanning Page Elements...` |
| **`click`** | Glides to coordinates, draws an animated glowing highlight box around the link/button, shows click badge, and triggers ripple |
| **`type`** | Focuses field, types character-by-character at 2x speed with a live caret badge (`Typing: "..."▎`), and submits |
| **`scroll`** | Centers cursor, displays floating directional pill (`↓ Scrolling Down (800px)`), and rolls page in smooth wheel steps |
| **`go_back`** | Glides toward top-left with `← Going Back` badge |
| **`wait`** | Floats gently in place with a live countdown badge: `⏳ Waiting (Ns)...` |
| **`done`** | Glides to viewport center with a celebratory `🎉 Task Complete!` badge |

---

## 🏗️ Project Architecture

```
strawberry/
├── electron.vite.config.ts    # Bundling setup for main, preload, and renderer
├── tsconfig.json              # TypeScript root configuration
├── tsconfig.node.json         # Main & preload process TS configuration
├── tsconfig.web.json          # Renderer (React) TS configuration
├── src/
│   ├── main/
│   │   ├── index.ts           # Electron main process & IPC coordinator
│   │   ├── config.ts          # Dependency-free .env parser and validator
│   │   ├── agent/
│   │   │   ├── llm.ts         # OpenAI-compatible API client & error mapping
│   │   │   ├── loop.ts        # Core 25-step observe-think-act agent loop
│   │   │   └── tools.ts       # Agent tool definitions (click, type, read, etc.)
│   │   └── browser/
│   │       ├── session.ts     # Persistent partition & Chrome User-Agent setup
│   │       ├── tabs.ts        # WebContentsView lifecycle & tab management
│   │       ├── actions.ts     # Native input event dispatchers & smooth scrolling
│   │       ├── safeguards.ts  # Sensitive action & domain boundary detection
│   │       ├── page-state.ts  # DOM extraction script for interactive elements
│   │       └── cursor.ts      # Persistent Shadow-DOM virtual mouse overlay
│   ├── preload/
│   │   ├── index.ts           # Context-isolated IPC bridge (contextBridge)
│   │   └── index.d.ts         # Global TypeScript definitions for window.api
│   ├── renderer/
│   │   ├── index.html         # HTML entry point for the browser shell
│   │   └── src/
│   │       ├── main.tsx       # React root mount
│   │       ├── App.tsx        # UI shell (tab bar, address bar, agent sidebar)
│   │       └── styles.css     # Dark-mode styling and animations
│   └── shared/
│       └── types.ts           # Cross-process data interfaces and event types
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ or v20+ recommended)
- `npm` or `pnpm`

### Installation

1. Navigate to the `strawberry` directory:
   ```bash
   cd strawberry
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Configuration

Copy the example environment file and configure your API credentials:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# OpenAI-compatible endpoint
BASE_URL=https://openrouter.ai/api/v1
API_KEY=sk-or-your-api-key-here

# Recommended models: anthropic/claude-sonnet-5-5, openai/gpt-5.5
MODEL=anthropic/claude-sonnet-5-5

# Optional attribution for OpenRouter
OPENROUTER_SITE_URL=
OPENROUTER_SITE_NAME=Strawberry
```

---

## 🛠️ Available Scripts

| Script | Command | Description |
| :--- | :--- | :--- |
| **Development** | `npm run dev` | Launches the app in Electron development mode with Vite HMR |
| **Type Check** | `npm run typecheck` | Validates TypeScript in both main (`node`) and renderer (`web`) |
| **Build** | `npm run build` | Compiles and bundles production assets to `out/` via `electron-vite` |
| **Preview** | `npm run preview` | Runs the bundled production build locally |

---

## 🛡️ Human-in-the-Loop Confirmation Gates

Because Strawberry operates inside your genuine, authenticated browser session, the agent includes built-in safeguards to protect sensitive data and prevent unwanted actions:

1. **Financial & Purchases**: Intercepts actions with keywords like `pay`, `purchase`, `buy now`, `place order`, `checkout`, `transfer`, and `billing`.
2. **Destructive Actions**: Catches actions containing `delete`, `destroy`, `terminate`, `delete account`, `cancel subscription`, etc.
3. **Credentials & Cards**: Flags attempts to type into password, CVV, or card number fields.
4. **Cross-Domain Boundaries**: Halts and requests approval before navigating away from the established domain to an external third-party site.

When a safeguard is triggered, the agent pauses automatically and displays an amber **"🛡️ Safeguard Alert"** banner in the sidebar with **"✓ Approve Action"** and **"✕ Deny (Block)"** options.

---

## 🔒 Security & Privacy

- **Partition Isolation**: Untrusted web pages run in isolated `WebContentsView` containers with `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`. Web pages cannot access Electron or Node APIs.
- **IPC Whitelist**: Only the main React shell window has access to the preload bridge (`window.api`).
- **Data Persistence**: Browsing profile data, cookies, and tokens are stored locally under your operating system's standard user data path (`userData/Partitions/strawberry`) and are never sent to external servers other than the sites you visit.
