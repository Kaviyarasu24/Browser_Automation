# 🍓 Strawberry

> **AI-first desktop browser.** An autonomous browser agent that drives your real, logged-in desktop browsing session.

Strawberry is a desktop browser built with **Electron**, **TypeScript**, **Vite**, and **React**. Unlike conventional headless agents or Playwright-based bots that spin up empty, ephemeral browser contexts every run, Strawberry operates directly within your persistent user partition (`persist:strawberry`). 

Because it runs inside your genuine desktop session with stored cookies and local credentials, the agent can interact with your logged-in services without triggering login walls, multi-factor prompts, or bot-detection heuristics.

---

## ✨ Features

- **Persistent Real-User Sessions**: Uses Electron's persistent storage partition (`persist:strawberry`) and a desktop Chrome User-Agent string. Your logins, cookies, and local storage persist across sessions and app restarts.
- **Human-in-the-Loop Safeguards**: Automatically pauses execution and alerts the user for approval when high-risk actions are detected (purchases/checkout, deletion/account changes, credential inputs, or cross-domain hops).
- **On-Screen Virtual Mouse**: Features an animated virtual mouse cursor that visually glides across the viewport to target elements, emits glowing click ripple effects, displays live action badges (e.g., `Typing: ...`, `⏎ Enter`), and animates scrolling cues.
- **Native OS Input Events**: Dispatches real hardware-level input events via `WebContentsView.sendInputEvent` and `insertText` instead of synthetic `element.click()`, ensuring compatibility with React/Vue frameworks and bypassing bot-detection blocks.
- **Dynamic Coordinate Resolution**: Evaluates page state and re-verifies interactive element coordinates immediately before taking actions, preventing misclicks caused by layout shifts or lazy-loaded content.
- **Integrated Agent Sidebar**: Clean dark-mode React shell with a real-time activity feed displaying the model's step-by-step thinking, tool calls, argument inspection, results, and cancellation controls.
- **OpenAI-Compatible LLM Integration**: Connects to any provider speaking the OpenAI Chat Completions protocol (OpenRouter, OpenAI, Groq, local vLLM, Ollama, etc.) with automated tool calling.

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
│   │       ├── actions.ts     # Native input event dispatchers
│   │       ├── safeguards.ts  # Sensitive action & domain boundary detection
│   │       ├── page-state.ts  # DOM extraction script for interactive elements
│   │       └── cursor.ts      # Injected Shadow-DOM virtual mouse overlay
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

## 🤖 Supported Agent Tools

The autonomous loop exposes the following tools to the LLM:

- `read_page`: Captures the current URL, page title, scroll position, and a numbered list of all visible interactive DOM elements with their screen coordinates.
- `navigate`: Navigates the active tab to an absolute URL.
- `click`: Moves the virtual cursor to an element's center coordinate, triggers a click animation, and sends native mouse events.
- `type`: Focuses the input element, displays an on-screen typing badge, inserts text, and optionally presses Enter.
- `scroll`: Scrolls the viewport up or down with animated scroll indicators.
- `go_back`: Navigates backward in tab history.
- `press_key`: Sends navigation and dialog keys (`Enter`, `Escape`, `Tab`, `ArrowDown`, etc.).
- `wait`: Pauses execution to allow dynamic asynchronous content to settle.
- `open_tab`: Opens a URL in a new background tab.
- `done`: Finalizes the task and presents a summary of findings to the user.

---

## 🔒 Security & Privacy

- **Partition Isolation**: Untrusted web pages run in isolated `WebContentsView` containers with `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`. Web pages cannot access Electron or Node APIs.
- **IPC Whitelist**: Only the main React shell window has access to the preload bridge (`window.api`).
- **Data Persistence**: Browsing profile data, cookies, and tokens are stored locally under your operating system's standard user data path (`userData/Partitions/strawberry`) and are never sent to external servers other than the sites you visit.

