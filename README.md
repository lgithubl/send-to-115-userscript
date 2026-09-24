# Send to 115 Userscript

Tampermonkey userscript for sending cloud links to 115 offline download.

## Features

- Keeps the native browser/page context menu intact.
- Send the selected or recently right-clicked link/text block through the Tampermonkey menu.
- Supports `magnet:`, `ed2k://`, `http://`, and `https://` links.
- Uses the current browser 115 login session.
- Optional `wp_path_id` configuration for the target 115 folder.
- Keyboard shortcut: `Alt` + `Shift` + `1`.

## Install

Open `send-to-115.user.js` with Tampermonkey, or use the raw GitHub URL after publishing the repository.

## Usage

1. Log in to 115 in the same browser profile.
2. On any page, select text containing links, or right-click a link/text block once.
3. Open the Tampermonkey menu and click `发送到 115（选中/最近右键内容）`.

Pure userscripts cannot add a top-level item directly into Chrome's native context menu. This script records the right-clicked content without replacing the native menu, then exposes the send action through Tampermonkey's userscript menu.

## Notes

This script calls 115 web endpoints with your existing login cookies:

- `https://115.com/?ct=offline&ac=space`
- `https://webapi.115.com/offine/downpath`
- `https://115.com/web/lixian/?ct=lixian&ac=add_task_urls`

These are web-side endpoints and may change if 115 changes its site.

## License

MIT
