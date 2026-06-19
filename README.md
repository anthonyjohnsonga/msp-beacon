# MSP Beacon — Portable Link Organizer

[![Latest release](https://img.shields.io/github/v/release/anthonyjohnsonga/msp-beacon?color=2e7d32&label=release)](https://github.com/anthonyjohnsonga/msp-beacon/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/anthonyjohnsonga/msp-beacon/docker.yml?color=2e7d32&label=build)](https://github.com/anthonyjohnsonga/msp-beacon/actions/workflows/docker.yml)
[![Docker image](https://img.shields.io/badge/ghcr.io-msp--beacon-2e7d32?logo=docker&logoColor=white)](https://github.com/anthonyjohnsonga/msp-beacon/pkgs/container/msp-beacon)
[![License: MIT](https://img.shields.io/badge/license-MIT-2e7d32)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/anthonyjohnsonga/msp-beacon?color=2e7d32)](https://github.com/anthonyjohnsonga/msp-beacon/commits/main)

A self-hosted, Docker-based personal link organizer with a dark green UI.
Links are saved to a `links.json` file in a mounted folder — easy to back up,
move between machines, or host on a file share.

---

## Table of Contents

- [Features](#features)
  - [Links](#links)
  - [Organization](#organization)
  - [Search & Filter](#search--filter)
  - [Homepage / Dashboard](#homepage--dashboard)
  - [Views & Appearance](#views--appearance)
  - [Stats & Health](#stats--health)
  - [Import & Export](#import--export)
  - [General](#general)
- [Getting Started](#getting-started)
- [Updating](#updating)
- [Changing the Port](#changing-the-port)
- [Accessing Over Tailscale](#accessing-over-tailscale)
- [Backing Up](#backing-up)
- [Moving to a New Machine](#moving-to-a-new-machine)

---

## Features

> [!NOTE]
> MSP Beacon packs a lot into a single self-hosted container. Here's everything it can do, grouped by area.

### Links

<details open>
<summary>Show 7 features</summary>

- **Add, edit, delete links** — save any URL with a title, description, folder, sub-folder, and tags
- **Auto-fetch page title** — blurring the URL field fetches the page title automatically; falls back to `og:title` and `meta[name=title]` if `<title>` is missing
- **Copy URL** — one-click copy button on every card
- **Duplicate URL warning** — inline warning when adding a URL that already exists, with an "Add anyway" option
- **Undo delete** — single and bulk deletes can be undone within 5 seconds via a toast notification
- **Archive** — archive links to tuck them out of the main view without deleting; browse and restore them from Settings → Archive
- **Favorites** — star any link to pin it to a collapsible Favorites section at the top

</details>

### Organization

<details>
<summary>Show 11 features</summary>

- **Folders & sub-folders** — group links into collapsible folders with one level of sub-folder nesting; smooth slide/fade animation on expand/collapse
- **Folder color coding** — assign a custom color to each folder; color cascades to sub-folders and card accents
- **Folder icons** — click the folder icon to pick from 24 presets; persists across rename
- **Folder rename** — inline rename via pencil icon; updates all links, colors, order, and icon atomically
- **Subfolder rename** — pencil icon on subfolder headers enables inline rename; updates all links and collapsed state
- **Delete folder** — trash icon removes the folder and moves its links to no folder
- **Tags** — tag links freely, independent of folders, with autocomplete that suggests existing tags as you type so you don't create near-duplicates
- **Tag colors & Tag Manager** — assign a custom color to any tag and rename, recolor, or delete tags from Settings → Manage tags
- **Drag to reorder** — drag cards to reorder within folders; drag folders to reorder sections; drop a card onto a folder or sub-folder header to move it
- **Bulk actions** — checkbox select mode to delete, move, or tag multiple links at once
- **Collapse all / Expand all** — Settings menu buttons to collapse or expand every folder at once

</details>

### Search & Filter

<details>
<summary>Show 7 features</summary>

- **Search** — real-time search across title, URL, description, folder, and tags (press `/` or `Ctrl+K`)
- **Search operators** — narrow results with `tag:`, `folder:`, and `is:` filters right in the search box: `is:favorite`, `is:readlater`, `is:broken`, `is:online`, `is:untagged`, `is:archived`. Combine them with free text (`tag:dev grafana`) and quote multi-word values (`folder:"My Stuff"`)
- **Full-text content search** — optionally index the page text behind your links (Settings → Index page content); search then matches words found *on the page*, not just the title and URL
- **Search history** — recent searches drop down under the search box for quick re-use
- **Filter button** — folder filter, tag filter, and sort consolidated into a single toolbar button with an active-count badge
- **Click a tag to filter** — click any tag chip on a card to instantly filter to that tag (or right-click for more options)
- **Sort options** — sort by manual order, A→Z, Z→A, newest, oldest, or most visited

</details>

> [!TIP]
> Combine search operators to slice your links fast. For example, `tag:dev folder:"Home Lab" is:online grafana` matches online links tagged `dev`, in the `Home Lab` folder, whose text contains `grafana`. Quote multi-word values, and stack `is:` filters like `is:favorite`, `is:readlater`, `is:broken`, `is:untagged`, or `is:archived`.

### Homepage / Dashboard

<details>
<summary>Show 7 features</summary>

- **Home dashboard** — a start page with a live clock, time-of-day greeting, a prominent search box, and quick-access tiles for your links and folders
- **Customizable widget layout** — click **Edit dashboard** (header button or Settings → View) to drag the widgets (Clock, Search, Favorites, Recent, Most visited, Folders, Latest) into any order and show/hide each one. Your layout saves to your config and syncs across devices
- **Link group widgets** — add your own widgets that hold a titled set of hand-picked app/link tiles, separate from your saved bookmarks — an app-launcher feel for your homelab services
- **Live status dots** — each homepage tile shows a colored dot reflecting the link's most recent health-check result
- **RSS / Atom feeds** — add feeds under Settings → Manage feeds to get a "Latest" headlines widget on the homepage
- **Custom homepage background** — set a backdrop from a built-in gradient, an image URL, or your own uploaded image (stored locally on your server, no third-party calls), with dim and blur sliders to keep everything readable
- **Default view** — choose whether the app opens on the Home dashboard or the link Manager

</details>

### Views & Appearance

<details>
<summary>Show 5 features</summary>

- **List view toggle** — switch between card grid and compact row layout; preference saved
- **Card density toggle** — cycle through compact, comfortable, and spacious grid layouts
- **Folder color accent on cards** — cards show a colored left border matching their folder
- **Themes & accent color** — 12 built-in accent themes (Green, Blue, Purple, Teal, Orange, Red, Rose, Amber, Cyan, Indigo, Fuchsia, Slate) plus a custom accent color picker
- **Light & dark mode** — toggle between light and dark appearance

</details>

### Stats & Health

<details>
<summary>Show 4 features</summary>

- **Visit counter** — tracks how many times each link has been opened
- **Last visited timestamp** — shows "2h ago", "3d ago" etc. on each card
- **Stats report** — Settings → Stats shows total links, total visits, links per folder, top 10 most visited, and never-visited links
- **Link health check** — Settings → Check links runs HEAD requests against all visible links and badges broken ones

</details>

### Import & Export

<details>
<summary>Show 3 features</summary>

- **Import bookmarks** — drop a browser-exported HTML file to import from Chrome, Edge, or Firefox; preview and select before importing
- **Export bookmarks** — export all links as a browser-compatible HTML bookmark file
- **Full backup & restore** — export everything (all links plus your settings) to a single JSON file, and restore it later in one step

</details>

### General

<details>
<summary>Show 4 features</summary>

- **Auto-save** — changes save automatically with a debounced write queue and atomic file writes
- **Favicon display** — fetches and caches each site's favicon locally (no third-party calls; works for internal/homelab hosts)
- **Persistent state** — collapsed folders, folder order, theme, accent, mode, view, density, and sort are saved to `localStorage` and synced via `config.json`
- **Self-hosted & portable** — all data lives in a single `links.json` file; easy to back up or move

</details>

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
      - ./config:/data/config
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
