# Edge Command Panel

A no-build Microsoft Edge extension that opens a VS Code-like command panel on the current webpage. It shows recent tabs and bookmark bar items together in two visual sections: tabs on top, bookmarks below.

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
- Type part of a title, URL, bookmark folder path, pinyin, or pinyin initials to filter both sections. Separate multiple keywords with spaces (for example, `github issue`); results matching more keywords rank higher. Pinyin search is powered by vendored `pinyin-pro`.
- Search results rank by the number of matched keywords first. With equal keyword coverage, bookmark title matches rank before URL matches, then bookmark folder path matches.
- When a bookmark matches, an open tab in the current window with the same URL path is also shown, including the current tab. Query parameters, URL fragments, `http`/`https` differences, and trailing path slashes are ignored for this comparison.
- Type `theme`, `light`, `dark`, `明亮`, `暗黑`, or related pinyin to show built-in theme commands.
- Type `newtab`, `copy`, `duplicate tab`, `close tab`, `reload`, `新建标签页`, `复制当前标签页`, `关闭标签页`, `重新加载窗口`, or related pinyin to show tab management commands.
- Enter an `http://`, `https://`, `edge://`, or `chrome://` URL, or a bare domain such as `example.com/path`, to show a bottom action that navigates the current tab directly to that URL (for example, `edge://extensions` or `chrome://extensions`).
- Type `help`, `帮助`, `内置命令`, or related pinyin to show all built-in commands.
- Press `ArrowDown` or `ArrowUp` to move through results.
- Press `Enter` to activate the selected tab, open the selected bookmark, run a command, or navigate to the entered URL.
- Press `Escape` or click outside the panel to close it.

The shortcut can be changed from `edge://extensions/shortcuts`.

If the shortcut does nothing, open `edge://extensions/shortcuts` and confirm **Edge Command Panel** has an assigned shortcut. Browsers may leave a shortcut blank when it conflicts with another browser or extension shortcut.

## Browser page limitations

The overlay is injected only into normal `http://` and `https://` pages. Browser-internal pages such as `edge://`, `chrome://`, extension pages, the Edge Add-ons store, and some restricted pages do not allow this kind of content script injection, so the panel will not appear there.

## Project structure

- `manifest.json` declares the Manifest V3 extension, permissions, shortcut, background service worker, and content script.
- `src/background.js` handles the keyboard command, reads recent tabs and bookmark bar items, resolves favicons, persists the theme, activates tabs, and opens bookmarks.
- `src/content.js` renders the command panel sections and manages search, keyboard navigation, and selection.
- `src/pinyin.js` wraps the vendored `pinyin-pro` library for full-pinyin and pinyin-initial search indexing.
- `src/vendor/pinyin-pro.js` is the MIT-licensed browser build of `pinyin-pro`.
- `src/panel.css` styles the overlay.
