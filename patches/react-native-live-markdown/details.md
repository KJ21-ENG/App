# `@expensify/react-native-live-markdown` patches

### [@expensify+react-native-live-markdown+0.1.333+001+remove-parser-cutoff.patch](@expensify+react-native-live-markdown+0.1.333+001+remove-parser-cutoff.patch)

- Reason:

  ```text
  Test implementation for issue #95210. Remove the 4,000-character early return after
  optimizing ExpensiMark's measured autolink hot path so live ranges remain available
  for the full composer value during manual performance testing.
  ```

- Upstream PR/issue: https://github.com/Expensify/App/issues/95210
- E/App issue: https://github.com/Expensify/App/issues/95210
- PR introducing patch: Test branch only
