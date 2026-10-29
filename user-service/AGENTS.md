# User Service documentation workflow

- Before each authorized User Service commit or push, review the pending changes against the README, contract notes, OpenAPI, database schema guide and existing architecture/schema diagrams. Update affected documentation to match behavior; report no-impact cases without adding unnecessary diagrams or files.
- Use a concurrent documentation agent when available. Give it explicit, disjoint file write ownership; keep application, tests, executable schema and unrelated services with the implementation agent. Reconcile and review its edits before committing or pushing.
- Distinguish repository configuration and test results from proven live behavior. Report checks performed, remaining assumptions and unverified integration/load acceptance; never copy real credentials or personal details into docs.
- Commits, pushes, PR creation/updates and merges require user authority for the respective action. A documentation review does not itself authorize them.
- This is an instruction for future active sessions, not persistent background automation. Do not claim that an agent keeps running after the session ends.
