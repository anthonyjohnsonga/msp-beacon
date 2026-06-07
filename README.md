# MSP Beacon — Portable Link Organizer

A self-hosted, Docker-based personal link organizer with a dark green UI.
Links are saved to a `links.json` file in a mounted folder — easy to back up,
move between machines, or host on a file share.

---

## Features

### Links
- **Add, edit, delete links** — save any URL with a title, description, folder, sub-folder, and tags
- **Auto-fetch page title** — blurring the URL field fetches the page title automatically
- **Copy URL** — one-click copy button on every card
- **Duplicate URL warning** — inline warning when adding a URL that already exists, with an "Add anyway" option
- **Undo delete** — single and bulk deletes can be undone within 5 seconds via a toast notification
- **Favorites** — star any link to pin it to a collapsible Favorites section at the top

### Organization
- **Folders & sub-folders** — group links into collapsible folders with one level of sub-folder nesting
- **Folder color coding** — assign a custom color to each folder; color cascades to sub-folders and card accents
- **Folder rename** — inline rename via pencil icon; updates all links, colors, and order atomically
- **Delete folder** — trash icon removes the folder and moves its links to no folder
- **Tags** — tag links for filtering; filter by tag from the toolbar
- **Drag to reorder** — drag cards to reorder within folders; drag folders to reorder sections; drop a card onto a folder or sub-folder header to move it
- **Bulk actions** — checkbox select mode to delete, move, or tag multiple links at once

### Search & Filter
- **Search** — real-time search across title, URL, description, folder, and tags (press `/` or `Ctrl+K`)
- **Folder & tag filters** — filter the view by folder or tag from toolbar dropdowns
- **Sort options** — sort by manual order, A→Z, Z→A, newest, oldest, or most visited

### Views & Appearance
- **List view toggle** — switch between card grid and compact row layout; preference saved
- **Card density toggle** — cycle through compact, comfortable, and spacious grid layouts
- **Folder color accent on cards** — cards show a colored left border matching their folder
- **Themes** — 6 built-in color themes (Green, Blue, Purple, Teal, Orange, Red)

### Stats & Health
- **Visit counter** — tracks how many times each link has been opened
- **Last visited timestamp** — shows "2h ago", "3d ago" etc. on each card
- **Stats report** — Settings → Stats shows total links, total visits, links per folder, top 10 most visited, and never-visited links
- **Link health check** — Settings → Check links runs HEAD requests against all visible links and badges broken ones

### Import & Export
- **Import bookmarks** — drop a browser-exported HTML file to import from Chrome, Edge, or Firefox; preview and select before importing
- **Export bookmarks** — export all links as a browser-compatible HTML bookmark file

### General
- **Auto-save** — changes save automatically with a debounced write queue and atomic file writes
- **Favicon display** — automatically fetches site favicons for each link
- **Persistent state** — collapsed folders, folder order, theme, view, density, and sort are saved to `localStorage`
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
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.50'
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
