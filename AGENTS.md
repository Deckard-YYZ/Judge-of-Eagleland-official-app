## 

## Avoid Unnecessary Defensive Programming and Hash Checks

- Do not add speculative defensive code. Trust established internal contracts and engine guarantees; avoid redundant null checks, validation, and fallbacks, retries, or compatibility branches without a concrete need. When an internal contract is violated, expose the error and fix its root cause rather than hiding it with silent returns, default values, or swallowed exceptions. Retain necessary handling for external input and genuinely expected failures.
- Do not make SHA or other hash checks a default part of routine development. Do not routinely compute, record, or repeatedly compare hashes of source files, assets, build outputs, or internal objects, or generate additional checksum manifests. Use them only when explicitly required by the task, relied on by an existing workflow, or needed to investigate a specific integrity issue. For ordinary change review, use Git diffs where available and relevant validation.
