# Edge Command Panel

A dependency-free Microsoft Edge extension that opens a VS Code-like command panel on the current webpage. It shows recent tabs and bookmark bar items together in two visual sections: tabs on top, bookmarks below.

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
- Type part of a title, URL, or bookmark folder path to filter both sections.
- Press `ArrowDown` or `ArrowUp` to move through results.
- Press `Enter` to activate the selected tab or open the selected bookmark in a new active tab.
- Press `Escape` or click outside the panel to close it.

The shortcut can be changed from `edge://extensions/shortcuts`.

If the shortcut does nothing, open `edge://extensions/shortcuts` and confirm **Edge Command Panel** has an assigned shortcut. Browsers may leave a shortcut blank when it conflicts with another browser or extension shortcut.

## Browser page limitations

The overlay is injected only into normal `http://` and `https://` pages. Browser-internal pages such as `edge://`, `chrome://`, extension pages, the Edge Add-ons store, and some restricted pages do not allow this kind of content script injection, so the panel will not appear there.

## Project structure

- `manifest.json` declares the Manifest V3 extension, permissions, shortcut, background service worker, and content script.
- `src/background.js` handles the keyboard command, reads recent tabs and bookmark bar items, activates tabs, and opens bookmarks.
- `src/content.js` renders the command panel sections and manages search, keyboard navigation, and selection.
- `src/panel.css` styles the overlay.
