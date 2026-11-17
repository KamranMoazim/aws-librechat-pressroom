# Client decisions

Defaults this build ships with, and what the client needs to confirm.

| # | Topic | Default here | Why it needs a decision |
| --- | --- | --- | --- |
| 1 | Chat retention | All data, 90 days after last activity; temporary chats 24 h; agent files kept | Their records policy |
| 2 | Memories | Off (`memory.disabled`, `interface.memories: false`) | Memories never expire under any retention mode |
| 3 | Transactions | Kept 13 months, then purged monthly | Spend reports need a year of history |
| 4 | Code Interpreter | Off (capability removed) | Sends code and files to a separate service |
| 5 | Web search | Off | Needs an approved search provider |
| 6 | Agent actions (OpenAPI) | Off | Would let users call arbitrary APIs |
| 7 | Artifact previews | React previews use our bundler; HTML, SVG and Markdown previews and Tailwind still load from public CDNs in the browser | Add the CDNs to the proxy allowlist or accept |
| 8 | Per-person limit | $20 per month, refilled to $20 (no rollover) | Budget per person and who gets more |
| 9 | Shared links | Inside the company only (`public: false`) | Whether anyone outside may open a shared chat |
| 10 | Models | Claude Sonnet 5.5, Claude Opus 5.5, GPT-6 Sol, Grok 4.7 | Which models are approved |
