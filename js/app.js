/**
 * Application Core Logic V3.4 (Global Language & PWA Onboarding)
 */

let currentTypeFilter = 'all';
let currentLevelFilter = 'all';
let lastSearchResults = [];

// PWA Install Prompt State
let deferredPrompt;

document.addEventListener('DOMContentLoaded', async () => {
    initPWAInstallLogic();

    if ('serviceWorker' in navigator) {
        try { await navigator.serviceWorker.register('sw.js'); }
        catch (e) { console.log('SW error:', e); }
    }

    if (document.querySelector('.dashboard-content')) {
        await loadDashboardStats();
        setupFileUpload();
        populateLanguageFilters();
        setupSearch();
        setupFilters();
    }
});

// ==========================================
// V3.4 PWA ONBOARDING LOGIC
// ==========================================
function initPWAInstallLogic() {
    const banner = document.getElementById('pwa-install-banner');
    const layout = document.getElementById('main-layout');
    const btnInstall = document.getElementById('btn-install-pwa');
    const btnDismiss = document.getElementById('btn-dismiss-install');
    const instructions = document.getElementById('install-instructions');

    if (!banner) return;

    // Detect if already installed / standalone
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isStandalone || localStorage.getItem('pwaDismissed')) {
        return; // Don't show if already installed or dismissed
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent default mini-infobar
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredPrompt = e;

        // Show our custom UI
        showBanner();
    });

    // If it's iOS, 'beforeinstallprompt' never fires. Show manual instructions.
    if (isIOS && !isStandalone) {
        instructions.textContent = "iOS/Safari için: 'Paylaş' butonuna bas ve 'Ana Ekrana Ekle'yi seç.";
        btnInstall.style.display = 'none'; // iOS has no programmatic trigger
        showBanner();
    }

    function showBanner() {
        banner.classList.remove('hidden');
        if (layout) layout.style.paddingTop = '80px';
    }

    btnInstall.addEventListener('click', async () => {
        banner.classList.add('hidden');
        if (layout) layout.style.paddingTop = '0';

        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                console.log('User accepted the PWA install prompt');
            }
            deferredPrompt = null;
        }
    });

    btnDismiss.addEventListener('click', () => {
        banner.classList.add('hidden');
        if (layout) layout.style.paddingTop = '0';
        localStorage.setItem('pwaDismissed', 'true');
    });
}


// ==========================================
// CORE DASHBOARD
// ==========================================
async function loadDashboardStats() {
    if (!window.dbAPI) return;

    const words = await window.dbAPI.getAllWords();
    const totalEl = document.getElementById('total-words');
    if (totalEl) totalEl.textContent = words.length;

    const db = await window.dbAPI.initDB();
    if (db) {
        const allBooks = await db.getAll('books');
        const shelf = document.getElementById('offline-books-grid');
        if (shelf && allBooks.length > 0) {
            shelf.innerHTML = '';
            allBooks.forEach(b => {
                const card = createBookCard(b.meta, true);
                card.addEventListener('click', () => openBook(b.id));
                shelf.appendChild(card);
            });
        }
    }
}

function createBookCard(meta, isOffline = false) {
    const div = document.createElement('div');
    div.className = 'book-card glass-panel cursor-pointer';

    let typeBadge = '';
    if (meta.type === 'combo') typeBadge = `<div class="audio-badge combo-badge">🎧+📖 Combo</div>`;
    else if (meta.type === 'audio') typeBadge = `<div class="audio-badge">🎧 Sesli</div>`;
    else if (meta.type === 'text') typeBadge = `<div class="audio-badge text-badge">📖 Metin</div>`;

    div.innerHTML = `
        <div class="book-cover" style="background-image: url('${meta.cover || 'assets/librivox-cover.png'}')">
             ${meta.language_level ? `<span class="level-badge">${meta.language_level.split(' ')[0]}</span>` : ''}
             ${typeBadge}
        </div>
        <div class="book-meta">
            <h4 class="book-title truncate">${meta.title}</h4>
            <p class="book-author truncate">${meta.author || 'Bilinmiyor'}</p>
            ${isOffline ? `<span style="font-size:0.7rem;color:var(--success);">İndirilmiş</span>` : ''}
        </div>
    `;
    return div;
}

function setupFileUpload() {
    const uploadInput = document.getElementById('epub-upload');
    if (!uploadInput) return;

    uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function (e) {
            const arrayBuffer = e.target.result;
            const bookId = `local_${Date.now()}`;

            const isPDF = file.name.toLowerCase().endsWith('.pdf');
            const metadata = {
                title: file.name.replace(/\.[^/.]+$/, ""),
                author: 'Yerel Dosya',
                type: isPDF ? 'pdf' : 'text'
            };

            await window.dbAPI.saveBook(bookId, arrayBuffer, metadata);
            openBook(bookId);
        };
        reader.readAsArrayBuffer(file);
    });
}

function openBook(bookId) {
    localStorage.setItem('activeBookId', bookId);
    window.location.href = 'reader.html';
}

// ==========================================
// SEARCH & FILTERS
// ==========================================

function populateLanguageFilters() {
    const container = document.getElementById('filter-lang');
    if (!container || !window.globals) return;

    const langs = window.globals.SUPPORTED_LANGS;
    const currentActive = window.globals.activeContentLang;

    for (const [key, langObj] of Object.entries(langs)) {
        const btn = document.createElement('button');
        btn.className = `btn filter-btn ${key === currentActive ? 'active' : ''}`;
        btn.setAttribute('data-val', key);
        btn.textContent = langObj.label;
        btn.onclick = () => {
            container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            window.globals.setContentLanguage(key);
            document.getElementById('search-results-grid').innerHTML = '<p class="empty-state">Dil değiştirildi. Lütfen yeniden arama yapın.</p>';
            lastSearchResults = [];
        };
        container.appendChild(btn);
    }
}

function setupFilters() {
    setupFilterGroup('filter-type', val => {
        currentTypeFilter = val;
        renderFilteredResults();
    });

    setupFilterGroup('filter-level', val => {
        currentLevelFilter = val;
        renderFilteredResults();
    });
}

function setupFilterGroup(groupId, onChange) {
    const container = document.getElementById(groupId);
    if (!container) return;
    const btns = container.querySelectorAll('.filter-btn');

    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            onChange(btn.getAttribute('data-val'));
        });
    });
}

let searchTimeout;
function setupSearch() {
    const input = document.getElementById('omni-search');
    const closeBtn = document.getElementById('close-search');
    const resultsContainer = document.getElementById('search-results-container');
    const spinner = document.getElementById('search-spinner');

    if (!input) return;

    input.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();

        if (query.length < 3) {
            resultsContainer.classList.add('hidden');
            return;
        }

        if (spinner) spinner.classList.remove('hidden');

        searchTimeout = setTimeout(async () => {
            lastSearchResults = await window.libraryAPI.searchCombined(query);

            if (spinner) spinner.classList.add('hidden');
            resultsContainer.classList.remove('hidden');

            renderFilteredResults();
        }, 800);
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            resultsContainer.classList.add('hidden');
            input.value = '';
        });
    }
}

function renderFilteredResults() {
    const resultsGrid = document.getElementById('search-results-grid');
    if (!resultsGrid) return;

    const filtered = lastSearchResults.filter(item => {
        if (currentTypeFilter !== 'all' && item.type !== currentTypeFilter) return false;
        if (currentLevelFilter !== 'all' && !item.language_level.includes(currentLevelFilter)) return false;
        return true;
    });

    resultsGrid.innerHTML = '';

    if (filtered.length === 0) {
        resultsGrid.innerHTML = '<p class="empty-state">Bu dilde / filtrede eşleşen sonuç bulunamadı.</p>';
    } else {
        filtered.forEach(meta => {
            const card = createBookCard(meta);
            card.addEventListener('click', () => setupNetworkReader(meta));
            resultsGrid.appendChild(card);
        });
    }
}

async function setupNetworkReader(meta) {
    const bookId = `net_${Date.now()}`;
    await window.dbAPI.saveBook(bookId, null, meta);
    openBook(bookId);
}
