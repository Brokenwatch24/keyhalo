# `src/core/community` — public API

Services behind the **Community** page: the GitHub catalog (gallery), install/uninstall,
GitHub sign-in, publishing (fork → PR), gist sharing/import, deep links and device reports.
Import everything from `@/core/community` (the barrel `index.ts`), never from internal files.

Strings live in `src/i18n/{en,es}/community.json` (namespace `community.*`).

## Store: `useCommunity`

```ts
import { useCommunity, useCatalogResults, communityErrorMessage } from "@/core/community";
```

| State | Type | Notes |
|---|---|---|
| `index` | `CatalogIndex \| null` | Current catalog |
| `source` | `"network" \| "cache" \| "bundled" \| "runtime" \| null` | Where it came from (show "offline" for bundled/runtime, "saved copy from {date}" for cache) |
| `fetchedAt` | `string?` | ISO date of the last successful download |
| `loading` | `boolean` | Refresh in progress |
| `error` | `CommunityError \| null` | Last catalog error; the index may still be usable. Show with `communityErrorMessage(error)` |
| `filters` | `CatalogFilters` | `{ query, kinds, tags, compatibleOnly, app?, installed?: "only"\|"hide", sort: "relevance"\|"updated"\|"name" }` |
| `installed` | `Record<"kind:id", InstalledItem>` | Installed items (name, version, updated, installedAt, origin, confirmedRisky) |
| `busy` | `Record<"kind:id", true>` | Install/uninstall in progress — disable the button |
| `auth` | `{status:"signedOut", error?} \| {status:"pending", code: DeviceCodeInfo} \| {status:"signedIn", login}` | GitHub session |
| `pendingImport` | `InstallPreview \| null` | Item opened from a deep link / `?import=`, waiting for the user's review |
| `pendingImportError` | `CommunityError \| null` | Deep link that couldn't be resolved |

| Action | Notes |
|---|---|
| `refresh({ force? })` | Cache → network (skipped if the cache is < 6 h old unless `force`) → bundled index → index built from bundled files. Never throws. Call with `force: true` from the refresh button. Startup calls it automatically. |
| `setFilters(patch)`, `resetFilters()` | |
| `findEntry(kind, id)`, `isInstalled(kind, id)`, `hasUpdate(kind, id)`, `updates()` | `hasUpdate` = catalog `updated` newer than the installed copy |
| `prepareInstall(entry)` → `InstallPreview` | Downloads (falls back to the bundled copy offline) and checks the item. **Show the preview** before installing. |
| `install(preview, { confirmRisky })` → `InstalledItem` | Throws `CommunityError("needsConfirmation")` when `preview.requiresConfirmation` and `confirmRisky` isn't `true`. Saves `installed/<kind>/<id>.json` (`.js` for effects) and emits `community:installed`. |
| `installEntry(entry, { confirmRisky })` | `prepareInstall` + `install`. Use for "Update" (same rules). |
| `uninstall(kind, id)` | Deletes the file and emits `community:removed` |
| `readInstalled(kind, id)` | Parsed JSON, or the source string for effects |
| `importFrom(input)` → `InstallPreview` | Gist URL/id, `gist.githubusercontent.com` raw URL, any https `.json`/`.js` URL, `keyhalo://` link, or pasted JSON/JS. Nothing is installed until you call `install`. |
| `handleDeepLink(link)` | Resolves into `pendingImport` / `pendingImportError` and navigates to `#/community`. Called automatically for backend `deep-link` events and the browser `?import=` param. |
| `clearPendingImport()` | After the user dismisses the review dialog (`install()` clears it on success) |
| `shareGist(kind, data, { public? })` → `{ gistId, gistUrl, deepLink, rawUrl? }` | Needs sign-in. `deepLink` = `keyhalo://import?gist=<id>` |
| `publish(req)` → `{ prUrl, prNumber, branch, path }` | Needs sign-in. `req = { kind, data, previewDataUrl?, testedOn?: string[], notes?, appVersion?, onProgress?(step) }`, steps `"fork" → "branch" → "commit" → "pr"` (labels: `community.share.steps.*`). Signs out automatically on 401. |
| `canUseDeviceFlow()` | `false` when no OAuth client id is configured → show only the token option |
| `signIn()` → `DeviceCodeInfo` | Starts the device flow. Show `userCode`, open `verificationUri` (`backend.openPath`). `auth` moves `pending → signedIn` (or `signedOut` with `error`) on its own. In the browser demo it fails with `deviceFlowUnavailable` (github.com/login has no CORS) — offer the token. |
| `cancelSignIn()`, `signInWithToken(token)`, `signOut()` | The token and login are stored in `settings.github` |

`useCatalogResults()` is a hook that returns the filtered, sorted entries. It re-renders when the
filters, the index, installed items or connected devices change (for "Works with my devices").

### `InstallPreview`

```ts
{ kind, id, name, data, version?, entry?, origin: { type: "catalog"|"gist"|"url"|"paste"|"deeplink", ref? },
  risky: { type: "launch"|"text"|"macro"|"http"; where: string; detail: string }[],
  sandboxed: boolean,            // true for effects → show community.review.sandboxed
  requiresConfirmation: boolean } // true when risky.length > 0
```

The review dialog should list `risky` (labels `community.review.<type>`, `community.review.where`)
and pass `{ confirmRisky: true }` only after an explicit click on `community.review.confirm`.
For effects, always show `community.review.sandboxed`. For anything else, show `community.review.safe`.

## Helpers

| Export | Use |
|---|---|
| `filterCatalog(entries, filters, ctx)`, `scoreEntry`, `isCompatible`, `catalogTags(entries)`, `catalogApps(entries)`, `countByKind(entries)` | Filter chips and counts |
| `rawUrl(path)` | URL of a repo file (entry `preview` images, "View raw") |
| `installDeepLink(kind, id)` | "Copy install link" |
| `parseDeepLink(link)`, `parseImportInput(text)` | Validate before calling the store |
| `deviceReportUrl(connectedDevice)` | Prefilled "Works on my device" issue. Open it with `backend.openPath` |
| `deviceRequestUrl(hidInfo \| hidInfo[])` | Prefilled support request for an unknown HID device |
| `riskyActions(pack)`, `checkContent(kind, data)`, `detectKind(data, filename?)` | Validation used by the publish dialog before sending |
| `repoPathFor(kind, id, data)`, `serialize(kind, data)` | Shows where a published file will go (`community/devices/<vendor>/<id>.json`…) |
| `CommunityError`, `communityErrorMessage(e)`, `isCommunityError(e)` | Every service throws `CommunityError` with a `code` that maps to `community.errors.<code>` |
| `REPO`, `REPO_URL`, `SITE_URL`, `KIND_INFO`, `CATALOG_KINDS` | Constants |

## Bus contract (for feature owners)

* `community:installed { kind, id, data }`: emitted on install, and again at startup for every installed
  item. Community init runs **last** in `src/core/init.ts`, so listeners registered in your feature's
  `init()` will receive these events. For effects, `data` is the **module source string**: run it
  sandboxed. For everything else it's the parsed JSON (`DeviceDefinition`, `Profile`, `KeymapPack`,
  `TypingPack`).
* `community:removed { kind, id }`: unregister the item.
* Installed keymap packs with risky actions were confirmed at install time (`InstalledItem.confirmedRisky`).
  Keymaps should still start disabled.

## Storage

| Name | Content |
|---|---|
| `installed/<kind>/<id>.json` (`.js`) | Installed item |
| `community/installed.json` | Registry (`InstalledItem` by `"kind:id"`) |
| `community/index-cache.json` | `{ index, fetchedAt }` |
| `settings.json → github` | `{ token?, user?, clientId? }`: the token is stored in plain text in the app data folder (see SECURITY.md) |

## Configuration

* OAuth device flow needs a GitHub OAuth App with "Device flow" enabled. Set its client id with
  `VITE_GITHUB_CLIENT_ID` at build time, or `settings.github.clientId` at runtime. No client secret is needed.
* Without a client id, users can paste a token. A classic PAT with `public_repo` + `gist` is best. A fine-grained
  token can create gists, but it may not be able to open PRs on repos the user doesn't own.
