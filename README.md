# Send to 115 Userscript

Tampermonkey userscript for sending cloud links to 115 offline download.

## Features

- Keeps the native browser/page context menu intact.
- Send the selected or recently right-clicked link/text block through the Tampermonkey menu.
- Supports `magnet:`, `ed2k://`, `http://`, and `https://` links.
- Uses the current browser 115 login session.
- Optional `wp_path_id` configuration for the target 115 folder.
- Keyboard shortcut: `Alt` + `Shift` + `1`.
- Optional random 115 folder per batch, polling completion, and pushing completed files to aria2 RPC.
- Floating panel with settings, recent send history, and resend actions.
- Recent history shows a separate status badge; long links are truncated and available on hover.
- Normal right-click opens the script menu for detected links; `Shift` + right-click keeps the native menu.
- Recent history can manually refresh task status and keeps short diagnostic logs.
- Recent history can manually push detected files to aria2 after refresh.
- The top panel also has a compact `推 aria2` button for the latest tracked history item.
- If 115 reports `文件上传不完整`, pushing waits until the download URL is actually available.
- Debug logs print the 115 download response, parsed direct URL, and aria2 `addUri` request.
- Download URLs are resolved through the 115 Chrome/proapi `app/chrome/downurl` path first, with the older webapi path as fallback.
- Optional Chrome companion extension for the one thing userscripts cannot reliably do: background `proapi.115.com` requests with Chrome's cookie jar.

## Install

Open `send-to-115.user.js` with Tampermonkey, or use the raw GitHub URL after publishing the repository.

Optional bridge extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select the repository's `extension/` folder.
5. Reload the page that uses the userscript.

The extension is intentionally minimal. It does not submit 115 tasks, render UI, or push aria2. It only accepts a userscript bridge request, performs the 115 `app/chrome/downurl` request in the extension background context, and returns the raw JSON response to the userscript for normal handling.

Packaged downloads:

1. Open the repository's `Actions` tab.
2. Run or open the latest `Package` workflow.
3. Download the `send-to-115-package` artifact.
4. Unzip `send-to-115-extension.zip`, then load the unzipped folder in `chrome://extensions`.

## Usage

1. Log in to 115 in the same browser profile.
2. On any page, select text containing links, or right-click a link/text block once.
3. Use the script's right-click menu, or open the Tampermonkey menu and click `发送到 115（按配置）`.
4. To wait for completion and push files to aria2, click `发送到 115，完成后推送 aria2`.
5. Click the collapsed floating `115` button for configuration, recent history, and resend actions.
6. Hold `Shift` while right-clicking to show the page/browser native context menu.

Pure userscripts cannot add a top-level item directly into Chrome's native context menu. This script records the right-clicked content without replacing the native menu, then exposes the send action through Tampermonkey's userscript menu.

## Configuration

Use the floating panel or the Tampermonkey menu command `设置 115 + aria2 配置` to edit JSON settings. `发送到 115（按配置）` follows `pushToAria2`; `仅提交到 115 离线` and `发送到 115，完成后推送 aria2` override it for one run.

```json
{
  "wpPathId": "",
  "createRandomFolder": true,
  "randomFolderParentCid": "",
  "randomFolderPrefix": "aria2",
  "pushToAria2": false,
  "aria2RpcUrl": "http://127.0.0.1:6800/jsonrpc",
  "aria2RpcSecret": "",
  "aria2DownloadDir": "",
  "aria2ExtraOptionsJson": "{}",
  "aria2SendReferer": true,
  "aria2UserAgent": "browser user agent",
  "pollIntervalMs": 30000,
  "pollTimeoutMs": 7200000,
  "stableRounds": 2,
  "includeSubfolders": true,
  "waitOfflineTaskStatus": true,
  "allowZeroSizeFiles": false,
  "useExtensionBridge": true,
  "preferNativeFetchDownurl": true,
  "useBrowserCookieHeader": true,
  "downurlCookieHeader": ""
}
```

Example for your aria2 RPC endpoint:

```json
{
  "wpPathId": "",
  "createRandomFolder": true,
  "randomFolderParentCid": "",
  "randomFolderPrefix": "aria2",
  "pushToAria2": true,
  "aria2RpcUrl": "http://token:admin_aria2@my2.mynas.local.com:11582/jsonrpc",
  "aria2RpcSecret": "",
  "aria2DownloadDir": "",
  "aria2ExtraOptionsJson": "{}",
  "aria2SendReferer": true,
  "aria2UserAgent": "browser user agent",
  "pollIntervalMs": 30000,
  "pollTimeoutMs": 7200000,
  "stableRounds": 2,
  "includeSubfolders": true,
  "waitOfflineTaskStatus": true,
  "allowZeroSizeFiles": false,
  "useExtensionBridge": true,
  "preferNativeFetchDownurl": true,
  "useBrowserCookieHeader": true,
  "downurlCookieHeader": ""
}
```

When `aria2RpcUrl` uses the `http://token:SECRET@host/jsonrpc` shorthand, the script stores it as a normal RPC URL and moves `SECRET` into `aria2RpcSecret`.

Recommended mode:

- Keep `createRandomFolder` as `true`.
- Set `wpPathId` or `randomFolderParentCid` to the parent 115 folder where temporary batch folders should be created.
- Set `aria2RpcUrl`, `aria2RpcSecret`, and `aria2DownloadDir`.
- Use `发送到 115，完成后推送 aria2`.

Non-random mode:

- Set `createRandomFolder` to `false`.
- Set `wpPathId` to the folder that should receive 115 offline files.
- The script snapshots that folder before submitting, then pushes newly appeared files after the directory becomes stable.

Completion detection:

- With `waitOfflineTaskStatus: true`, the script first polls 115 offline tasks via `ct=lixian&ac=task_lists`.
- It matches tasks by returned task id/hash/url first, then by the random folder id/name.
- After all matched tasks look complete, it scans the target folder and pushes the newly appeared files to aria2.
- If task matching is unavailable for three polls, it falls back to directory stability polling.

## Notes

This script calls 115 web endpoints with your existing login cookies:

- `https://115.com/?ct=offline&ac=space`
- `https://webapi.115.com/offine/downpath`
- `https://webapi.115.com/files/add`
- `https://webapi.115.com/files`
- `https://webapi.115.com/files/download`
- `https://proapi.115.com/app/chrome/downurl`
- `https://115.com/web/lixian/?ct=lixian&ac=add_task_urls`
- `https://115.com/web/lixian/?ct=lixian&ac=task_lists`

These are web-side endpoints and may change if 115 changes its site.

When the bridge extension is installed and `useExtensionBridge` is `true`, successful bridge communication prints:

```text
[Send to 115 JSON] 115 extension bridge response ...
[Send to 115 JSON] 115 extensionDownurl decoded ...
```

If the extension is not installed or unavailable, the userscript falls back to native fetch, GM requests, and finally the older webapi path.

## License

MIT
