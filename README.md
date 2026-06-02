# MSP Beacon — Portable Link Organizer

A self-hosted, Docker-based personal link organizer with a dark green UI.
Links are saved to a `links.json` file in a mounted folder — easy to back up,
move between machines, or host on a file share.

---

## Features

- **Add, edit, delete links** — save any URL with a title, description, folder, and tags
- **Folders** — group links into collapsible folders; drag to reorder folders
- **Tags** — tag links for filtering; filter by tag from the toolbar
- **Search** — real-time search across title, URL, description, folder, and tags (press `/` or `Ctrl+K`)
- **Folder & tag filters** — filter the view by folder or tag from dropdowns
- **Drag to reorder** — drag cards within a folder to reorder; drag a card onto a folder header to move it
- **Copy URL** — one-click copy button on every card
- **Bulk actions** — checkbox select mode to select multiple cards at once, then delete, move to a folder, or add a tag in one action
- **Import bookmarks** — drop a browser-exported HTML file to import bookmarks from Chrome, Edge, or Firefox; preview and select which to import
- **Export bookmarks** — export all links as a browser-compatible HTML bookmark file
- **Themes** — 6 built-in color themes (Green, Blue, Purple, Teal, Orange, Red)
- **Auto-save** — changes save automatically with a debounced write queue and atomic file writes
- **Favicon display** — automatically fetches site favicons for each link
- **Persistent state** — collapsed folders, folder order, and theme are saved to `localStorage`
- **Self-hosted & portable** — all data lives in a single `links.json` file; easy to back up or move

---

## Getting Started

### 1. Create a folder and compose file

```bash
mkdir msp-beacon && cd msp-beacon
nano docker-compose.yml
```

Paste this into the file, then save (`Ctrl+X`, `Y`, `Enter`):

```yaml
services:
  msp-beacon:
    image: ghcr.io/anthonyjohnsonga/msp-beacon:latest
    container_name: msp-beacon
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    restart: unless-stopped
```

### 2. Start the container

```bash
docker compose up -d
```

Docker will pull the image automatically — no build step needed.

### 3. Open the app

```
http://localhost:3000
```

Or from another device on your network:

```
http://<your-server-ip>:3000
```

That's it. Your links are saved to `./data/links.json` in the same folder.

---

## Updating

```bash
docker compose pull
docker compose up -d
```

Your `data/links.json` is never touched during updates.

---

## Changing the Port

Edit `docker-compose.yml` and change the left side of the port mapping:

```yaml
ports:
  - "8080:3000"   # Now accessible on port 8080
```

Then restart: `docker compose up -d`

---

## Accessing Over Tailscale

Once the container is running, access it from any Tailscale-connected device using:

```
http://<your-machine-tailscale-ip>:3000
```

Find your Tailscale IP in the Tailscale app or by running `tailscale ip` in a terminal.

---

## Backing Up

Just copy `data/links.json` — that's everything.

---

## Moving to a New Machine

1. Copy `data/links.json` to the new machine
2. Create a new folder with the same `docker-compose.yml` above
3. Put `links.json` in a `data/` subfolder
4. Run `docker compose up -d`
5. Done — your links are back
