# Build

Builds are manual. The systemd unit only runs the already-built server bundle,
so nothing rebuilds on restart.

```bash
npm run build -w @gwent/server    # server changes
npm run build -w @gwent/client    # client changes — no restart needed, dist is served directly
sudo systemctl restart easy-gwent # server changes only
```

The server serves `packages/client/dist` off disk on each request, so a client
build takes effect immediately. Only a server rebuild needs the restart.
