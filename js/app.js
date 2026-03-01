/**
 * Application Core Logic V2 (Dashboard focus)
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize PWA Service Worker
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('sw.js');
        } catch (error) {
            console.log('SW registration failed:', error);
        }
    }

    // 2. Global State Display
    const accountStatus = document.getElementById('account-status');
    if (accountStatus) {
        if (window.globals.isPremium) {
            accountStatus.innerHTML = '👑 Premium';
            accountStatus.style.color = 'var(--warning)';
        } else {
            accountStatus.innerHTML = 'Free Plan';
            accountStatus.style.color = 'var(--text-secondary)';
        }
    }

    // 3. Initialize DB and load Dashboard Data
    if (document.querySelector('.dashboard-content')) {
        await checkLocalUploadLimits();
        await loadDashboardStats();
        setupFileUpload();
        setupSearch();
    }
});

async function checkLocalUploadLimits() {
    if (!window.dbAPI) return;

    const count = await window.dbAPI.getLocalBookCount();
    const countEl = document.getElementById('local-uploads-count');
    if (countEl) countEl.innerHTML = `${count} <span id="local-uploads-limit">/ ${window.globals.isPremium ? '∞' : '1'}</span>`;

    const uploadLabel = document.getElementById('upload-label');
    const notice = document.getElementById('premium-upload-notice');
    const input = document.getElementById('epub-upload');

    if (!window.globals.isPremium && count >= 1) {
        if (uploadLabel) {
            uploadLabel.style.opacity = '0.5';
            uploadLabel.style.cursor = 'not-allowed';
            uploadLabel.innerText = '👑 Limit Reached';
        }
        if (notice) notice.style.display = 'block';
        if (input) input.disabled = true;
    }
}

async function loadDashboardStats() {
    if (!window.dbAPI) return;

    // Total words
    const words = await window.dbAPI.getAllWords();
    const totalEl = document.getElementById('total-words');
    if (totalEl) totalEl.textContent = words.length;

    // Load Offline Books Shelf
    const db = await window.dbAPI.initDB();
    if (db) {
        const allBooks = await db.getAll('books');
        const shelf = document.getElementById('offline-books-grid');
        if (shelf && allBooks.length > 0) {
            shelf.innerHTML = ''; // clear empty state
            allBooks.forEach(b => {
                const card = createBookCard(b.meta, true); // true = is offline
                card.addEventListener('click', () => openBook(b.id));
                shelf.appendChild(card);
            });
        }
    }
}

function createBookCard(meta, isOffline = false) {
    const div = document.createElement('div');
    div.className = 'book-card glass-panel cursor-pointer';
    div.innerHTML = `
        <div class="book-cover" style="background-image: url('${meta.cover || 'assets/librivox-cover.png'}')">
             ${meta.language_level ? `<span class="level-badge">${meta.language_level}</span>` : ''}
             ${meta.type === 'audio' ? `<div class="audio-badge">🎧 Audio</div>` : ''}
        </div>
        <div class="book-meta">
            <h4 class="book-title truncate">${meta.title}</h4>
            <p class="book-author truncate">${meta.author || 'Unknown'}</p>
            ${isOffline ? `<span style="font-size:0.7rem;color:var(--success);">Available Offline</span>` : ''}
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

        // Enforce limit again just in case
        const count = await window.dbAPI.getLocalBookCount();
        if (!window.globals.isPremium && count >= 1) {
            window.globals.checkPremiumAction('Unlimited Local Uploads');
            return;
        }

        const reader = new FileReader();
        reader.onload = async function (e) {
            const arrayBuffer = e.target.result;
            const bookId = `local_${Date.now()}`;

            // Generate basic metadata
            const isPDF = file.name.toLowerCase().endsWith('.pdf');
            const metadata = {
                title: file.name.replace(/\.[^/.]+$/, ""),
                author: 'Local File',
                type: isPDF ? 'pdf' : 'text',
                category: 'Local'
            };

            await window.dbAPI.saveBook(bookId, arrayBuffer, metadata);

            // Navigate to reader
            openBook(bookId);
        };
        reader.readAsArrayBuffer(file);
    });
}

function openBook(bookId) {
    // We pass the bookId payload via localStorage for the reader to pick up
    localStorage.setItem('activeBookId', bookId);
    window.location.href = 'reader.html';
}

// ==========================================
// SEARCH LOGIC (OpenLibrary + LibriVox)
// ==========================================
let searchTimeout;
function setupSearch() {
    const input = document.getElementById('omni-search');
    const closeBtn = document.getElementById('close-search');
    const resultsContainer = document.getElementById('search-results-container');
    const resultsGrid = document.getElementById('search-results-grid');
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
            // Concurrent search
            const [textRes, audioRes] = await Promise.all([
                window.libraryAPI.searchOpenLibrary(query),
                window.libraryAPI.searchLibriVox(query)
            ]);

            const combined = [...textRes, ...audioRes];

            resultsGrid.innerHTML = '';
            if (combined.length === 0) {
                resultsGrid.innerHTML = '<p class="empty-state">No results found.</p>';
            } else {
                combined.forEach(meta => {
                    const card = createBookCard(meta);
                    card.addEventListener('click', () => {
                        // For network books, we either download and save, or pass URL directly
                        // Since OpenLibrary doesn't always provide raw text, usually we'd link to reader.
                        // For this simulation, we'll alert that network reader isn't fully wired for raw files yet
                        // unless it's a direct PDF link.
                        if (meta.type === 'audio') {
                            // Route to audio player / open new tab
                            alert(`Opening Audiobook: ${meta.title}`);
                            if (meta.project_url) window.open(meta.project_url, '_blank');
                        } else {
                            alert(`This is a library catalog entry. To read it, download the EPUB/PDF from OpenLibrary and use Local Upload.`);
                        }
                    });
                    resultsGrid.appendChild(card);
                });
            }

            if (spinner) spinner.classList.add('hidden');
            resultsContainer.classList.remove('hidden');

        }, 800); // debounce 800ms
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            resultsContainer.classList.add('hidden');
            input.value = '';
        });
    }
}
