// Small shared helpers.

// Escape user-provided strings before they land in innerHTML.
export function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[c]);
}

// "2026-07-06T08:30" -> "2026-07-06 08:30"
export function fmtDateTime(value) {
    return value ? String(value).replace("T", " ") : "n.v.t.";
}

// Local datetime string for <input type="datetime-local">, rounded up to a
// quarter hour, offset by `plusMinutes`.
export function localDatetimeValue(plusMinutes = 60) {
    const d = new Date(Date.now() + plusMinutes * 60_000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
}
