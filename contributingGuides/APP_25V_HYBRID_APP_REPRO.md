# APP-25V HybridApp iOS Repro Ground

This runbook is for https://github.com/Expensify/App/issues/92412.

APP-25V is a native iOS HybridApp crash in React Native's modern runtime scheduler. The goal is to exercise real HybridApp entry, render pressure, app-state changes, and teardown flows while collecting breadcrumbs. Do not use this runbook as a forced native race harness.

## What This Proves

- A crash during these flows is useful evidence that the real app can enter the APP-25V timing window.
- The added breadcrumbs show whether the crash happened near OldDot-to-NewDot initialization, NewDot close, or background/foreground transitions.
- A clean run does not disprove the issue. The Sentry tracker describes this as a low-frequency native crash with no deterministic reproduction.

## Required Build

Use iOS HybridApp. Standalone NewDot is not enough for this issue.

The `Mobile-Expensify` submodule must be present. From the App repo root:

```bash
git submodule update --init Mobile-Expensify
npm install
npm run pod-install
npm run start
npm run ios
```

When the submodule is present, `npm run ios` builds HybridApp. If the submodule is empty, `npm run ios-standalone` or the root `ios/` app cannot validate APP-25V.

## Capture Logs

Use device or simulator logs and filter for the repro breadcrumbs:

```bash
xcrun simctl spawn booted log stream --style compact --level debug --predicate 'eventMessage CONTAINS "APP-25V" OR eventMessage CONTAINS "HybridApp" OR eventMessage CONTAINS "RuntimeScheduler"'
```

If Sentry debug is enabled in the app, the breadcrumbs use category `hybrid_app.lifecycle` and message prefix `[APP-25V]`.

## Real-Flow Stress Passes

Repeat each pass 20-50 times if practical. Vary the speed: normal pace first, then fast repeated interactions.

### Pass 1: OldDot to NewDot to Classic

1. Start in OldDot.
2. Enter NewDot through the normal HybridApp transition.
3. Open several reports or chats.
4. Scroll the report action list quickly.
5. Open and close menus that trigger Fabric renders.
6. Go to Settings and switch back to Classic.

Expected useful breadcrumbs:

- `[APP-25V] HybridAppHandler requesting settings`
- `[APP-25V] HybridAppHandler settings received`
- `[APP-25V] finalizeTransitionFromOldDot starting`
- `[APP-25V] closeReactNativeApp requested`
- `[APP-25V] closeReactNativeApp setting closingReactNativeApp Onyx flag`
- `[APP-25V] closeReactNativeApp calling native HybridApp close`

### Pass 2: Teardown With AppState Changes

1. Start in OldDot.
2. Enter NewDot.
3. Navigate between reports or settings pages.
4. Background the app.
5. Foreground the app.
6. Immediately switch back to Classic.

Expected useful breadcrumbs:

- `[APP-25V] AppState changed`
- close breadcrumbs from Pass 1

### Pass 3: Alternate Close Entry Points

Run any close paths available to the test account:

- Settings -> Switch to Classic
- Troubleshoot -> Switch to Classic
- single-entry back action
- GPS-in-progress confirmation path
- 2FA success or merge-account success close path

The point is not to invent a new state. It is to use real close paths that can naturally leave pending render work while HybridApp tears down NewDot.

## Evidence to Save

For a crash:

- Crash log or Sentry event URL.
- App release/build type.
- Device or simulator model and iOS version.
- The last 20-30 `APP-25V` or `HybridApp` log lines before the crash.
- Which pass and close entry point was being repeated.

For a non-crash:

- Number of iterations.
- Device or simulator model and iOS version.
- Which passes were run.
- Whether breadcrumbs appeared around entry, AppState changes, and close.

## Reviewer-Facing Boundary

Use this wording if the stress passes do not crash:

```md
I could not produce a deterministic local crash video. The issue body also lists reproduction as unknown and points to Sentry APP-25V.

I tested the closest real HybridApp flows instead: OldDot -> NewDot transition, render-heavy NewDot navigation, background/foreground, and return-to-Classic close paths with APP-25V breadcrumbs around NewDot init, AppState changes, and native close. These are stress steps for the same timing window described in the proposal, not a forced native race harness.
```
