/**
 * Application Core Logic (Dashboard focus)
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize PWA Service Worker
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('sw.js');
            console.log('SW registered:', registration);
        } catch (error) {
            console.log('SW registration failed:', error);
        }
    }

    // 2. Install Prompt Logic (Optional but good for PWA)
    let deferredPrompt;
    const installBtn = document.getElementById('pwa-install-btn');

    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent Chrome 67 and earlier from automatically showing the prompt
        e.preventDefault();
        deferredPrompt = e;

        if (installBtn) {
            installBtn.classList.remove('hidden');
            installBtn.addEventListener('click', async () => {
                installBtn.classList.add('hidden');
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                console.log(`User response to the install prompt: ${outcome}`);
                deferredPrompt = null;
            });
        }
    });

    // 3. Initialize DB and load Dashboard Data
    if (document.querySelector('.dashboard-content')) {
        await loadDashboardStats();
        setupFileUpload();
    }
});

async function loadDashboardStats() {
    if (!window.dbAPI) return;

    const words = await window.dbAPI.getAllWords();

    // Update total count
    const totalEl = document.getElementById('total-words');
    if (totalEl) totalEl.textContent = words.length;

    // Render Recent Words
    const listEl = document.getElementById('words-list');
    if (listEl) {
        if (words.length === 0) {
            // keep empty state
        } else {
            listEl.innerHTML = ''; // clear empty state
            // show last 5 words
            const recentWords = words.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);

            recentWords.forEach(wData => {
                const card = document.createElement('div');
                card.className = 'word-card';
                card.innerHTML = `
                    <div class="word-primary">
                        <span class="word-text">${wData.word}</span>
                        <span class="word-def">${getShortDef(wData.definition)}</span>
                        <span class="word-context">"${wData.context}"</span>
                    </div>
                    <div class="word-actions">
                        <button class="icon-btn" onclick="playWord('${wData.word}')" aria-label="Play">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg>
                        </button>
                    </div>
                `;
                listEl.appendChild(card);
            });
        }
    }

    // Attempt to load reading progress (stub for now if no book loaded)
    const progEl = document.getElementById('read-progress');
    const existingProg = await window.dbAPI.getProgress('currentBook');
    if (progEl && existingProg && existingProg.percentage) {
        progEl.textContent = `${existingProg.percentage}%`;
    }
}

function getShortDef(defData) {
    if (!defData || defData.error) return 'Definition not parsed';
    try {
        return defData.meanings[0].definitions[0].definition.substring(0, 60) + '...';
    } catch (e) {
        return 'Definition available';
    }
}

// Global helper for the play button in the list
window.playWord = function (word) {
    if (window.speechAPI) window.speechAPI.speak(word);
}

function setupFileUpload() {
    const uploadInput = document.getElementById('epub-upload');
    if (!uploadInput) return;

    uploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // We read it as ArrayBuffer to pass it to epubjs or save it
        // For simplicity in this PWA, we will store the file in memory via a Blob URL
        // or inject it directly into the reader page using localStorage for the array buffer (if small)
        // or better, just pass it via IndexedDB.

        saveBookToDBAndNavigate(file);
    });
}

// Store the epub file in IndexedDB so the reader page can access it
async function saveBookToDBAndNavigate(file) {
    const db = await window.dbAPI.initDB();
    if (db) {
        // ensure store exists or just use a dedicated 'books' store
        if (!db.objectStoreNames.contains('books')) {
            // We can dynamically add stores in upgrade, but we defined it at v1.
            // If we didn't, we can use localForage or just a quick trick for now:
        }
    }

    // Quick trick: Create an Object URL and store in LocalStorage for the session
    // Note: URL.createObjectURL expires on page reload. For true offline persistence
    // of the local file, we need a 'books' store in IDB storing the Blob.

    // Fallback: Read as ArrayBuffer and store in a new IDB just for the book
    // To keep it simple and within our current architecture without rebuilding DB version:
    // We will pass the file directly if we used a SPA. Since we use mutiple HTML files:

    const reader = new FileReader();
    reader.onload = async function (e) {
        const arrayBuffer = e.target.result;

        // Let's use standard idb to store it raw
        const tempDb = await idb.openDB('bookStore', 1, {
            upgrade(db) { db.createObjectStore('files'); }
        });

        await tempDb.put('files', arrayBuffer, 'currentBook');

        // Navigate
        window.location.href = 'reader.html';
    };
    reader.readAsArrayBuffer(file);
}
