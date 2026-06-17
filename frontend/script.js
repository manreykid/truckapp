// ============================================================================
// Truck App - frontend logic (vanilla JS, no build step).
//
// Talks to the local FastAPI backend. window.API_BASE is set by config.js.
// ============================================================================

const API_BASE = window.API_BASE || "http://localhost:8080/api";

// Used only when the backend is unreachable, so the map is never empty.
// NOTE: coordinates are plain decimal degrees (floats) - the same format the
// backend serves. The old "integer + divide by a power of ten" scheme is gone.
const FALLBACK_POIS = [
    { Naam: "Honswijck", Snelweg: "A1", Type: "poi_snelweg", Latitude: 52.3205346, Longitude: 5.0792278 },
    { Naam: "Hackelaar", Snelweg: "A1", Type: "poi_snelweg", Latitude: 52.3221142, Longitude: 5.0827356 },
    { Naam: "Ronduit", Snelweg: "A1", Type: "poi_snelweg", Latitude: 52.294336, Longitude: 5.1769962 },
    { Naam: "Bastion", Snelweg: "A1", Type: "poi_snelweg", Latitude: 52.2953673, Longitude: 5.177806 },
    { Naam: "De Hucht", Snelweg: "A1", Type: "poi_snelweg", Latitude: 52.1854214, Longitude: 5.8905158 },
];

// ============================================================================
// DATA LAYER - thin wrapper around the REST API
// ============================================================================
class LocalDBManager {
    async fetchAPI(endpoint, method = "GET", body = null) {
        const options = { method, headers: { "Content-Type": "application/json" } };
        if (body) options.body = JSON.stringify(body);

        const response = await fetch(`${API_BASE}/${endpoint}`, options);
        if (!response.ok) {
            throw new Error(`API ${method} ${endpoint} faalde: ${response.status}`);
        }
        // DELETE returns 204 No Content.
        return response.status === 204 ? null : await response.json();
    }

    getDocuments(collection) {
        return this.fetchAPI(collection);
    }

    addDocument(collection, data) {
        return this.fetchAPI(collection, "POST", data);
    }

    updateDocument(collection, id, data) {
        return this.fetchAPI(`${collection}/${id}`, "PATCH", data);
    }

    deleteDocument(collection, id) {
        return this.fetchAPI(`${collection}/${id}`, "DELETE");
    }
}

// ============================================================================
// MAP & ROUTING
// ============================================================================
const TYPE_COLORS = { poi_snelweg: "blue", restaurant: "green", truckstop: "red", bedrijf: "orange" };
const MAX_DRIVING_SECONDS = 4.5 * 3600; // EU rule: 4.5h driving before a break.

class MapManager {
    constructor(dbManager) {
        this.dbManager = dbManager;
        this.mapInstance = null;
        this.routingControl = null;
        this.allPois = [];
        this.currentRouteData = null;
        this.isInitialized = false;
    }

    init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.mapInstance = L.map("map").setView([52.1326, 5.2913], 7);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap",
        }).addTo(this.mapInstance);

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
            this.hideLoading();
            alert("Er kon geen route worden berekend. Probeer specifiekere plaatsnamen.");
        });

        this.createLegend();
        this.loadPOIs();
        setTimeout(() => this.mapInstance.invalidateSize(), 100);
    }

    hideLoading() {
        document.getElementById("planner-loading").classList.add("hidden");
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

    async calculateRoute(startAddress, endAddress) {
        const loading = document.getElementById("planner-loading");
        document.getElementById("planner-results").classList.add("hidden");
        loading.classList.remove("hidden");

        try {
            const [start, end] = await Promise.all([
                this.geocodeAddress(startAddress),
                this.geocodeAddress(endAddress),
            ]);

            if (start && end) {
                this.routingControl.setWaypoints([
                    L.latLng(start.lat, start.lng),
                    L.latLng(end.lat, end.lng),
                ]);
                // 'routesfound' / 'routingerror' hides the loader from here.
            } else {
                this.hideLoading();
                alert("Kan een van de adressen niet vinden. Voeg eventueel het land toe (bijv. 'Parijs, Frankrijk').");
            }
        } catch (error) {
            this.hideLoading();
            console.error(error);
            alert("Er ging iets mis bij het ophalen van de coordinaten.");
        }
    }

    // Dutch rush-hour heuristic: OSRM has no live traffic, so we add a penalty
    // when the planned departure falls in the morning/evening peak on a weekday.
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
        this.hideLoading();

        const route = e.routes[0];
        const departureStr = document.getElementById("planner-departure").value;
        const distanceKm = route.summary.totalDistance / 1000;

        const traffic = this.calculateTrafficPenalty(route.summary.totalTime, departureStr);
        const expectedMinutes = Math.round(traffic.time / 60);

        document.getElementById("route-summary-distance").innerHTML =
            `<strong>Afstand:</strong> ${distanceKm.toFixed(1)} km`;
        document.getElementById("route-summary-time").innerHTML =
            `<strong>Verwachte reistijd:</strong> ${expectedMinutes} min`;
        document
            .getElementById("route-traffic-warning")
            .classList.toggle("hidden", !traffic.hasPenalty);

        this.currentRouteData = {
            distanceKm: Number(distanceKm.toFixed(1)),
            expectedTimeMinutes: expectedMinutes,
        };

        const stop = this.predictRestStop(route);
        document.getElementById("rest-stop-suggestion").textContent = stop
            ? `${stop.poi.Naam} (na ca. ${stop.driveTimeHours.toFixed(1)}u rijden)`
            : "Rit is kort genoeg (geen wettelijke rust vereist).";

        document.getElementById("planner-results").classList.remove("hidden");
    }

    // Find the POI nearest to the point reached after 4.5h of driving.
    predictRestStop(route) {
        if (route.summary.totalTime <= MAX_DRIVING_SECONDS) return null;
        if (!this.allPois.length) return null;

        let elapsed = 0;
        let targetIndex = -1;
        for (const step of route.instructions || []) {
            elapsed += step.time;
            if (elapsed >= MAX_DRIVING_SECONDS) {
                targetIndex = step.index;
                break;
            }
        }
        if (targetIndex < 0 || !route.coordinates[targetIndex]) return null;

        const target = L.latLng(route.coordinates[targetIndex]);
        let best = null;
        let minDistance = Infinity;
        for (const poi of this.allPois) {
            const ll = this.parseCoordinates(poi);
            if (!ll) continue;
            const distance = target.distanceTo(ll);
            if (distance < minDistance) {
                minDistance = distance;
                best = { poi, driveTimeHours: elapsed / 3600 };
            }
        }
        return best;
    }

    async loadPOIs() {
        try {
            this.allPois = await this.dbManager.getDocuments("pois");
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
                .bindPopup(`<b>${poi.Naam}</b><br><span style="color:#666;">${poi.Snelweg || "Onbekend"}</span>`)
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
            div.innerHTML = labels.join("<br>");
            return div;
        };
        legend.addTo(this.mapInstance);
    }
}

// ============================================================================
// UI
// ============================================================================
class UIManager {
    constructor(dbManager, mapManager) {
        this.db = dbManager;
        this.map = mapManager;
        this.setupTheme();
        this.setupNavigation();
        this.setupForms();
    }

    setupTheme() {
        const checkbox = document.getElementById("theme-checkbox");
        if (localStorage.getItem("theme") === "dark") {
            document.body.classList.add("dark-theme");
            checkbox.checked = true;
        }
        checkbox.addEventListener("change", () => {
            const dark = checkbox.checked;
            document.body.classList.toggle("dark-theme", dark);
            localStorage.setItem("theme", dark ? "dark" : "light");
        });
    }

    setupNavigation() {
        const ids = ["planner", "trips", "vehicles", "drivers"];
        const buttons = ids.map((id) => document.getElementById(`show-${id}-view`));
        const views = document.querySelectorAll(".view");

        buttons.forEach((btn) => {
            btn.addEventListener("click", () => {
                const target = btn.id.replace("show-", "");
                views.forEach((v) => v.classList.add("hidden"));
                document.getElementById(target).classList.remove("hidden");
                buttons.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                if (btn.id === "show-planner-view" && this.map.mapInstance) {
                    setTimeout(() => this.map.mapInstance.invalidateSize(), 100);
                }
            });
        });
    }

    setupForms() {
        document.getElementById("add-vehicle-button").onclick = () => this.addVehicle();
        document.getElementById("add-driver-button").onclick = () => this.addDriver();
        document.getElementById("refresh-trips-button").onclick = () => this.refreshAllLists();
        document.getElementById("plan-route-button").onclick = () => {
            const start = document.getElementById("planner-start").value.trim();
            const end = document.getElementById("planner-end").value.trim();
            if (start && end) this.map.calculateRoute(start, end);
            else alert("Vul zowel een startpunt als een bestemming in.");
        };
        document.getElementById("save-trip-button").onclick = () => this.saveTrip();
    }

    async addVehicle() {
        const licensePlate = document.getElementById("vehicle-plate").value.trim();
        const brand = document.getElementById("vehicle-brand").value.trim();
        const model = document.getElementById("vehicle-model").value.trim();
        if (!licensePlate || !brand) return alert("Kenteken en merk zijn verplicht.");
        await this.db.addDocument("vehicles", { licensePlate, brand, model });
        ["vehicle-plate", "vehicle-brand", "vehicle-model"].forEach((id) => (document.getElementById(id).value = ""));
        this.refreshAllLists();
    }

    async addDriver() {
        const firstName = document.getElementById("driver-firstname").value.trim();
        const lastName = document.getElementById("driver-lastname").value.trim();
        const employeeNumber = document.getElementById("driver-employeeId").value.trim();
        if (!firstName || !lastName) return alert("Voor- en achternaam zijn verplicht.");
        await this.db.addDocument("drivers", { firstName, lastName, employeeNumber });
        ["driver-firstname", "driver-lastname", "driver-employeeId"].forEach((id) => (document.getElementById(id).value = ""));
        this.refreshAllLists();
    }

    async saveTrip() {
        if (!this.map.currentRouteData) return alert("Plan eerst een route.");
        const start = document.getElementById("planner-start").value.trim();
        const end = document.getElementById("planner-end").value.trim();
        const departureTime = document.getElementById("planner-departure").value;
        const vehicleId = document.getElementById("assign-vehicle").value;
        const driverId = document.getElementById("assign-driver").value;

        if (!departureTime || !vehicleId || !driverId) {
            return alert("Selecteer een vertrektijd, voertuig en chauffeur.");
        }

        await this.db.addDocument("trips", {
            tripName: `Van ${start} naar ${end}`,
            startLocation: start,
            endLocation: end,
            departureTime,
            status: "Gepland",
            expectedTimeMinutes: this.map.currentRouteData.expectedTimeMinutes,
            distanceKm: this.map.currentRouteData.distanceKm,
            vehicleId: Number(vehicleId),
            driverId: Number(driverId),
        });

        alert("Rit succesvol gepland en toegewezen!");
        document.getElementById("planner-results").classList.add("hidden");
        document.getElementById("show-trips-view").click();
        this.refreshAllLists();
    }

    async refreshAllLists() {
        const [vehicles, drivers, trips] = await Promise.all([
            this.db.getDocuments("vehicles"),
            this.db.getDocuments("drivers"),
            this.db.getDocuments("trips"),
        ]);
        this.renderVehicles(vehicles);
        this.renderDrivers(drivers);
        this.renderTrips(trips, vehicles, drivers);
    }

    renderVehicles(vehicles) {
        const list = document.getElementById("vehicles-list");
        const select = document.getElementById("assign-vehicle");
        list.innerHTML = "";
        select.innerHTML = '<option value="">-- Kies Voertuig --</option>';
        vehicles.forEach((v) => {
            const li = document.createElement("li");
            li.innerHTML = `<span><strong>${v.licensePlate}</strong> - ${v.brand} ${v.model || ""}</span>`;
            li.appendChild(this.deleteButton("vehicles", v.id));
            list.appendChild(li);
            select.insertAdjacentHTML("beforeend", `<option value="${v.id}">${v.licensePlate} (${v.brand})</option>`);
        });
    }

    renderDrivers(drivers) {
        const list = document.getElementById("drivers-list");
        const select = document.getElementById("assign-driver");
        list.innerHTML = "";
        select.innerHTML = '<option value="">-- Kies Chauffeur --</option>';
        drivers.forEach((d) => {
            const li = document.createElement("li");
            li.innerHTML = `<span><strong>${d.firstName} ${d.lastName}</strong> (Nr: ${d.employeeNumber || "-"})</span>`;
            li.appendChild(this.deleteButton("drivers", d.id));
            list.appendChild(li);
            select.insertAdjacentHTML("beforeend", `<option value="${d.id}">${d.firstName} ${d.lastName}</option>`);
        });
    }

    renderTrips(trips, vehicles, drivers) {
        const list = document.getElementById("trips-list");
        list.innerHTML = "";
        trips.forEach((t) => {
            const vehicle = vehicles.find((v) => v.id === t.vehicleId);
            const driver = drivers.find((d) => d.id === t.driverId);
            const li = document.createElement("li");
            li.style.cssText = "flex-direction: column; align-items: flex-start; gap: 5px;";
            li.innerHTML = `
                <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                    <strong>${t.tripName}</strong>
                    <span style="background:var(--button-bg-color); color:white; padding:3px 8px; border-radius:12px; font-size:12px;">${t.status}</span>
                </div>
                <div style="font-size:13px; color:var(--text-secondary-color);">
                    <i class="fa fa-clock-o"></i> ${(t.departureTime || "n.v.t.").replace("T", " ")}
                    &nbsp;|&nbsp; <i class="fa fa-road"></i> ${t.distanceKm ?? "?"} km (~${t.expectedTimeMinutes ?? "?"} min)
                </div>
                <div style="font-size:13px; color:var(--text-secondary-color);">
                    <i class="fa fa-truck"></i> ${vehicle ? vehicle.licensePlate : "Onbekend"}
                    &nbsp;|&nbsp; <i class="fa fa-user"></i> ${driver ? `${driver.firstName} ${driver.lastName}` : "Onbekend"}
                </div>`;
            list.appendChild(li);
        });
    }

    deleteButton(collection, id) {
        const wrapper = document.createElement("div");
        wrapper.className = "item-actions";
        const btn = document.createElement("button");
        btn.className = "delete-btn";
        btn.title = "Verwijderen";
        btn.innerHTML = '<i class="fa fa-trash"></i>';
        btn.onclick = async () => {
            if (!confirm("Zeker weten verwijderen?")) return;
            await this.db.deleteDocument(collection, id);
            this.refreshAllLists();
        };
        wrapper.appendChild(btn);
        return wrapper;
    }

    initDashboard() {
        document.getElementById("auth-container").classList.add("hidden");
        document.getElementById("dashboard-container").classList.remove("hidden");
        this.map.init();
        this.refreshAllLists();
    }
}

// ============================================================================
// BOOTSTRAP
//
// Authentication is a mock for now: the login button just opens the dashboard.
// Real auth (JWT) + per-company data isolation is a planned hardening step
// (see README -> Roadmap). Do NOT ship this as-is to a public server.
// ============================================================================
const db = new LocalDBManager();
const mapManager = new MapManager(db);
const ui = new UIManager(db, mapManager);

document.getElementById("login-button").onclick = () => ui.initDashboard();
document.getElementById("logout-button").onclick = () => {
    document.getElementById("dashboard-container").classList.add("hidden");
    document.getElementById("auth-container").classList.remove("hidden");
};
