// Application bootstrap.
//
// Authentication is a mock for now: the login button just opens the dashboard.
// Real auth (JWT) + per-company data isolation is a planned hardening step
// (see README -> Roadmap). Do NOT ship this as-is to a public server.
import { api } from "./api.js";
import { MapManager } from "./map.js";
import { UIManager } from "./ui.js";

const mapManager = new MapManager(api);
const ui = new UIManager(api, mapManager);

document.getElementById("login-button").onclick = () => ui.initDashboard();
document.getElementById("logout-button").onclick = () => ui.logout();
