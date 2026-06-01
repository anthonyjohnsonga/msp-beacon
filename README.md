# MSP Beacon — Portable Link Organizer

A self-hosted, Docker-based personal link organizer with a dark green UI.
Links are saved to a `links.json` file in a mounted folder — easy to back up,
move between machines, or host on a file share.

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

## Unraid Setup

1. Copy the `msp-beacon/` folder to your Unraid server (e.g. `/mnt/user/appdata/msp-beacon/`)
2. SSH into Unraid and run:
   ```bash
   cd /mnt/user/appdata/msp-beacon
   docker compose up -d
   ```
3. Or use the Unraid Docker UI to add a custom container pointing to the built image.

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
