# Edge Command Panel

A TypeScript Microsoft Edge extension that opens a VS Code-like command panel on the current webpage. It searches custom URL mappings, recent tabs, bookmark bar items, and built-in commands.

## Install for local development

1. Install [Node.js](https://nodejs.org/) 20 or newer.
2. Run `npm install`.
3. Run `npm run build`.
4. Open `edge://extensions`.
5. Enable **Developer mode**.
6. Click **Load unpacked**.
7. Select the generated `dist` folder, not the repository root.

After changing TypeScript or static assets, run `npm run build` again and reload the extension from `edge://extensions`. Run `npm run check` when you only need strict TypeScript validation.

## Automated releases

Every push to `main` runs the GitHub Actions workflow in `.github/workflows/release.yml`. After type-checking and building, it packages `dist` as a ZIP and publishes it directly to GitHub Releases as a pre-release. Tags use `v<manifest-version>-build.<run-number>.<run-attempt>`, so rerunning a workflow cannot overwrite an earlier release.

## Usage

- Press `Ctrl+Shift+P` on Windows/Linux or `Command+Shift+P` on macOS to open or close the panel.
- You can also click the extension icon in the toolbar to open or close the panel.
- The top section shows the 8 most recently active tabs in the current window, while search can still find any other non-current tab in that window.
- The bottom section shows items from the bookmark bar.
- Type part of a title, URL, bookmark folder path, pinyin, or pinyin initials to filter both sections. Separate multiple keywords with spaces (for example, `github issue`); results matching more keywords rank higher. Pinyin search is powered by vendored `pinyin-pro`.
- Search results rank by the number of matched keywords first. With equal keyword coverage, bookmark title matches rank before URL matches, then bookmark folder path matches.
- When a bookmark matches, an open tab in the current window with the same URL path is also shown, including the current tab. Query parameters, URL fragments, `http`/`https` differences, and trailing path slashes are ignored for this comparison.
- Type `theme`, `light`, `dark`, `明亮`, `暗黑`, or related pinyin to show built-in theme commands.
- Type `newtab`, `copy`, `duplicate tab`, `close tab`, `reload`, `新建标签页`, `复制当前标签页`, `关闭标签页`, `重新加载窗口`, or related pinyin to show tab management commands.
- Type `ask` to enter Ask mode, or type `ask <question>` to send a question immediately using the current page's visible text. Answers render GitHub-flavored Markdown. Configure the OpenAI-compatible endpoint, model, and API key from the extension's **Options** page first.
- Enter an `http://`, `https://`, `edge://`, or `chrome://` URL, or a bare domain such as `example.com/path`, to show a bottom action that navigates the current tab directly to that URL (for example, `edge://extensions` or `chrome://extensions`).
- The extension checks the latest published GitHub release (including pre-releases) every six hours. When local extension files differ from that release, the toolbar icon shows an `UP` badge and the command panel shows an update item linking to the release.
- Type `help`, `帮助`, `内置命令`, or related pinyin to show all built-in commands.
- Type `mapping`, `映射`, or `设置` and run **Settings: Manage URL Mappings** to add, edit, or delete custom input-to-URL shortcuts. You can also open the extension's **Options** page from `edge://extensions`.
- A custom mapping is shown above other result types. An exact input match ranks first, so pressing `Enter` opens its URL in a new active tab.
- Press `ArrowDown` or `ArrowUp` to move through results.
- Press `Enter` to activate the selected tab, open the selected bookmark, run a command, or navigate to the entered URL.
- Press `Escape` or click outside the panel to close it.

The shortcut can be changed from `edge://extensions/shortcuts`.

If the shortcut does nothing, open `edge://extensions/shortcuts` and confirm **Edge Command Panel** has an assigned shortcut. Browsers may leave a shortcut blank when it conflicts with another browser or extension shortcut.

## Browser page limitations

The overlay is injected only into normal `http://` and `https://` pages. Browser-internal pages such as `edge://`, `chrome://`, extension pages, the Edge Add-ons store, and some restricted pages do not allow this kind of content script injection, so the panel will not appear there.

## Ask AI privacy and configuration

Open the extension details page in `edge://extensions`, then select **Extension options**. The default provider is OpenAI with model `gpt-5.4-mini`, and both the API base URL and model can be changed for another OpenAI-compatible service. HTTPS endpoints are required, except for `localhost` and `127.0.0.1` development services.

The API key is stored in `chrome.storage.local` in the current browser profile and is never added to the source bundle. The extension sends the page title, URL, and an excerpt of visible page text only after you submit an Ask question. It does not read form field values. For centrally distributed or production extensions, use a trusted backend relay instead of storing a shared provider key in the extension.

## Project structure

- `manifest.json` declares the Manifest V3 extension, permissions, shortcut, compiled background service worker, and compiled content script.
- `src/messages.ts` defines the shared, validated message protocol and data models used across extension contexts.
- `src/background.ts` handles the keyboard command, reads tabs, bookmarks, and URL mappings, resolves favicons, persists settings, and opens URLs.
- `src/content.ts` renders command-panel sections, manages search and keyboard navigation, extracts visible page text, and displays Ask answers.
- `src/ai-settings.ts` validates and normalizes the shared AI provider configuration.
- `src/url-mappings.ts` validates and normalizes persistent custom URL mappings.
- `src/options.ts`, `src/options.html`, and `src/options.css` provide the AI provider and URL mapping settings page.
- `src/pinyin.ts` provides a typed wrapper around the vendored `pinyin-pro` library for full-pinyin and pinyin-initial search indexing.
- `src/vendor/pinyin-pro.js` is the MIT-licensed browser build of `pinyin-pro`.
- `src/panel.css` styles the overlay.
- `scripts/build.mjs` bundles TypeScript entry points and copies the extension's static and update-tracking assets into `dist`.
- `config/update-tracked-files.json` is the single source of truth for files copied into the build and compared by the release update check.
- `dist` is generated by `npm run build` and is the directory loaded by Edge.
