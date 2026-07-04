# FOG RUNNER 🗺️

The GTA map, but in real life: the whole world starts covered in fog of war,
and it only gets revealed as you physically go there.

## How it works

- Press **▶ START** to begin GPS tracking (the browser will ask for location
  permission). A ~140 m circle around you is permanently uncovered as you move.
- Explored areas and distance traveled are saved in your browser
  (`localStorage`), so the map stays revealed between visits.
- **🎯 FOLLOW** keeps the camera locked on you (dragging the map turns it off).
- **🕹 DEMO** lets you try it without GPS: click anywhere to travel there,
  or move with the arrow keys / WASD.
- **🗑 RESET FOG** covers the world again.

## Running it

It's a fully static app — no build step, no server logic:

```bash
# any static server works
python3 -m http.server 8000
# then open http://localhost:8000
```

> **Note:** browsers only allow geolocation on secure origins, so real GPS
> tracking needs `https://` (or `localhost`). The easiest way to use it on
> your phone is enabling **GitHub Pages** for this repo and opening the
> published URL while you walk around.

## Stack

- [Leaflet](https://leafletjs.com/) (vendored in `vendor/leaflet/`) with the
  free CARTO dark basemap.
- A full-screen `<canvas>` fog layer: dark fill + `destination-out` radial
  gradients punched at every explored point, redrawn as the map moves.
- Vanilla JS, no framework, no dependencies to install.
