# SeaSensei web

Mobile-first PWA version of the app: HRRR forecast (Open-Meteo) plus live NOAA CO-OPS wind.
No build step, no backend, no API keys. Spots live in the browser's localStorage.

```bash
node web/test.mjs                          # logic tests
python3 -m http.server 8123 --directory web  # run locally
```

Deploy (Hetzner/Coolify, same as the other apps): Dockerfile app, base directory `/web`,
port 80, domain e.g. `seasensei.tracebi.com` (Coolify domain `http://<host>` + Cloudflare tunnel
route to `localhost:80` + proxied CNAME to `<tunnel-id>.cfargotunnel.com`). Then on iPhone:
Safari → Share → Add to Home Screen.
