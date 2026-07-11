# Edge Command Panel

A no-build Microsoft Edge extension that opens a VS Code-like command panel on the current webpage. It searches custom URL mappings, recent tabs, bookmark bar items, and built-in commands.

## Install for local development

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.

## Usage

- Press `Ctrl+Shift+P` on Windows/Linux or `Command+Shift+P` on macOS to open or close the panel.
- You can also click the extension icon in the toolbar to open or close the panel.
- The top section shows the 8 most recently active tabs in the current window, while search can still find any other non-current tab in that window.
- The bottom section shows items from the bookmark bar.
- Type part of a title, URL, bookmark folder path, pinyin, or pinyin initials to filter both sections. Pinyin search is powered by vendored `pinyin-pro`.
- Bookmark searches rank title matches before URL matches, then bookmark folder path matches.
- Type `theme`, `light`, `dark`, `明亮`, `暗黑`, or related pinyin to show built-in theme commands.
- Type `newtab`, `new tab`, `close tab`, `reload`, `新建标签页`, `关闭标签页`, `重新加载窗口`, or related pinyin to show tab management commands.
- Type `help`, `帮助`, `内置命令`, or related pinyin to show all built-in commands.
- Type `mapping`, `映射`, or `设置` and run **Settings: Manage URL Mappings** to add, edit, or delete custom input-to-URL shortcuts. You can also open the extension's **Options** page from `edge://extensions`.
- A custom mapping is shown above other result types. An exact input match ranks first, so pressing `Enter` opens its URL in a new active tab.
- Press `ArrowDown` or `ArrowUp` to move through results.
- Press `Enter` to activate the selected tab, open the selected bookmark in a new active tab, or run the selected built-in command.
- Press `Escape` or click outside the panel to close it.

The shortcut can be changed from `edge://extensions/shortcuts`.

If the shortcut does nothing, open `edge://extensions/shortcuts` and confirm **Edge Command Panel** has an assigned shortcut. Browsers may leave a shortcut blank when it conflicts with another browser or extension shortcut.

## Browser page limitations

The overlay is injected only into normal `http://` and `https://` pages. Browser-internal pages such as `edge://`, `chrome://`, extension pages, the Edge Add-ons store, and some restricted pages do not allow this kind of content script injection, so the panel will not appear there.

## Project structure

- `manifest.json` declares the Manifest V3 extension, permissions, shortcut, background service worker, and content script.
- `src/background.js` handles the keyboard command, reads tabs, bookmarks, and URL mappings, persists settings, activates tabs, and opens URLs.
- `src/content.js` renders the command panel sections and manages search, keyboard navigation, and selection.
- `options/` provides the settings page for persistent custom URL mappings.
- `src/pinyin.js` wraps the vendored `pinyin-pro` library for full-pinyin and pinyin-initial search indexing.
- `src/vendor/pinyin-pro.js` is the MIT-licensed browser build of `pinyin-pro`.
- `src/panel.css` styles the overlay.
