# Retention matrix

What is kept, where, for how long, and what deletes it. Decisions referenced are in [decisions.md](decisions.md).

| Data | Where | Kept | Removed by | Decision |
| --- | --- | --- | --- | --- |
| Chats and messages | Mongo `conversations`, `messages` | 90 days after last activity | TTL on `expiredAt` (`interface.generalChatRetention`); user delete removes at once | #1 |
| Temporary chats | Mongo | 24 hours | TTL (`temporaryChatRetention`) | #1 |
| Search index | Meilisearch | Mirrors Mongo | LibreChat removes entries on delete; removal after TTL expiry is checked by the go-live `deletion` spec (if it fails, schedule a re-sync); rebuilt from Mongo after a restore | |
| Uploaded files | `server/uploads`, Mongo `files` | With their chat; agent files kept | Delete with the chat or by the user (`retainAgentFiles: true`) | #1 |
| File embeddings | pgvector | With the file | Deleted with the file | |
| Memories | none | Off | | #2 |
| Transactions (spend) | Mongo `transactions` | 13 months | Monthly purge (`bin/spend-report.sh`, `KEEP_MONTHS`) | #3 |
| Spend reports | S3 `reports/` | Bucket lifecycle (Object Lock 30 days) | | #3 |
| Approved actions | `auditdb.approved_actions` + S3 `audit/` | 7 years (Object Lock per object) | Nothing: append-only | #11 |
| Backups | S3 `restic/` | 14 daily, 8 weekly, 12 monthly, 5 pre-update; Object Lock 30 days | `restic forget --prune` nightly | #18 |
| EBS snapshots | AWS | 7 daily | DLM | |
| LibreChat logs | CloudWatch `/pressroom/librechat` | 90 days | Log group retention | #19 |
| Container logs | CloudWatch `/pressroom/containers` | 30 days | Log group retention | #19 |
| Voice transcripts, Relevance runs | ElevenLabs, Relevance (vendor side) | Vendor's retention | Vendor settings; the gateways keep nothing | #14 |
| Read-aloud text, dictated audio | ElevenLabs, OpenAI (in transit) | Vendor's API retention | | #15 |
