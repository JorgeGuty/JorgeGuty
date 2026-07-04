/* FOG RUNNER — a real-life GTA-style map.
 * The whole world starts covered in fog; walking around (or demo mode)
 * permanently reveals the areas you have physically visited.
 */

(() => {
  "use strict";

  // --- Tuning -------------------------------------------------------------
  const REVEAL_RADIUS_M = 140;    // how far you "see" around you
  const MIN_POINT_SPACING_M = 35; // min distance between stored reveal points
  const MIN_MOVE_FOR_DIST_M = 10; // ignore GPS jitter below this when counting distance
  const MAX_ACCURACY_M = 100;     // discard fixes less accurate than this
  const STORAGE_KEY = "fogrunner-explored-v1";

  // --- Map ----------------------------------------------------------------
  const map = L.map("map", {
    zoomControl: false,
    worldCopyJump: true,
  }).setView([20, 0], 3);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(map);

  // --- State --------------------------------------------------------------
  /** @type {Array<[number, number]>} explored reveal points [lat, lng] */
  let explored = loadExplored();
  let player = null;          // L.Marker
  let playerPos = null;       // L.LatLng
  let lastDistPos = null;     // last position counted toward distance
  let heading = 0;            // degrees
  let distanceM = loadNumber(STORAGE_KEY + ":dist");
  let watchId = null;
  let follow = true;
  let demoMode = false;
  let needsRedraw = true;

  // --- DOM ----------------------------------------------------------------
  const canvas = document.getElementById("fog");
  const ctx = canvas.getContext("2d");
  const statZones = document.getElementById("stat-zones");
  const statDistance = document.getElementById("stat-distance");
  const statGps = document.getElementById("stat-gps");
  const btnLocate = document.getElementById("btn-locate");
  const btnFollow = document.getElementById("btn-follow");
  const btnDemo = document.getElementById("btn-demo");
  const btnImport = document.getElementById("btn-import");
  const fileInput = document.getElementById("file-input");
  const btnReset = document.getElementById("btn-reset");
  const toastEl = document.getElementById("toast");

  // --- Persistence ---------------------------------------------------------
  function loadExplored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function loadNumber(key) {
    const n = parseFloat(localStorage.getItem(key));
    return Number.isFinite(n) ? n : 0;
  }

  let saveTimer = null;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(explored));
        localStorage.setItem(STORAGE_KEY + ":dist", String(distanceM));
      } catch (e) {
        toast("Storage full — new areas won't be remembered");
      }
    }, 800);
  }

  // --- Geometry -----------------------------------------------------------
  function haversineM(a, b) {
    const R = 6371000;
    const dLat = ((b[0] - a[0]) * Math.PI) / 180;
    const dLng = ((b[1] - a[1]) * Math.PI) / 180;
    const la1 = (a[0] * Math.PI) / 180;
    const la2 = (b[0] * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function bearingDeg(a, b) {
    const la1 = (a[0] * Math.PI) / 180;
    const la2 = (b[0] * Math.PI) / 180;
    const dLng = ((b[1] - a[1]) * Math.PI) / 180;
    const y = Math.sin(dLng) * Math.cos(la2);
    const x =
      Math.cos(la1) * Math.sin(la2) -
      Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  // Move [lat,lng] by meters north/east — good enough at walking scale.
  function offsetM(pos, northM, eastM) {
    const dLat = northM / 111320;
    const dLng = eastM / (111320 * Math.cos((pos[0] * Math.PI) / 180));
    return [pos[0] + dLat, pos[1] + dLng];
  }

  // --- Fog rendering --------------------------------------------------------
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    needsRedraw = true;
  }

  function metersToPixels(meters, lat) {
    const mpp =
      (40075016.686 * Math.abs(Math.cos((lat * Math.PI) / 180))) /
      Math.pow(2, map.getZoom() + 8);
    return meters / mpp;
  }

  function drawFog() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    // Solid fog
    ctx.fillStyle = "rgba(7, 8, 12, 0.955)";
    ctx.fillRect(0, 0, w, h);

    // Faint grid, GTA-pause-menu style
    ctx.strokeStyle = "rgba(244, 196, 48, 0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 0; y < h; y += 48) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    // Punch holes for explored points currently in view
    const bounds = map.getBounds().pad(0.3);
    ctx.globalCompositeOperation = "destination-out";
    for (const pt of explored) {
      if (!bounds.contains(pt)) continue;
      const p = map.latLngToContainerPoint(pt);
      const r = Math.max(metersToPixels(REVEAL_RADIUS_M, pt[0]), 3);
      if (p.x < -r || p.y < -r || p.x > w + r || p.y > h + r) continue;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.65, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function renderLoop() {
    if (needsRedraw) {
      needsRedraw = false;
      drawFog();
    }
    requestAnimationFrame(renderLoop);
  }

  map.on("move zoom viewreset", () => { needsRedraw = true; });
  window.addEventListener("resize", resizeCanvas);

  // --- Player --------------------------------------------------------------
  function ensurePlayer(latlng) {
    if (!player) {
      player = L.marker(latlng, {
        icon: L.divIcon({
          className: "player-icon",
          html: '<div class="player-arrow"></div>',
          iconSize: [22, 26],
          iconAnchor: [11, 17],
        }),
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(map);
    } else {
      player.setLatLng(latlng);
    }
    const arrow = player.getElement()?.firstElementChild;
    if (arrow) arrow.style.transform = `rotate(${heading}deg)`;
  }

  function updatePosition(lat, lng, headingDeg) {
    const pos = [lat, lng];

    if (playerPos) {
      const moved = haversineM([playerPos.lat, playerPos.lng], pos);
      if (headingDeg == null && moved > 3) {
        heading = bearingDeg([playerPos.lat, playerPos.lng], pos);
      }
    }
    if (headingDeg != null && !Number.isNaN(headingDeg)) heading = headingDeg;

    // Distance traveled (jitter-filtered)
    if (!lastDistPos) {
      lastDistPos = pos;
    } else {
      const d = haversineM(lastDistPos, pos);
      if (d >= MIN_MOVE_FOR_DIST_M) {
        distanceM += d;
        lastDistPos = pos;
      }
    }

    playerPos = L.latLng(lat, lng);
    ensurePlayer(playerPos);
    revealAt(pos);
    if (follow) map.panTo(playerPos, { animate: true, duration: 0.5 });
    updateStats();
  }

  function revealAt(pos) {
    // Only store a new point if it's far enough from every nearby stored one.
    // Check the most recent points first — that's where the player usually is.
    for (let i = explored.length - 1, checked = 0; i >= 0 && checked < 400; i--, checked++) {
      if (haversineM(explored[i], pos) < MIN_POINT_SPACING_M) return;
    }
    explored.push([+pos[0].toFixed(6), +pos[1].toFixed(6)]);
    needsRedraw = true;
    saveSoon();
  }

  // --- Import (GPX tracks / Google Timeline JSON) ---------------------------
  // Lets background-capable trackers (Strava, GPS loggers, Google Timeline)
  // do the recording; their exports reveal the fog here afterwards.

  function validCoord(lat, lng) {
    return (
      Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
      (lat !== 0 || lng !== 0)
    );
  }

  // Returns ordered segments (arrays of [lat,lng]); distance is only summed
  // within a segment, since points there are a continuous recorded path.
  function parseGpx(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("invalid GPX");
    const readPt = (el) => {
      const lat = parseFloat(el.getAttribute("lat"));
      const lng = parseFloat(el.getAttribute("lon"));
      return validCoord(lat, lng) ? [lat, lng] : null;
    };
    const segs = [];
    doc.querySelectorAll("trkseg, rte").forEach((seg) => {
      const pts = [...seg.querySelectorAll("trkpt, rtept")]
        .map(readPt)
        .filter(Boolean);
      if (pts.length) segs.push(pts);
    });
    // standalone waypoints: single-point segments (no distance credit)
    doc.querySelectorAll(":scope > wpt, gpx > wpt").forEach((el) => {
      const p = readPt(el);
      if (p) segs.push([p]);
    });
    return segs;
  }

  // Tolerant of every Google Takeout / Timeline flavor: walks the whole JSON
  // tree collecting latitudeE7/longitudeE7 pairs and "lat, lng" strings
  // (timelinePath points, "geo:lat,lng" placeLocations, etc).
  function parseTimelineJson(text) {
    const data = JSON.parse(text);
    const pts = [];
    const coordRe = /(-?\d{1,3}(?:\.\d+)?)°?\s*,\s*(-?\d{1,3}(?:\.\d+)?)°?/;
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      const latE7 = node.latitudeE7 ?? node.latE7;
      const lngE7 = node.longitudeE7 ?? node.lngE7;
      if (typeof latE7 === "number" && typeof lngE7 === "number") {
        const lat = latE7 / 1e7, lng = lngE7 / 1e7;
        if (validCoord(lat, lng)) pts.push([lat, lng]);
      }
      for (const v of Object.values(node)) {
        if (typeof v === "string") {
          const m = v.match(coordRe);
          if (m && validCoord(+m[1], +m[2])) pts.push([+m[1], +m[2]]);
        } else {
          walk(v);
        }
      }
    };
    walk(data);
    return pts;
  }

  async function importFiles(files) {
    if (!files || !files.length) return;
    toast("Importing…");
    const before = explored.length;
    let parsedPts = 0;
    let importedDistM = 0;
    const failed = [];
    for (const file of files) {
      try {
        const text = await file.text();
        const isGpx = /\.gpx$/i.test(file.name) || text.trimStart().startsWith("<");
        if (isGpx) {
          for (const seg of parseGpx(text)) {
            parsedPts += seg.length;
            for (let i = 0; i < seg.length; i++) {
              if (i > 0) importedDistM += haversineM(seg[i - 1], seg[i]);
              revealAt(seg[i]);
            }
          }
        } else {
          const pts = parseTimelineJson(text);
          parsedPts += pts.length;
          for (const p of pts) revealAt(p);
        }
      } catch {
        failed.push(file.name);
      }
    }
    const added = explored.length - before;
    if (added > 0) {
      distanceM += importedDistM;
      saveSoon();
      updateStats();
      map.fitBounds(L.latLngBounds(explored.slice(before)).pad(0.2), {
        maxZoom: 15,
      });
      const km = importedDistM / 1000;
      toast(
        `Uncovered ${added} new zones` +
          (km >= 0.1 ? ` (+${km.toFixed(1)} km traveled)` : "")
      );
    } else if (failed.length === files.length) {
      toast("Couldn't read those files — expected GPX or Google Timeline JSON");
    } else if (parsedPts > 0) {
      toast("No new zones — you had already explored all of that");
    } else {
      toast("No coordinates found in those files");
    }
    if (failed.length && failed.length < files.length) {
      console.warn("Import failed for:", failed);
    }
  }

  btnImport.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    importFiles([...fileInput.files]);
    fileInput.value = "";
  });

  // Drag & drop anywhere on the page
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    importFiles([...e.dataTransfer.files]);
  });

  // --- Wake lock -------------------------------------------------------------
  // Keep the screen on while live tracking, so walks aren't cut short by the
  // phone going to sleep (browsers can't read GPS from the background).
  let wakeLock = null;

  async function acquireWakeLock() {
    try {
      wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      wakeLock = null; // low battery or unsupported — tracking still works
    }
  }

  function releaseWakeLock() {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }

  document.addEventListener("visibilitychange", () => {
    // the lock is auto-released when the tab is hidden; re-grab it on return
    if (watchId != null && document.visibilityState === "visible") {
      acquireWakeLock();
    }
  });

  // --- GPS -----------------------------------------------------------------
  function startGps() {
    if (!("geolocation" in navigator)) {
      toast("Geolocation not supported by this browser — try DEMO mode");
      return;
    }
    if (!window.isSecureContext) {
      toast("GPS needs HTTPS. Open the app over https:// or use DEMO mode");
      return;
    }
    statGps.textContent = "…";
    watchId = navigator.geolocation.watchPosition(
      (fix) => {
        const { latitude, longitude, accuracy, heading: hd } = fix.coords;
        if (accuracy > MAX_ACCURACY_M) {
          statGps.textContent = `WEAK (±${Math.round(accuracy)}m)`;
          return;
        }
        statGps.textContent = `±${Math.round(accuracy)}m`;
        const firstFix = !playerPos;
        updatePosition(latitude, longitude, hd);
        if (firstFix) map.setView([latitude, longitude], 16);
      },
      (err) => {
        statGps.textContent = "OFF";
        stopGpsUi();
        const msg = {
          1: "Location permission denied — allow it or use DEMO mode",
          2: "Position unavailable — are you indoors?",
          3: "GPS timed out — trying again may help",
        }[err.code] || "GPS error";
        toast(msg);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    btnLocate.textContent = "⏸ STOP";
    btnLocate.classList.add("active");
    acquireWakeLock();
    toast("Tracking started — go explore!");
  }

  function stopGps() {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    stopGpsUi();
  }

  function stopGpsUi() {
    watchId = null;
    releaseWakeLock();
    statGps.textContent = "OFF";
    btnLocate.textContent = "▶ START";
    btnLocate.classList.remove("active");
  }

  // --- Demo mode -------------------------------------------------------------
  // Click anywhere to "drive" there in a straight line; arrow keys / WASD walk.
  function demoTravelTo(target) {
    const from = playerPos
      ? [playerPos.lat, playerPos.lng]
      : [target.lat, target.lng];
    const to = [target.lat, target.lng];
    const total = haversineM(from, to);
    const steps = Math.max(1, Math.min(200, Math.round(total / (MIN_POINT_SPACING_M - 5))));
    let i = 0;
    const tick = () => {
      if (!demoMode) return;
      i++;
      const t = i / steps;
      updatePosition(
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        null
      );
      if (i < steps) setTimeout(tick, 60);
    };
    tick();
  }

  function onDemoKey(e) {
    if (!demoMode || !playerPos) return;
    const step = 30; // meters
    const dirs = {
      ArrowUp: [step, 0], KeyW: [step, 0],
      ArrowDown: [-step, 0], KeyS: [-step, 0],
      ArrowLeft: [0, -step], KeyA: [0, -step],
      ArrowRight: [0, step], KeyD: [0, step],
    };
    const d = dirs[e.code];
    if (!d) return;
    e.preventDefault();
    const next = offsetM([playerPos.lat, playerPos.lng], d[0], d[1]);
    updatePosition(next[0], next[1], null);
  }

  map.on("click", (e) => {
    if (!demoMode) return;
    if (!playerPos) {
      map.setView(e.latlng, Math.max(map.getZoom(), 15));
      updatePosition(e.latlng.lat, e.latlng.lng, null);
    } else {
      demoTravelTo(e.latlng);
    }
  });

  document.addEventListener("keydown", onDemoKey);

  // --- UI ------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3500);
  }

  function updateStats() {
    statZones.textContent = String(explored.length);
    statDistance.textContent =
      distanceM >= 1000
        ? (distanceM / 1000).toFixed(2) + " km"
        : Math.round(distanceM) + " m";
  }

  btnLocate.addEventListener("click", () => {
    if (watchId != null) stopGps();
    else startGps();
  });

  btnFollow.addEventListener("click", () => {
    follow = !follow;
    btnFollow.classList.toggle("active", follow);
    if (follow && playerPos) map.panTo(playerPos);
  });

  btnDemo.addEventListener("click", () => {
    demoMode = !demoMode;
    btnDemo.classList.toggle("active", demoMode);
    toast(
      demoMode
        ? "Demo mode: click the map to travel, arrows/WASD to walk"
        : "Demo mode off"
    );
  });

  btnReset.addEventListener("click", () => {
    if (!confirm("Cover the whole map in fog again? This erases your exploration progress.")) return;
    explored = [];
    distanceM = 0;
    lastDistPos = null;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY + ":dist");
    needsRedraw = true;
    updateStats();
    toast("Fog reset — the world is unknown again");
  });

  // Panning the map manually turns follow off, like GTA's map cursor
  map.on("dragstart", () => {
    if (!follow) return;
    follow = false;
    btnFollow.classList.remove("active");
  });

  // --- Boot ------------------------------------------------------------------
  resizeCanvas();
  renderLoop();
  updateStats();

  if (explored.length > 0) {
    const last = explored[explored.length - 1];
    map.setView(last, 15);
    toast(`Welcome back — ${explored.length} zones already uncovered`);
  } else {
    toast("Press START to track your real location, or 🕹 DEMO to try it out");
  }
})();
