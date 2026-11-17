# Handover pack

| Item | Where |
| --- | --- |
| Go-live test report | `tests/golive/reports/golive-<time>.md` from `npm run golive -- run` (see [tests/golive/README.md](../tests/golive/README.md)); attach screenshots for the MANUAL rows |
| Architecture | [architecture.md](architecture.md) |
| Retention matrix | [retention.md](retention.md) |
| Client decisions | [decisions.md](decisions.md) |
| Microsoft setup | [entra-setup.md](entra-setup.md) |
| Runbooks | [runbooks/](runbooks/): deploy from zero, models and spend, Microsoft connections, Pace and approved actions, Relevance/voice/egress, portal embed, backup and restore, update, monitoring, day-2 |
| Training guides | [training/](training/) |
| Permission matrix for their Pace connector | [tests/pace-permissions](../tests/pace-permissions/README.md) |

## Sign-off checklist

1. `npm run golive -- run` with no FAIL rows; every MANUAL row has a screenshot or query output.
2. Restore drill done; RTO and data age written in the report.
3. Offboarding and connector revocation windows written into `runbooks/day-2.md`.
4. Every decision in `decisions.md` answered by the client.
5. Clean-up: delete `tests/golive/.auth/`, the PressRoom-GoLive app registration, and any Azure CLI authorized client added for the Pace matrix.
