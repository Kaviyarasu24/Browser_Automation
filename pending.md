# 📋 EDITH Browser — Pending Features & Product Roadmap

This document tracks upcoming features, architectural improvements, and planned capabilities for the EDITH AI desktop browser.

---

## ⚡ 1. Speed & Token Optimization Suite
> **Status: ✅ Completed**
- [x] **Auto-Read on Navigation & Clicks**: Automatically bundle fresh page DOM snapshots and element indices directly into `navigate` and `click` tool outputs, eliminating redundant `read_page` steps and cutting turn counts by ~50%.
- [x] **Historical Snapshot Pruning**: Collapse older DOM trees in conversation history into 1-line tombstones so prompt token volume stays flat (~3k tokens) instead of ballooning to 50k+ tokens.
- [x] **Semantic DOM Distillation**: Lower DOM extraction noise by dropping redundant footer links and prioritizing in-viewport interactive elements (`MAX_ELEMENTS: 75`, `MAX_TEXT_CHARS: 2800`).
- [x] **Live Token & Cost Tracker**: Stream real-time token counts (`prompt`, `completion`, `total`) and live token badges directly to the agent sidebar header.
- [x] **Direct Query Routing**: System prompt optimization to encourage direct search URL formation (e.g., `google.com/search?q=...`) over slow multi-click homepage navigation.

---

## 📝 2. Universal Form-Filling & Job Application Automation
> **Status: ✅ Completed**
- [x] **Candidate Profile Store**: Local `profile.json` (gitignored, PII-sanitized) supporting contact info, education, skills, work experience, CTC, notice period, and resume path.
- [x] **Deep Form Scanner**: Shadow DOM and iframe piercing scanner extracting input fields, labels, placeholders, custom dropdowns, radios, and repeaters.
- [x] **3-Tier Mapping Engine**: Regex/synonym rules -> cached answers (`answers-cache.json`) -> LLM distillation for unmapped fields.
- [x] **High-Visibility Cursor & Visible Typing**: Animated virtual mouse with smooth scrolling, click ripples, action badges, and 2x pacing character-by-character typing.
- [x] **ATS Adapters Suite**: Built-in support and quirk handlers for Greenhouse, Lever, Workday, Ashby, SmartRecruiters, LinkedIn Easy Apply, and Naukri.
- [x] **Job Queue Drawer & Tracker**: Sequential batch processing of URLs with live status and persistence to `Downloads/EDITH/applications.csv`.
- [x] **Safeguards & Human Review**: EEO questions defaulted to "Prefer not to say" or left for review, password typing prohibited, and mandatory approval before final submission (with dry-run mode).

---

## 💾 3. Task History & Run Persistence
> **Status: ✅ Completed**
- [x] **Local Task Database**: Persist completed tasks, step logs, timings, token metrics, and final answers locally in `appData/edith-history.json`.
- [x] **Sidebar History Drawer**: Clean slide-over drawer triggered by the hamburger icon (`≡`) on the side panel header to review past chats and runs.
- [x] **Interactive Conversation Restore**: Click any past run to instantly load the full event trajectory and thought process back into the conversation view.
- [x] **Item & Batch Deletion**: Delete individual history items or clear entire history with a single click.
- [x] **Runtime Settings Manager**: Full UI modal to edit `Base URL`, `API Key` (with show/hide mask toggle), and `Model Identifier` (with one-click presets like Nemotron, Sonnet 3.5, GPT-4o, Gemini 2.0 Flash) with auto-persistence to `.env`.
- [x] **In-App Connection Tester**: Test API keys and connectivity directly with live ping checks and feedback badges.

---

## 📥 4. File Download & Export Manager
> **Status: ✅ Completed**
- [x] **Download Interception**: Listen to Electron's `will-download` session events when the agent or user triggers downloads (PDFs, CSVs, invoices, images).
- [x] **Safe Destination Routing**: Automatically route downloads to isolated `Downloads/EDITH/` directory with automatic filename collision resolution and zero blocking OS dialogs.
- [x] **File Path & Size Reporting**: Real-time event notifications (`download`) reporting file path, size, and completion state to both agent context and UI feed.
- [x] **Downloads Drawer UI**: Top bar downloads popover with progress indicators, Open File, and Show in Folder actions.
- [x] **Export Agent Results**: Instant export of agent summaries to `.md`, `.json`, `.csv`, `.txt` via `export_data` tool and one-click UI pills.

---

## 🏠 5. Custom "New Tab" Dashboard
> **Status: ⏳ Pending**
- [ ] **Branded Start Page**: Replace `about:blank` with a clean, modern EDITH start page.
- [ ] **Quick Action Pills**: One-click action shortcuts (e.g. *"Check Cricket Scores"*, *"Trending Tech News"*, *"GitHub Repos"*).
- [ ] **Status & Health Widget**: Live display of configured LLM provider, model latency, and active cookies/sessions.

---

## 💬 6. "Chat with Page" / Instant 1-Click Page Summary
> **Status: ⏳ Pending**
- [ ] **1-Click Summary Action**: Header pill or shortcut to instantly generate structured bullet points and key takeaways from the active tab.
- [ ] **Direct Page Q&A (No Loop Overhead)**: Query the active page content directly (e.g., *"What are the salary and benefits listed on this page?"*) in 1–2 seconds without executing the multi-step agent loop.
- [ ] **Context Window Optimization**: Extract and distill main article/content text while stripping navbars, footers, and sidebars.

---

## 🛡️ 7. Auto Cookie Banner & Overlay Killer
> **Status: ⏳ Pending**
- [ ] **Automated Consent Dismissal**: Automatically detect and click "Accept All", "Reject All", or close buttons on GDPR/cookie consent dialogs.
- [ ] **Overlay & Backdrop Killer**: Remove modal backdrops and newsletter subscription prompts that obstruct coordinate-based clicks.
- [ ] **Built-in Ad & Tracker Blocker**: Integrate `@cliqz/adblocker-electron` into the persistent session to prevent page clutter, popups, and tracker overhead.

---

## 👁️ 8. Multimodal Vision Fallback (CDP Screenshots)
> **Status: ⏳ Pending**
- [ ] **Native Screenshot Capture**: Add a `take_screenshot` tool utilizing Electron's native `wc.capturePage()`.
- [ ] **Multimodal Model Pipeline**: Pass base64 compressed viewport screenshots to multimodal models (Claude 3.5 Sonnet, GPT-4o, Gemini 2.0 Flash) when visual layout inspection is requested.
- [ ] **Canvas & Complex UI Understanding**: Enable the agent to interpret maps, charts, image-based widgets, and visual layouts that the accessibility tree alone cannot represent.

---

## 🎙️ 9. Voice Command Mode ("Hey EDITH" Voice Input Pill)
> **Status: ⏳ Pending**
- [ ] **Microphone Input Pill**: Integrate speech-to-text (Web Speech API or local Whisper) directly into the bottom chat input bar.
- [ ] **Wake-Word / Hotkey Activation**: Trigger voice capture with a keyboard shortcut (e.g., `Ctrl+Space`) or "Hey EDITH" audio cue.
- [ ] **Voice Feedback (TTS)**: Optional audio responses using text-to-speech (ElevenLabs or Gemini Live audio) for an authentic hands-free copilot experience.

---

## 📊 10. 1-Click Web Scraper & Table Extraction to CSV/Sheets
> **Status: ⏳ Pending**
- [ ] **Automatic Table Detection**: Scan the DOM for `<table>` elements, grid lists, or search result cards.
- [ ] **Structured Tabular Parser**: Convert messy HTML tabular data into clean, normalized row/column records.
- [ ] **Direct CSV & Excel Export**: 1-click button to download the parsed table directly into `Downloads/EDITH/<page-title>.csv`.

---

## 📑 11. Multi-Tab Cross-Comparison Matrix
> **Status: ⏳ Pending**
- [ ] **Multi-Tab Context Reading**: Allow EDITH to inspect and extract content from 2 to 5 open tabs simultaneously.
- [ ] **Side-by-Side Comparison Generator**: Synthesize data across tabs into a markdown comparison table (e.g., comparing 3 job offers, 4 product specs, or flight prices).
- [ ] **Tab Selection UI**: Checkbox selector in the copilot panel allowing the user to select which open tabs to include in the comparison.
