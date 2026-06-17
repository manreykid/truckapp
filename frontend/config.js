// Resolve the backend API base URL for both local dev and Docker/production.
// Loaded as a classic script before script.js so window.API_BASE is ready.
(function () {
  "use strict";
  const { hostname, port } = window.location;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";

  if (isLocalhost && port === "8000") {
    // Local dev: frontend served by start.sh on :8000, backend on :8080.
    window.API_BASE = "http://localhost:8080/api";
  } else {
    // Docker / production: nginx serves these files and reverse-proxies
    // /api/* to the backend, so a same-origin relative path works.
    window.API_BASE = "/api";
  }
})();
