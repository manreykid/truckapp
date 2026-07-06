// Thin typed wrapper around the backend REST API.
// window.API_BASE is set by config.js (classic script, runs first).

const API_BASE = window.API_BASE || "http://localhost:8080/api";

class ApiClient {
    async request(endpoint, method = "GET", body = null) {
        const options = { method, headers: { "Content-Type": "application/json" } };
        if (body) options.body = JSON.stringify(body);

        const response = await fetch(`${API_BASE}/${endpoint}`, options);
        if (!response.ok) {
            throw new Error(`API ${method} ${endpoint} faalde: ${response.status}`);
        }
        return response.status === 204 ? null : response.json();
    }

    getPois() { return this.request("pois"); }
    getStats() { return this.request("stats"); }

    getVehicles() { return this.request("vehicles"); }
    addVehicle(data) { return this.request("vehicles", "POST", data); }
    deleteVehicle(id) { return this.request(`vehicles/${id}`, "DELETE"); }

    getDrivers() { return this.request("drivers"); }
    addDriver(data) { return this.request("drivers", "POST", data); }
    deleteDriver(id) { return this.request(`drivers/${id}`, "DELETE"); }

    getTrips() { return this.request("trips"); }
    addTrip(data) { return this.request("trips", "POST", data); }
    updateTrip(id, patch) { return this.request(`trips/${id}`, "PATCH", patch); }
    deleteTrip(id) { return this.request(`trips/${id}`, "DELETE"); }
}

export const api = new ApiClient();
