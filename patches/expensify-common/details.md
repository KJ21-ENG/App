# `expensify-common` patches

### [expensify-common+2.0.195+001+optimize-autolink-candidates.patch](expensify-common+2.0.195+001+optimize-autolink-candidates.patch)

- Reason:

  ```text
  Test implementation for issue #95210. It keeps the existing URL matcher authoritative,
  but runs it only on whitespace-bounded URL candidates found outside protected HTML.
  This avoids applying the expensive autolink regex to an entire long composer value.
  ```

- Upstream PR/issue: https://github.com/Expensify/App/issues/95210
- E/App issue: https://github.com/Expensify/App/issues/95210
- PR introducing patch: Test branch only
