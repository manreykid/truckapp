// Map, routing, and rest-stop planning. Leaflet globals (L) come from the
// classic scripts loaded in index.html.
import { esc } from "./utils.js";

// Used only when the backend is unreachable, so the map is never empty.
// Coordinates are plain decimal degrees, the same format the API serves.
const FALLBACK_POIS = [
    { Naam: "Honswijck", Snelweg: "A1", Type: "poi_snelweg", Latitude: 52.3205346, Longitude: 5.0792278 },
    { Naam: "Hackelaar", Snelweg: "A1", Type: "poi_snelweg", Latitude: 52.3221142, Longitude: 5.0827356 },
    { Naam: "Ronduit", Snelweg: "A1", Type: "poi_snelweg", Latitude: 52.294336, Longitude: 5.1769962 },
    { Naam: "Bastion", Snelweg: "A1", Type: "poi_snelweg", Latitude: 52.2953673, Longitude: 5.177806 },
    { Naam: "De Hucht", Snelweg: "A1", Type: "poi_snelweg", Latitude: 52.1854214, Longitude: 5.8905158 },
];

const TYPE_COLORS = { poi_snelweg: "blue", restaurant: "green", truckstop: "red", bedrijf: "orange" };

// EU regulation 561/2006: max 4.5h of driving before a 45-minute break.
const MAX_DRIVING_SECONDS = 4.5 * 3600;

export class MapManager {
    constructor(api) {
        this.api = api;
        this.mapInstance = null;
        this.routingControl = null;
        this.suggestionLayer = null;
        this.allPois = [];
        this.currentRouteData = null;
        this.pendingDeparture = null;
        this.isInitialized = false;

        // Wired by the UI layer.
        this.onRoute = () => {};
        this.onRouteError = () => {};
    }

    init() {
        if (this.isInitialized) return;

        // Leaflet comes from CDN scripts; if those failed to load (offline,
        // CDN outage, blocked network) the rest of the dashboard must keep
        // working - only the map pane goes dark.
        if (typeof L === "undefined" || !L.Routing || !L.AwesomeMarkers) {
            console.warn("Kaartbibliotheken (CDN) niet geladen; kaart uitgeschakeld.");
            const pane = document.getElementById("map");
            if (pane) {
                pane.innerHTML =
                    '<p style="padding:20px;">Kaart kon niet laden (geen verbinding met de kaart-CDN). ' +
                    "De rest van het dashboard blijft werken.</p>";
            }
            return;
        }
        this.isInitialized = true;

        this.mapInstance = L.map("map").setView([52.1326, 5.2913], 7);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap",
        }).addTo(this.mapInstance);

        this.suggestionLayer = L.layerGroup().addTo(this.mapInstance);

        this.routingControl = L.Routing.control({
            waypoints: [],
            routeWhileDragging: false,
            addWaypoints: false,
            show: false,
            createMarker: () => null,
            // NOTE: the public OSRM demo server only supports the 'driving'
            // (car) profile - no truck-specific routing (bridge heights, axle
            // weights). For real truck routing, swap in a routed provider
            // (Mapbox/TomTom/GraphHopper) here. See README -> Roadmap.
            router: L.Routing.osrmv1({ language: "nl", profile: "driving" }),
        }).addTo(this.mapInstance);

        this.routingControl.on("routesfound", (e) => this.handleRouteFound(e));
        this.routingControl.on("routingerror", () => {
            this.onRouteError("Er kon geen route worden berekend. Probeer specifiekere plaatsnamen.");
        });

        this.createLegend();
        this.loadPOIs();
        setTimeout(() => this.mapInstance.invalidateSize(), 100);
    }

    async geocodeAddress(queryStr) {
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(queryStr)}`
            );
            const data = await res.json();
            return data && data.length
                ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
                : null;
        } catch (error) {
            console.error("Geocoding mislukt:", error);
            return null;
        }
    }

    // Resolve both addresses and kick off routing. Route results arrive via
    // the onRoute/onRouteError callbacks (Leaflet events). Returns false if
    // an address could not be resolved. Picks from the autocomplete carry
    // exact coordinates and skip the geocoding fallback entirely.
    async calculateRoute(startAddress, endAddress, departureStr, startPick = null, endPick = null) {
        if (!this.isInitialized) {
            this.onRouteError("De kaart is niet beschikbaar; routeplanning is nu niet mogelijk.");
            return true; // error already reported via onRouteError
        }
        this.pendingDeparture = departureStr || null;

        const [start, end] = await Promise.all([
            startPick ? { lat: startPick.lat, lng: startPick.lon } : this.geocodeAddress(startAddress),
            endPick ? { lat: endPick.lat, lng: endPick.lon } : this.geocodeAddress(endAddress),
        ]);
        if (!start || !end) return false;

        this.routingControl.setWaypoints([
            L.latLng(start.lat, start.lng),
            L.latLng(end.lat, end.lng),
        ]);
        return true;
    }

    // Dutch rush-hour heuristic: OSRM has no live traffic, so we add a penalty
    // when the planned departure falls in a weekday morning/evening peak.
    calculateTrafficPenalty(baseTimeSeconds, departureDateStr) {
        if (!departureDateStr) return { time: baseTimeSeconds, hasPenalty: false };

        const dep = new Date(departureDateStr);
        const day = dep.getDay();
        if (day === 0 || day === 6) return { time: baseTimeSeconds, hasPenalty: false };

        const hour = dep.getHours() + dep.getMinutes() / 60;
        let penalty = 1.0;
        if (hour >= 7.0 && hour <= 9.5) penalty = 1.25;
        else if (hour >= 16.0 && hour <= 18.5) penalty = 1.3;

        return { time: baseTimeSeconds * penalty, hasPenalty: penalty > 1.0 };
    }

    handleRouteFound(e) {
        const route = e.routes[0];
        const distanceKm = route.summary.totalDistance / 1000;

        const traffic = this.calculateTrafficPenalty(route.summary.totalTime, this.pendingDeparture);
        const expectedMinutes = Math.round(traffic.time / 60);

        const restStops = this.computeRestStops(route);
        this.drawRestStopMarkers(restStops);

        this.currentRouteData = {
            distanceKm: Number(distanceKm.toFixed(1)),
            expectedTimeMinutes: expectedMinutes,
        };

        this.onRoute({
            distanceKm: this.currentRouteData.distanceKm,
            expectedMinutes,
            hasTrafficPenalty: traffic.hasPenalty,
            restStops,
        });
    }

    // One break every 4.5h of driving; for each break point, suggest the
    // nearest POI. Returns [{poi, afterHours, distanceKm}].
    computeRestStops(route) {
        const stops = [];
        if (!this.allPois.length) return stops;

        const breaks = Math.floor(route.summary.totalTime / MAX_DRIVING_SECONDS);
        for (let k = 1; k <= breaks; k++) {
            const target = k * MAX_DRIVING_SECONDS;
            let elapsed = 0;
            let index = -1;
            for (const step of route.instructions || []) {
                elapsed += step.time;
                if (elapsed >= target) {
                    index = step.index;
                    break;
                }
            }
            if (index < 0 || !route.coordinates[index]) continue;

            const nearest = this.nearestPoi(L.latLng(route.coordinates[index]));
            if (nearest && !stops.some((s) => s.poi === nearest.poi)) {
                stops.push({ ...nearest, afterHours: target / 3600 });
            }
        }
        return stops;
    }

    nearestPoi(point) {
        let best = null;
        let minDistance = Infinity;
        for (const poi of this.allPois) {
            const ll = this.parseCoordinates(poi);
            if (!ll) continue;
            const distance = point.distanceTo(ll);
            if (distance < minDistance) {
                minDistance = distance;
                best = { poi, latLng: ll, distanceKm: distance / 1000 };
            }
        }
        return best;
    }

    drawRestStopMarkers(restStops) {
        this.suggestionLayer.clearLayers();
        for (const stop of restStops) {
            const icon = L.AwesomeMarkers.icon({ icon: "bed", prefix: "fa", markerColor: "red" });
            L.marker(stop.latLng, { icon, zIndexOffset: 1000 })
                .bindPopup(
                    `<b>Voorgestelde rustplaats</b><br>${esc(stop.poi.Naam)} ` +
                    `(${esc(stop.poi.Snelweg || "?")})<br>na ca. ${stop.afterHours.toFixed(1)} uur rijden`
                )
                .addTo(this.suggestionLayer);
        }
    }

    async loadPOIs() {
        try {
            this.allPois = await this.api.getPois();
            if (!this.allPois.length) throw new Error("Geen POIs van backend");
        } catch (error) {
            console.warn("POIs niet van backend geladen, fallback gebruikt:", error.message);
            this.allPois = FALLBACK_POIS;
        }
        this.addPoisToMap(this.allPois);
    }

    // Coordinates are plain decimal degrees. Validate, don't transform.
    parseCoordinates(poi) {
        const lat = Number(poi.Latitude);
        const lon = Number(poi.Longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
        return L.latLng(lat, lon);
    }

    addPoisToMap(pois) {
        pois.forEach((poi) => {
            const latLng = this.parseCoordinates(poi);
            if (!latLng) return;
            const color = TYPE_COLORS[poi.Type] || "gray";
            const icon = L.AwesomeMarkers.icon({ icon: "truck", prefix: "fa", markerColor: color });
            L.marker(latLng, { icon })
                .bindPopup(
                    `<b>${esc(poi.Naam)}</b><br>` +
                    `<span style="color:#666;">${esc(poi.Snelweg || "Onbekend")}</span>`
                )
                .addTo(this.mapInstance);
        });
    }

    createLegend() {
        const legend = L.control({ position: "bottomright" });
        legend.onAdd = () => {
            const div = L.DomUtil.create("div", "custom-legend");
            const labels = ["<strong>Legenda</strong>"];
            for (const [type, color] of Object.entries(TYPE_COLORS)) {
                labels.push(`<i style="background:${color}"></i> ${type.replace(/_/g, " ")}`);
            }
            labels.push('<i style="background:#d63e2a"></i> voorgestelde rustplaats');
            div.innerHTML = labels.join("<br>");
            return div;
        };
        legend.addTo(this.mapInstance);
    }
}
