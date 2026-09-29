# Tools

## `agora-viewer/` — browser receiver

A one-file Agora Web SDK page that joins a channel as an audience member and shows the
first remote video it sees, with its true resolution, orientation and frame rate. It uses
`object-fit: contain`, so a portrait stream is never cropped into looking sideways.

```bash
tools/serve-viewer.sh            # http://localhost:8765/
```

Open it with the App ID and channel prefilled, so nothing secret is written to disk:

```
http://localhost:8765/?appId=<APP_ID>&channel=<CHANNEL>
```

`token` is optional: leave it out for a project using App ID authentication, or pass
`&token=...` for one with an App Certificate (the token must be minted for that exact
channel). Then **Join**, and tap **Go live** in the example app.

What to look for:

- Portrait resolution (e.g. 720×1280 or 576×1024, depending on the camera preset) and a
  steady ~30 fps.
- Filters and beauty changes appear immediately.
- Front camera: the remote looks exactly like the local preview (selfie-mirrored), because
  on iOS Nosmai mirrors at capture. Back camera: not mirrored.
