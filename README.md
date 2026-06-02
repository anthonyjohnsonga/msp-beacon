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

## Quick Start

### Requirements
- Docker + Docker Compose (Docker Desktop on Windows/Mac, or Docker Engine on Linux/Unraid)

### Run it

```bash
# Clone or copy this folder anywhere, then:
docker compose up -d
```

Open your browser to: **http://localhost:3000**

---

## File Structure

```
msp-beacon/
├── docker-compose.yml   # Start/stop the container
├── Dockerfile           # Container definition
├── server.js            # Express API server
├── package.json
├── public/
│   └── index.html       # The app UI
└── data/
    └── links.json       # YOUR LINKS — this is the only file that matters
```

---

## Moving to a New Machine

1. Copy the entire `msp-beacon/` folder (or just `data/links.json` if you rebuild)
2. Install Docker on the new machine
3. Run `docker compose up -d` in the folder
4. Done — your links are back

---

## Accessing Over Tailscale

Once the container is running, access it from any Tailscale-connected device using:

```
http://<your-machine-tailscale-ip>:3000
```

Find your Tailscale IP in the Tailscale app or by running `tailscale ip` in a terminal.

To use a custom port, edit `docker-compose.yml`:
```yaml
ports:
  - "8080:3000"   # Access on port 8080 instead
```

---

## Backing Up Your Links

Just copy `data/links.json` — that's everything.

---

## Updating the App

```bash
docker compose down
# Pull the new msp-beacon folder / replace files
docker compose up -d --build
```

Your `data/links.json` is untouched since it lives outside the container.
