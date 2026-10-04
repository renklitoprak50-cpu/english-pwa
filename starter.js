// Hazır kitaplar rafı: /books/ klasöründeki EPUB dosyalarını proxy olmadan açar.
(function () {
  const cover = (title) => {
    const t = title.replace(/[<>&"]/g, "").slice(0, 38);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" fill="#1E3A8A"/><rect x="18" y="18" width="264" height="384" fill="none" stroke="#93C5FD" stroke-width="3"/><foreignObject x="34" y="120" width="232" height="200"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#fff;font:bold 26px Georgia,serif;text-align:center">${t}</div></foreignObject></svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  };

  async function exists(url) {
    try {
      const r = await fetch(url, { method: "HEAD" });
      return r.ok && !(r.headers.get("content-type") || "").includes("text/html");
    } catch { return false; }
  }

  async function openStarter(meta) {
    const bookId = "starter_" + meta.id;
    const have = await window.dbAPI.getBook(bookId);
    if (!(have && have.data)) {
      const res = await fetch(meta.file);
      if (!res.ok) throw new Error("Kitap dosyası alınamadı: " + res.status);
      await window.dbAPI.saveBook(bookId, await res.arrayBuffer(), {
        title: meta.title, author: meta.author, type: "text", language_level: meta.level, isStarter: true,
      });
    }
    openBook(bookId);
  }

  async function init() {
    const shelves = document.getElementById("shelves-container");
    if (!shelves || typeof createBookCard !== "function" || !window.dbAPI) return;
    let catalog;
    try { catalog = await (await fetch("/books/catalog.json")).json(); } catch { return; }
    const ready = (await Promise.all(catalog.map(async (b) => ((await exists(b.file)) ? b : null)))).filter(Boolean);
    if (!ready.length) return;

    const row = document.createElement("div");
    row.className = "shelf-row";
    row.innerHTML = '<div class="shelf-header">📚 Hazır Kitaplar</div><div class="shelf-books"></div>';
    const box = row.querySelector(".shelf-books");
    ready.forEach((b) => {
      const meta = { id: b.id, title: b.title, author: b.author, type: "text", language_level: b.level, cover: cover(b.title) };
      const card = createBookCard(meta, false, true);
      card.addEventListener("click", async () => {
        try { await openStarter(b); } catch (e) { console.error(e); alert("Kitap açılamadı. Bağlantını kontrol et."); }
      });
      box.appendChild(card);
    });
    shelves.parentNode.insertBefore(row, shelves);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
