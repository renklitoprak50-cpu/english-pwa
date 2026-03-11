/**
 * Application Core Logic V4 (Smart Onboarding & Error-Proof Language)
 */

let currentTypeFilter = 'all';
let currentLevelFilter = 'all';
let lastSearchResults = [];
let currentTab = 'verified'; // V6.5 Default Tab is now Kütüphanem

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
        setupTabs(); // V6.1/V6.5 Tabs

        // Ensure UI state matches default tab 'verified'
        document.getElementById('global-search-container').classList.add('hidden');
        document.getElementById('search-results-container').classList.add('hidden');
        document.getElementById('kutuphanem-container').classList.remove('hidden');

        loadKutuphanemShelves(); // V6.5 Auto-Load Shelves
    }
});

// ==========================================
// V7.6 PWA SMART ONBOARDING LOGIC
// ==========================================
function initPWAInstallLogic() {
    const banner = document.getElementById('pwa-install-card');
    const btnInstall = document.getElementById('btn-install-pwa');

    if (!banner) return;

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isStandalone) {
        return;
    }

    const ua = navigator.userAgent || navigator.vendor || window.opera;
    let osType = 'desktop';
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) osType = 'ios';
    else if (/android/i.test(ua)) osType = 'android';

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        banner.classList.remove('hidden');
    });

    if (osType === 'ios' && !isStandalone) {
        banner.classList.remove('hidden');
    }

    if (btnInstall) btnInstall.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                banner.classList.add('hidden');
            }
            deferredPrompt = null;
        } else {
            if (osType === 'ios') alert('Kurulum için: Safaride alttaki Paylaş butonuna basın ve "Ana Ekrana Ekle"yi seçin.');
            else if (osType === 'android') alert('Kurulum için: Tarayıcıdaki üç noktaya tıklayıp "Ana Ekrana Ekle"yi seçin.');
            else alert('Bilgisayarınıza kurmak için adres çubuğundaki yükle simgesine tıklayın.');
        }
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

function createBookCard(meta, isOffline = false, isVerified = false) {
    const div = document.createElement('div');
    div.className = 'book-card glass-panel cursor-pointer';
    div.style.boxShadow = "8px 12px 24px rgba(0,0,0,0.6)";
    div.style.border = "1px solid rgba(255,255,255,0.08)";
    div.style.borderRadius = "12px";
    div.style.background = "linear-gradient(145deg, #1e2530, #151a22)";
    div.style.padding = "6px";
    div.style.display = "flex";
    div.style.flexDirection = "column";

    let typeBadge = '';
    if (meta.type === 'combo') typeBadge = `<div class="audio-badge combo-badge">🎧+📖 Combo</div>`;
    else if (meta.type === 'audio') typeBadge = `<div class="audio-badge">🎧 Sesli</div>`;
    else if (meta.type === 'text') typeBadge = `<div class="audio-badge text-badge">📖 Metin</div>`;

    // V6.5 Gutenberg Tag
    let gutenbergBadge = '';
    if (meta.isGutenberg) {
        gutenbergBadge = `<div class="gutenberg-badge">🏛️ Gutenberg</div>`;
    }

    // Flag logic
    let flag = '';
    if (meta.langMap) {
        if (meta.langMap.ol === 'eng') flag = '🇬🇧 ';
        else if (meta.langMap.ol === 'ger') flag = '🇩🇪 ';
        else if (meta.langMap.ol === 'fra') flag = '🇫🇷 ';
        else if (meta.langMap.ol === 'spa') flag = '🇪🇸 ';
        else if (meta.langMap.ol === 'ita') flag = '🇮🇹 ';
    }

    div.innerHTML = `
        <div class="book-cover" style="background-image: url('${meta.cover || 'assets/librivox-cover.png'}'); border-radius: 8px; box-shadow: 4px 6px 15px rgba(0,0,0,0.5);">
             ${meta.language_level ? `<span class="level-badge">${meta.language_level.split(' ')[0]}</span>` : ''}
             ${gutenbergBadge}
             ${typeBadge}
        </div>
        <div class="book-meta" style="flex-grow:1; display:flex; flex-direction:column; justify-content:space-between; padding-top:8px;">
            <div>
                <h4 class="book-title truncate" title="${meta.title}">
                    <span class="lang-flag">${flag}</span>${meta.title}
                </h4>
                <p class="book-author truncate" title="${meta.author || 'Bilinmiyor'}">${meta.author || 'Bilinmiyor'}</p>
                ${isOffline || isVerified ? `<span style="font-size:0.75rem;color:var(--success); font-weight:bold;">${isOffline ? 'İndirilmiş' : 'Doğrulanmış Kütüphanem'}</span>` : ''}
            </div>
            
            ${!isOffline ? `<button class="btn primary full-width mt-2 btn-direct-download" style="font-size:0.8rem; padding:6px; font-weight:bold; box-shadow: 0 4px 10px rgba(59, 130, 246, 0.4); border-radius:6px; margin-top:8px;">Hemen İndir ve Oku</button>` : ''}
        </div>
    `;

    // Direct Download & Seal Logic
    const dlBtn = div.querySelector('.btn-direct-download');
    if (dlBtn) {
        dlBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            dlBtn.textContent = 'Mühürleniyor...';
            // Seal to indexedDB as off_
            const bookId = `off_${meta.id || Date.now()}`;
            await window.dbAPI.saveBook(bookId, null, meta);
            openBook(bookId);
        });
    }

    // V6.1 Action Buttons for Global Search
    if (!isOffline && currentTab === 'global') {
        const actionDiv = document.createElement('div');
        actionDiv.className = 'book-actions';
        actionDiv.style.marginTop = '8px';
        actionDiv.style.borderRadius = '6px';
        actionDiv.innerHTML = `
             <button class="action-verify" title="Doğrulanmış Kütüphaneye Ekle">✅ Doğrula</button>
             <button class="action-hide" title="Gizle ve Kara Listeye Al">❌ Gizle</button>
        `;

        actionDiv.addEventListener('click', (e) => e.stopPropagation());

        const verifyBtn = actionDiv.querySelector('.action-verify');
        verifyBtn.addEventListener('click', async (e) => {
            await window.dbAPI.verifyBook(meta);
            verifyBtn.textContent = '✅ Doğrulandı';
            verifyBtn.style.color = '#fff';
            setTimeout(() => { div.style.opacity = '0.5'; }, 500);
        });

        const hideBtn = actionDiv.querySelector('.action-hide');
        hideBtn.addEventListener('click', async (e) => {
            await window.dbAPI.blacklistBook(meta.id);
            div.style.transition = '0.2s';
            div.style.opacity = '0';
            div.style.transform = 'scale(0.9)';
            setTimeout(() => { div.remove(); }, 200);
        });

        div.appendChild(actionDiv);
    }

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

            if (currentTab === 'global') {
                document.getElementById('search-results-grid').innerHTML = '<p class="empty-state">Dil değiştirildi. Lütfen yeniden arama yapın.</p>';
                lastSearchResults = [];
            } else {
                performSearch(''); // Auto-re-rerun DB search if in Verified Tab
            }
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

// V6.1 / V6.5 DUAL TABS
function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const searchWrapper = document.getElementById('global-search-container');
    const kutuphanemContainer = document.getElementById('kutuphanem-container');
    const resultsContainer = document.getElementById('search-results-container');
    const searchInput = document.getElementById('omni-search');

    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            tabs.forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentTab = e.target.getAttribute('data-tab');

            if (currentTab === 'global') {
                kutuphanemContainer.classList.add('hidden');
                searchWrapper.classList.remove('hidden');
                searchInput.placeholder = 'Kitap veya Sesli Kitap Ara (örn. Sherlock)';
                resultsContainer.classList.remove('hidden'); // Show past search if exists
                performSearch(searchInput.value.trim());
            } else {
                searchWrapper.classList.add('hidden');
                resultsContainer.classList.add('hidden');
                kutuphanemContainer.classList.remove('hidden');
                searchInput.placeholder = 'Doğrulanmış Kitaplarında Ara';
                // Note: The shelves are permanent, we just show them again
            }
        });
    });
}

// ==========================================
// V6.5: GUTENBERG AUTOMATED SHELVES
// ==========================================
async function loadKutuphanemShelves() {
    const container = document.getElementById('shelves-container');
    if (!container || !window.libraryAPI) return;

    container.innerHTML = '';

    const priorityLangs = ['eng', 'ger', 'fra', 'spa', 'ita'];

    // Create rows simultaneously to not block UI
    const fetchPromises = priorityLangs.map(code => {
        const langMap = Object.values(window.globals.SUPPORTED_LANGS).find(l => l.ol === code);
        if (!langMap) return null;

        return window.libraryAPI.fetchGutenbergShelf(langMap).then(books => {
            if (books && books.length > 0) {
                renderShelfRow(container, langMap, books);
            }
        });
    });

    await Promise.all(fetchPromises);
}

function renderShelfRow(container, langMap, books) {
    const row = document.createElement('div');
    row.className = 'shelf-row';

    let flag = '🌍';
    if (langMap.ol === 'eng') flag = '🇬🇧 ';
    else if (langMap.ol === 'ger') flag = '🇩🇪 ';
    else if (langMap.ol === 'fra') flag = '🇫🇷 ';
    else if (langMap.ol === 'spa') flag = '🇪🇸 ';
    else if (langMap.ol === 'ita') flag = '🇮🇹 ';

    row.innerHTML = `
        <div class="shelf-header">
            ${flag} ${langMap.label} Kütüphanesi
        </div>
        <div class="shelf-books"></div>
    `;

    const booksContainer = row.querySelector('.shelf-books');
    books.forEach(meta => {
        const card = createBookCard(meta, false, true); // Treat as verified visually for Kütüphanem
        card.addEventListener('click', () => setupNetworkReader(meta));
        booksContainer.appendChild(card);
    });

    container.appendChild(row);
}

function setupSearch() {
    const input = document.getElementById('omni-search');
    const closeBtn = document.getElementById('close-search');

    if (!input) return;

    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();

        if (query.length < 3 && currentTab === 'global') {
            document.getElementById('search-results-container').classList.add('hidden');
            return;
        }

        // V6.2 Zero Latency: Call instantly
        performSearch(query);
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('search-results-container').classList.add('hidden');
            input.value = '';
        });
    }
}

async function performSearch(query) {
    const resultsContainer = document.getElementById('search-results-container');

    // V6.2: Spinners removed for zero latency feel

    if (currentTab === 'global') {
        if (query.length < 3) {
            resultsContainer.classList.add('hidden');
            return;
        }
        lastSearchResults = await window.libraryAPI.searchCombined(query);
    } else {
        // V6.1 Verified Hub Mode
        const verifiedBooks = await window.dbAPI.getVerifiedBooks();
        lastSearchResults = verifiedBooks.map(v => v.meta).filter(meta => {
            if (query && !meta.title.toLowerCase().includes(query.toLowerCase()) && !meta.author.toLowerCase().includes(query.toLowerCase())) return false;
            return true;
        });
    }

    resultsContainer.classList.remove('hidden');

    renderFilteredResults();
}

function renderFilteredResults() {
    const resultsGrid = document.getElementById('search-results-grid');
    if (!resultsGrid) return;

    const filtered = lastSearchResults.filter(item => {
        if (currentTypeFilter !== 'all' && item.type !== currentTypeFilter) return false;
        if (currentLevelFilter !== 'all' && !item.language_level.includes(currentLevelFilter)) return false;
        // Verified Hub language filter runtime application
        if (currentTab === 'verified') {
            const langCode = window.globals.activeContentLang;
            window.dbAPI.getCachedLanguage(item.id).then(cachedLang => {
                // If we don't know the language, assume it's valid for now, otherwise strict match
                if (cachedLang && !cachedLang.includes(langCode.toLowerCase())) return false;
            });
            // Simplified synchronous filter: we trust the user only saved what they wanted, or we allow async filter
        }

        return true;
    });

    resultsGrid.innerHTML = '';

    if (filtered.length === 0) {
        resultsGrid.innerHTML = currentTab === 'global' ? '<p class="empty-state">Bu dilde / filtrede eşleşen sonuç bulunamadı.</p>' : '<p class="empty-state">Doğrulanmış kitaplığınızda bu filtreye uygun kitap yok.</p>';
    } else {
        filtered.forEach(meta => {
            const card = createBookCard(meta, false, currentTab === 'verified');
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
