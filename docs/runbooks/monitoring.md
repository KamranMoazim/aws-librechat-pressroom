# Monitoring and alerts

Alarms email IT through the SNS topic `pressroom-alerts` (address: `ALERT_EMAIL` in `infra/.env`; confirm the subscription email after the first deploy). Each alarm also emails when it clears.

| Alarm | Fires when | First thing to look at |
| --- | --- | --- |
| `pressroom-disk` | Root disk over 80% for 10 min | `sudo du -sh /opt/pressroom/server/* /var/lib/docker`; old images: `docker image prune` |
| `pressroom-memory` | Memory over 90% for 15 min | `docker stats --no-stream` |
| `pressroom-backup-age` | Last good backup older than 26 h | `systemctl status pressroom-backup`, `journalctl -u pressroom-backup -n 100` |
| `pressroom-cert-expiry` | Certificate expires in under 14 days | `sudo certbot renew --dry-run`; DNS-01 needs the Route 53 TXT permission |
| `pressroom-api-restarts` | The LibreChat api container restarted | `docker compose logs --since 30m api` |
| `pressroom-unhealthy` | A container stopped or unhealthy for 15 min | `docker compose ps`, then that service's logs |
| `pressroom-status-check` | EC2 status check failing | EC2 console; reboot; if the volume is lost, restore drill steps on a new instance |

## Where the numbers come from

- **CloudWatch agent** (installed by `bin/bootstrap.sh`, config `server/cloudwatch/agent.json`): disk and memory every minute; ships LibreChat logs (`/pressroom/librechat`, 90 days) and container logs (`/pressroom/containers`, 30 days). Change retention there to match the client's logging rules.
- **`bin/health-metrics.sh`** every 5 minutes (`pressroom-health.timer`): `BackupAgeHours`, `CertDaysLeft`, `UnhealthyContainers`, `ApiRestarts` in the `PressRoom` namespace. On a server without CloudWatch, `METRICS_SINK=stdout` prints them for the client's own monitoring.
- **Container health checks** in `docker-compose.override.yml` for api, Mongo, both Postgres, the MCP servers, the portal and the Pace mock.

No data means no alarm: this build server is paused often, so a stopped timer shows as "insufficient data" instead of paging. On the client's always-on server set `treatMissingData` to `breaching` for `pressroom-backup-age` and `pressroom-unhealthy` (`infra/lib/monitoring.ts`).

## Health on demand

```bash
sudo /opt/pressroom/server/bin/smoke.sh
METRICS_SINK=stdout sudo -E /opt/pressroom/server/bin/health-metrics.sh
systemctl list-timers 'pressroom-*'
```
