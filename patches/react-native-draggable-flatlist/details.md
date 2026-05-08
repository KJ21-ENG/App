# `react-native-draggable-flatlist` patches

### [react-native-draggable-flatlist+4.0.3+001+listfooter-constraint.patch](react-native-draggable-flatlist+4.0.3+001+listfooter-constraint.patch)

- Reason: Ensures items can't be dragged into the list footer by accounting for its height when constraining drag bounds.
- Upstream PR/issue: https://github.com/computerjazz/react-native-draggable-flatlist/pull/592
- E/App issue: 🛑
- PR Introducing Patch: [#61380](https://github.com/Expensify/App/pull/61380)


### [react-native-draggable-flatlist+4.0.3+002+fix-console-error-ref-measureLayout.patch](react-native-draggable-flatlist+4.0.3+002+fix-console-error-ref-measureLayout.patch)

- Reason: Prevents console warning when adding a new item due to incorrect `ref.measureLayout` call.
- Upstream PR/issue: https://github.com/computerjazz/react-native-draggable-flatlist/pull/544
- E/App issue: 🛑
- PR Introducing Patch: [#55066](https://github.com/Expensify/App/pull/55066)


### [react-native-draggable-flatlist+4.0.3+003+fix-ios-autoscroll-feedback.patch](react-native-draggable-flatlist+4.0.3+003+fix-ios-autoscroll-feedback.patch)

- Reason: Fixes iOS draggable list autoscroll stalling at the edge during a drag. Animated `scrollToOffset` leaves `scrollOffset` behind `scrollTarget` until the animation completes, breaking `useAutoScroll`'s feedback loop. Switching iOS to `animated: false` lets `onScroll`/`scrollOffset` catch up so the next autoscroll iteration can fire while the finger is still at the edge. Android keeps the animated path.
- Upstream PR/issue: 🛑
- E/App issue: [#87362](https://github.com/Expensify/App/issues/87362)
- PR Introducing Patch: 🛑
