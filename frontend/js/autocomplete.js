// Address autocomplete (search-as-you-type) for the route planner.
//
// Uses Photon (photon.komoot.io), the OSM-based geocoder that explicitly
// supports autocomplete. Nominatim's usage policy forbids autocomplete
// against their public server, so Nominatim remains the fallback for
// free-typed text only (one request per route calculation).
//
// A selected suggestion carries exact coordinates, so street-level
// addresses route precisely without a second geocoding round-trip.

const PHOTON_URL = "https://photon.komoot.io/api/";
const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;
// Light bias toward the Netherlands so Dutch streets rank first;
// foreign destinations (Parijs, Berlijn) still show up fine.
const BIAS = "&lat=52.2&lon=5.3";

function buildLabel(props) {
    const line1 = [props.name || props.street, props.housenumber].filter(Boolean).join(" ");
    const place = props.city || props.town || props.village;
    return [line1, place, props.country].filter(Boolean).join(", ");
}

// Attach a suggestion dropdown to a text input. The input must live inside
// a position:relative wrapper (.ac-wrap). `onSelect` receives
// {label, lat, lon} when the user picks a suggestion, or null whenever the
// text is edited afterwards (the pick is then stale).
export function attachAutocomplete(input, onSelect) {
    const list = document.createElement("ul");
    list.className = "ac-list hidden";
    list.setAttribute("role", "listbox");
    input.parentElement.appendChild(list);

    input.setAttribute("autocomplete", "off");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");

    let items = [];
    let activeIndex = -1;
    let timer = null;
    let controller = null;

    function close() {
        list.classList.add("hidden");
        list.innerHTML = "";
        items = [];
        activeIndex = -1;
        input.setAttribute("aria-expanded", "false");
    }

    function choose(index) {
        const item = items[index];
        if (!item) return;
        input.value = item.label;
        onSelect(item);
        close();
    }

    function render() {
        list.innerHTML = "";
        if (!items.length) {
            close();
            return;
        }
        items.forEach((item, index) => {
            const li = document.createElement("li");
            li.setAttribute("role", "option");
            li.textContent = item.label;
            // mousedown ipv click: vuurt voor de blur van het input-veld.
            li.addEventListener("mousedown", (e) => {
                e.preventDefault();
                choose(index);
            });
            list.appendChild(li);
        });
        list.classList.remove("hidden");
        input.setAttribute("aria-expanded", "true");
    }

    function highlight() {
        [...list.children].forEach((li, index) =>
            li.classList.toggle("active", index === activeIndex)
        );
    }

    async function search(query) {
        controller?.abort();
        controller = new AbortController();
        try {
            const res = await fetch(
                `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=5${BIAS}`,
                { signal: controller.signal }
            );
            const data = await res.json();
            items = (data.features || [])
                .map((f) => ({
                    label: buildLabel(f.properties || {}),
                    lat: f.geometry?.coordinates?.[1],
                    lon: f.geometry?.coordinates?.[0],
                }))
                .filter((i) => i.label && Number.isFinite(i.lat) && Number.isFinite(i.lon));
            activeIndex = -1;
            render();
        } catch (error) {
            if (error.name !== "AbortError") {
                console.warn("Autocomplete niet beschikbaar:", error.message);
                close();
            }
        }
    }

    input.addEventListener("input", () => {
        onSelect(null); // tekst gewijzigd -> eerdere keuze is niet meer geldig
        clearTimeout(timer);
        const query = input.value.trim();
        if (query.length < MIN_CHARS) {
            close();
            return;
        }
        timer = setTimeout(() => search(query), DEBOUNCE_MS);
    });

    input.addEventListener("keydown", (e) => {
        if (list.classList.contains("hidden")) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            activeIndex = Math.min(activeIndex + 1, items.length - 1);
            highlight();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            highlight();
        } else if (e.key === "Enter" && activeIndex >= 0) {
            e.preventDefault();
            choose(activeIndex);
        } else if (e.key === "Escape") {
            close();
        }
    });

    input.addEventListener("blur", () => setTimeout(close, 150));
}
