// DOM rendering and event wiring.
import { attachAutocomplete } from "./autocomplete.js";
import { esc, fmtDateTime, localDatetimeValue } from "./utils.js";

const TRIP_STATUSES = ["Gepland", "Onderweg", "Afgerond", "Geannuleerd"];

export class UIManager {
    constructor(api, mapManager) {
        this.api = api;
        this.map = mapManager;

        this.map.onRoute = (info) => this.showRouteResults(info);
        this.map.onRouteError = (message) => {
            this.setLoading(false);
            alert(message);
        };

        // Exact coordinates of a chosen autocomplete suggestion; null means
        // the free-typed text will be geocoded via Nominatim as fallback.
        this.startPick = null;
        this.endPick = null;

        this.setupTheme();
        this.setupNavigation();
        this.setupForms();
        this.setupAutocomplete();
    }

    setupAutocomplete() {
        attachAutocomplete(document.getElementById("planner-start"), (pick) => {
            this.startPick = pick;
        });
        attachAutocomplete(document.getElementById("planner-end"), (pick) => {
            this.endPick = pick;
        });
    }

    // --- Chrome -------------------------------------------------------------

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
        document.getElementById("plan-route-button").onclick = () => this.planRoute();
        document.getElementById("save-trip-button").onclick = () => this.saveTrip();
    }

    setLoading(active) {
        document.getElementById("planner-loading").classList.toggle("hidden", !active);
    }

    // --- Route planning -----------------------------------------------------

    async planRoute() {
        const start = document.getElementById("planner-start").value.trim();
        const end = document.getElementById("planner-end").value.trim();
        const departure = document.getElementById("planner-departure").value;
        if (!start || !end) {
            alert("Vul zowel een startpunt als een bestemming in.");
            return;
        }

        document.getElementById("planner-results").classList.add("hidden");
        this.setLoading(true);
        try {
            const ok = await this.map.calculateRoute(
                start, end, departure, this.startPick, this.endPick
            );
            if (!ok) {
                this.setLoading(false);
                alert("Kan een van de adressen niet vinden. Voeg eventueel het land toe (bijv. 'Parijs, Frankrijk').");
            }
            // On success the result arrives via showRouteResults().
        } catch (error) {
            this.setLoading(false);
            console.error(error);
            alert("Er ging iets mis bij het ophalen van de coordinaten.");
        }
    }

    showRouteResults({ distanceKm, expectedMinutes, hasTrafficPenalty, restStops }) {
        this.setLoading(false);

        document.getElementById("route-summary-distance").innerHTML =
            `<strong>Afstand:</strong> ${distanceKm.toFixed(1)} km`;
        const hours = Math.floor(expectedMinutes / 60);
        const minutes = expectedMinutes % 60;
        document.getElementById("route-summary-time").innerHTML =
            `<strong>Verwachte reistijd:</strong> ${hours ? `${hours}u ` : ""}${minutes} min`;
        document.getElementById("route-traffic-warning").classList.toggle("hidden", !hasTrafficPenalty);

        const list = document.getElementById("rest-stop-list");
        list.innerHTML = "";
        if (!restStops.length) {
            list.innerHTML = "<li>Rit is kort genoeg (geen wettelijke rust vereist).</li>";
        } else {
            restStops.forEach((stop, i) => {
                const li = document.createElement("li");
                li.innerHTML =
                    `<strong>Pauze ${i + 1}</strong> na ca. ${stop.afterHours.toFixed(1)}u: ` +
                    `${esc(stop.poi.Naam)} (${esc(stop.poi.Snelweg || "?")})`;
                list.appendChild(li);
            });
        }

        document.getElementById("planner-results").classList.remove("hidden");
    }

    async saveTrip() {
        if (!this.map.currentRouteData) {
            alert("Plan eerst een route.");
            return;
        }
        const start = document.getElementById("planner-start").value.trim();
        const end = document.getElementById("planner-end").value.trim();
        const departureTime = document.getElementById("planner-departure").value;
        const vehicleId = document.getElementById("assign-vehicle").value;
        const driverId = document.getElementById("assign-driver").value;

        if (!departureTime || !vehicleId || !driverId) {
            alert("Selecteer een vertrektijd, voertuig en chauffeur.");
            return;
        }

        await this.api.addTrip({
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

    // Open a saved trip in the planner and re-run the route for it.
    showTripOnMap(trip) {
        // Programmatic .value changes fire no input event, so clear stale picks.
        this.startPick = null;
        this.endPick = null;
        document.getElementById("planner-start").value = trip.startLocation;
        document.getElementById("planner-end").value = trip.endLocation;
        if (trip.departureTime) {
            document.getElementById("planner-departure").value = trip.departureTime;
        }
        document.getElementById("show-planner-view").click();
        this.planRoute();
    }

    // --- Fleet forms ----------------------------------------------------------

    async addVehicle() {
        const licensePlate = document.getElementById("vehicle-plate").value.trim();
        const brand = document.getElementById("vehicle-brand").value.trim();
        const model = document.getElementById("vehicle-model").value.trim();
        if (!licensePlate || !brand) {
            alert("Kenteken en merk zijn verplicht.");
            return;
        }
        await this.api.addVehicle({ licensePlate, brand, model });
        ["vehicle-plate", "vehicle-brand", "vehicle-model"].forEach(
            (id) => (document.getElementById(id).value = "")
        );
        this.refreshAllLists();
    }

    async addDriver() {
        const firstName = document.getElementById("driver-firstname").value.trim();
        const lastName = document.getElementById("driver-lastname").value.trim();
        const employeeNumber = document.getElementById("driver-employeeId").value.trim();
        if (!firstName || !lastName) {
            alert("Voor- en achternaam zijn verplicht.");
            return;
        }
        await this.api.addDriver({ firstName, lastName, employeeNumber });
        ["driver-firstname", "driver-lastname", "driver-employeeId"].forEach(
            (id) => (document.getElementById(id).value = "")
        );
        this.refreshAllLists();
    }

    // --- Rendering ------------------------------------------------------------

    async refreshAllLists() {
        try {
            const [vehicles, drivers, trips, stats] = await Promise.all([
                this.api.getVehicles(),
                this.api.getDrivers(),
                this.api.getTrips(),
                this.api.getStats(),
            ]);
            this.renderStats(stats);
            this.renderVehicles(vehicles);
            this.renderDrivers(drivers);
            this.renderTrips(trips);
        } catch (error) {
            console.error("Kon lijsten niet verversen:", error);
        }
    }

    renderStats(stats) {
        const byStatus = stats.tripsByStatus || {};
        document.getElementById("stat-gepland").textContent = byStatus.Gepland ?? 0;
        document.getElementById("stat-onderweg").textContent = byStatus.Onderweg ?? 0;
        document.getElementById("stat-vehicles").textContent = stats.vehicles ?? 0;
        document.getElementById("stat-drivers").textContent = stats.drivers ?? 0;
    }

    renderVehicles(vehicles) {
        const list = document.getElementById("vehicles-list");
        const select = document.getElementById("assign-vehicle");
        list.innerHTML = "";
        select.innerHTML = '<option value="">-- Kies Voertuig --</option>';
        vehicles.forEach((v) => {
            const li = document.createElement("li");
            li.innerHTML = `<span><strong>${esc(v.licensePlate)}</strong> - ${esc(v.brand)} ${esc(v.model || "")}</span>`;
            li.appendChild(this.deleteButton(() => this.api.deleteVehicle(v.id)));
            list.appendChild(li);

            const option = document.createElement("option");
            option.value = v.id;
            option.textContent = `${v.licensePlate} (${v.brand})`;
            select.appendChild(option);
        });
    }

    renderDrivers(drivers) {
        const list = document.getElementById("drivers-list");
        const select = document.getElementById("assign-driver");
        list.innerHTML = "";
        select.innerHTML = '<option value="">-- Kies Chauffeur --</option>';
        drivers.forEach((d) => {
            const li = document.createElement("li");
            li.innerHTML = `<span><strong>${esc(d.firstName)} ${esc(d.lastName)}</strong> (Nr: ${esc(d.employeeNumber || "-")})</span>`;
            li.appendChild(this.deleteButton(() => this.api.deleteDriver(d.id)));
            list.appendChild(li);

            const option = document.createElement("option");
            option.value = d.id;
            option.textContent = `${d.firstName} ${d.lastName}`;
            select.appendChild(option);
        });
    }

    renderTrips(trips) {
        const list = document.getElementById("trips-list");
        list.innerHTML = "";

        if (!trips.length) {
            list.innerHTML = "<li>Nog geen ritten gepland. Plan een route via 'Nieuwe Rit Plannen'.</li>";
            return;
        }

        trips.forEach((t) => {
            const li = document.createElement("li");
            li.className = "trip-item";
            li.innerHTML = `
                <div class="trip-row">
                    <strong>${esc(t.tripName)}</strong>
                    <span class="status-badge status-${t.status.toLowerCase()}">${esc(t.status)}</span>
                </div>
                <div class="trip-meta">
                    <i class="fa fa-clock-o"></i> ${esc(fmtDateTime(t.departureTime))}
                    &nbsp;|&nbsp; <i class="fa fa-road"></i> ${t.distanceKm ?? "?"} km (~${t.expectedTimeMinutes ?? "?"} min)
                </div>
                <div class="trip-meta">
                    <i class="fa fa-truck"></i> ${esc(t.vehiclePlate || "Niet toegewezen")}
                    &nbsp;|&nbsp; <i class="fa fa-user"></i> ${esc(t.driverName || "Niet toegewezen")}
                </div>`;

            const actions = document.createElement("div");
            actions.className = "trip-actions";

            const statusSelect = document.createElement("select");
            statusSelect.className = "status-select";
            statusSelect.title = "Status wijzigen";
            TRIP_STATUSES.forEach((status) => {
                const option = document.createElement("option");
                option.value = status;
                option.textContent = status;
                option.selected = status === t.status;
                statusSelect.appendChild(option);
            });
            statusSelect.onchange = async () => {
                await this.api.updateTrip(t.id, { status: statusSelect.value });
                this.refreshAllLists();
            };
            actions.appendChild(statusSelect);

            const mapButton = document.createElement("button");
            mapButton.innerHTML = '<i class="fa fa-map-marker"></i> Toon op kaart';
            mapButton.onclick = () => this.showTripOnMap(t);
            actions.appendChild(mapButton);

            actions.appendChild(this.deleteButton(() => this.api.deleteTrip(t.id)));
            li.appendChild(actions);
            list.appendChild(li);
        });
    }

    deleteButton(deleteFn) {
        const btn = document.createElement("button");
        btn.className = "delete-btn";
        btn.title = "Verwijderen";
        btn.innerHTML = '<i class="fa fa-trash"></i>';
        btn.onclick = async () => {
            if (!confirm("Zeker weten verwijderen?")) return;
            await deleteFn();
            this.refreshAllLists();
        };
        return btn;
    }

    // --- Session ----------------------------------------------------------------

    initDashboard() {
        document.getElementById("auth-container").classList.add("hidden");
        document.getElementById("dashboard-container").classList.remove("hidden");
        document.getElementById("planner-departure").value = localDatetimeValue();
        try {
            this.map.init();
        } catch (error) {
            // A broken map must never take down the rest of the dashboard.
            console.error("Kaart-initialisatie mislukt:", error);
        }
        this.refreshAllLists();
    }

    logout() {
        document.getElementById("dashboard-container").classList.add("hidden");
        document.getElementById("auth-container").classList.remove("hidden");
    }
}
