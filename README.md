# Send to 115 Userscript

Tampermonkey userscript for sending cloud links to 115 offline download.

## Features

- Right-click a selected link/text block and send detected links to 115.
- Supports `magnet:`, `ed2k://`, `http://`, and `https://` links.
- Uses the current browser 115 login session.
- Optional `wp_path_id` configuration for the target 115 folder.
- Tampermonkey menu fallback for the last right-clicked content or current selection.

## Install

Open `send-to-115.user.js` with Tampermonkey, or use the raw GitHub URL after publishing the repository.

## Usage

1. Log in to 115 in the same browser profile.
2. On any page, select text containing links, then right-click.
3. Click `发送到 115`.

If the page's native context menu is needed, right-click an area without recognized links.

## Notes

This script calls 115 web endpoints with your existing login cookies:

- `https://115.com/?ct=offline&ac=space`
- `https://webapi.115.com/offine/downpath`
- `https://115.com/web/lixian/?ct=lixian&ac=add_task_urls`

These are web-side endpoints and may change if 115 changes its site.

## License

MIT
