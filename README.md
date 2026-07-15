# Discord Bot

A modular Discord bot built with [discord.js](https://discord.js.org/) v14. Slash
commands are auto-loaded from the `commands/` folder, so adding a new command is
just dropping in a new file.

## Crash recovery

`npm run recover` first pings the live `/health` endpoint. If the bot answers
(`200`), it's already up and the script does nothing — this guards against a
second copy. If `/health` is unreachable, it recovers the fastest way for the
current time in Amsterdam:

- **Peak hours (08:00–20:00 Europe/Amsterdam)** → starts it **locally** from this
  folder (`node index.js`), so recovery doesn't wait on a Railway redeploy.
- **Off-peak** → runs `railway redeploy --service DiscordBot -y`.

Force a mode with `npm run recover -- --local` / `-- --railway` (both skip the
health check), or `-- --force` to recover even if `/health` says it's up. Tune
via the `PEAK_START` / `PEAK_END` / `PEAK_TZ` / `RAILWAY_SERVICE` / `HEALTH_URL`
env vars.

> ⚠ Run only one instance at a time. The health check guards this, but a *forced*
> local start while Railway is up will double-reply. The Railway branch needs the
> [Railway CLI](https://docs.railway.com/guides/cli) installed and this folder
> linked (`railway link`).
