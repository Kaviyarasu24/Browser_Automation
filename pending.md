# 📋 Strawberry — Pending Features & Product Roadmap

This document tracks upcoming features, architectural improvements, and planned capabilities for the Strawberry AI desktop browser.

---

## ⚡ 1. Speed & Token Optimization Suite
> **Status: ✅ Completed**
- [x] **Auto-Read on Navigation & Clicks**: Automatically bundle fresh page DOM snapshots and element indices directly into `navigate` and `click` tool outputs, eliminating redundant `read_page` steps and cutting turn counts by ~50%.
- [x] **Historical Snapshot Pruning**: Collapse older DOM trees in conversation history into 1-line tombstones so prompt token volume stays flat (~3k tokens) instead of ballooning to 50k+ tokens.
- [x] **Semantic DOM Distillation**: Lower DOM extraction noise by dropping redundant footer links and prioritizing in-viewport interactive elements (`MAX_ELEMENTS: 75`, `MAX_TEXT_CHARS: 2800`).
- [x] **Live Token & Cost Tracker**: Stream real-time token counts (`prompt`, `completion`, `total`) and live token badges directly to the agent sidebar header.
- [x] **Direct Query Routing**: System prompt optimization to encourage direct search URL formation (e.g., `google.com/search?q=...`) over slow multi-click homepage navigation.

---

## 👁️ 2. Vision & Screenshot Support (Multimodal Agent)
> **Status: ⏳ Pending**
- [ ] **Native Screenshot Capture**: Add a `take_screenshot` tool utilizing Electron's native `wc.capturePage()`.
- [ ] **Multimodal Model Pipeline**: Pass base64 compressed viewport screenshots to multimodal models (Claude 3.5 Sonnet, GPT-4o, Gemini 2.0 Flash) when visual layout inspection is requested.
- [ ] **Canvas & Non-DOM Understanding**: Enable the agent to interpret charts, data visualizations, maps, and visual image CAPTCHAs that pure DOM trees cannot capture.

---

## 💾 3. Task History & Run Persistence
> **Status: ✅ Completed**
- [x] **Local Task Database**: Persist completed tasks, step logs, timings, token metrics, and final answers locally in `appData/strawberry-history.json`.
- [x] **Sidebar History Drawer**: Clean slide-over drawer triggered by the hamburger icon (`≡`) on the side panel header to review past chats and runs.
- [x] **Interactive Conversation Restore**: Click any past run to instantly load the full event trajectory and thought process back into the conversation view.
- [x] **Item & Batch Deletion**: Delete individual history items or clear entire history with a single click.
- [x] **Runtime Settings Manager**: Full UI modal to edit `Base URL`, `API Key` (with show/hide mask toggle), and `Model Identifier` (with one-click presets like Nemotron, Sonnet 3.5, GPT-4o, Gemini 2.0 Flash) with auto-persistence to `.env`.
- [x] **In-App Connection Tester**: Test API keys and connectivity directly with live ping checks and feedback badges.

---

## 📥 4. File Download & Export Manager
> **Status: ✅ Completed**
- [x] **Download Interception**: Listen to Electron's `will-download` session events when the agent or user triggers downloads (PDFs, CSVs, invoices, images).
- [x] **Safe Destination Routing**: Automatically route downloads to isolated `Downloads/Strawberry/` directory with automatic filename collision resolution and zero blocking OS dialogs.
- [x] **File Path & Size Reporting**: Real-time event notifications (`download`) reporting file path, size, and completion state to both agent context and UI feed.
- [x] **Downloads Drawer UI**: Top bar downloads popover with progress indicators, Open File, and Show in Folder actions.
- [x] **Export Agent Results**: Instant export of agent summaries to `.md`, `.json`, `.csv`, `.txt` via `export_data` tool and one-click UI pills.

---

## 🏠 5. Custom "New Tab" Dashboard
> **Status: ⏳ Pending**
- [ ] **Branded Start Page**: Replace `about:blank` with a clean, modern Strawberry start page.
- [ ] **Quick Action Pills**: One-click action shortcuts (e.g. *"Check Cricket Scores"*, *"Trending Tech News"*, *"GitHub Repos"*).
- [ ] **Status & Health Widget**: Live display of configured LLM provider, model latency, and active cookies/sessions.
