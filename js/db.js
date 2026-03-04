// Wraps IndexedDB using the idb library
const DB_NAME = 'EnglishReaderDB_V2';
const DB_VERSION = 7; // Bumped for V8 LingoBooks Gamification

let dbPromise;

// Initialize Database
async function initDB() {
    if (dbPromise) return dbPromise;

    if (!window.idb) {
        console.warn("idb library not loaded yet.");
        return null;
    }

    dbPromise = idb.openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion, transaction) {
            if (!db.objectStoreNames.contains('words')) {
                const store = db.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
                store.createIndex('word', 'word', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }

            if (!db.objectStoreNames.contains('progress')) {
                db.createObjectStore('progress', { keyPath: 'bookId' });
            }

            // V2: Store actual Book ArrayBuffers for true offline
            if (!db.objectStoreNames.contains('books')) {
                db.createObjectStore('books', { keyPath: 'id' });
            }

            // V5: Permanent Language Cache
            if (!db.objectStoreNames.contains('languageCache')) {
                db.createObjectStore('languageCache', { keyPath: 'bookId' });
            }

            // V6.1: Dual Hub Stores
            if (!db.objectStoreNames.contains('verifiedBooks')) {
                db.createObjectStore('verifiedBooks', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('blacklist')) {
                db.createObjectStore('blacklist', { keyPath: 'id' });
            }

            // V6.2: Local Vault for Zero Latency Searches
            if (!db.objectStoreNames.contains('localLibrary')) {
                db.createObjectStore('localLibrary', { keyPath: 'queryKey' });
            }

            // V6.5: Gutenberg Auto-Shelves
            if (!db.objectStoreNames.contains('gutenbergShelves')) {
                db.createObjectStore('gutenbergShelves', { keyPath: 'lang' });
            }

            // V7: Single-Fetch Book Content
            if (!db.objectStoreNames.contains('bookContent')) {
                db.createObjectStore('bookContent', { keyPath: 'id' });
            }

            // V8 (LingoBooks): Gamification Profile
            if (!db.objectStoreNames.contains('userProfile')) {
                db.createObjectStore('userProfile', { keyPath: 'id' });
            }
        },
    });

    return dbPromise;
}

// Word Operations
async function saveWord(word, contextSentence, definitionData) {
    const db = await initDB();
    if (!db) return;

    // Check if word already exists to preserve counts
    const tx = db.transaction('words', 'readwrite');
    const store = tx.objectStore('words');
    const index = store.index('word');
    const existing = await index.get(word.toLowerCase().trim());

    let wData = {
        word: word.toLowerCase().trim(),
        context: contextSentence,
        definition: definitionData,
        timestamp: Date.now(),
        correctCount: existing ? existing.correctCount || 0 : 0,
        errorCount: existing ? existing.errorCount || 0 : 0
    };

    if (existing && existing.id) {
        wData.id = existing.id;
    }

    await store.put(wData);
    await tx.done;
}

async function getAllWords() {
    const db = await initDB();
    if (!db) return [];
    return db.getAllFromIndex('words', 'timestamp');
}

async function deleteWord(id) {
    const db = await initDB();
    if (!db) return;
    return db.delete('words', id);
}

// Progress Operations
async function saveProgress(bookId, locationOrPage) {
    const db = await initDB();
    if (!db) return;
    return db.put('progress', {
        bookId,
        location: locationOrPage,
        lastRead: Date.now()
    });
}

async function getProgress(bookId) {
    const db = await initDB();
    if (!db) return null;
    return db.get('progress', bookId);
}

// Book Storage Operations (True Offline)
async function saveBook(id, arrayBuffer, metadata) {
    const db = await initDB();
    if (!db) return;
    return db.put('books', {
        id,
        data: arrayBuffer,
        meta: metadata,
        timestamp: Date.now()
    });
}

async function getBook(id) {
    const db = await initDB();
    if (!db) return null;
    return db.get('books', id);
}

async function deleteBook(id) {
    const db = await initDB();
    if (!db) return;
    return db.delete('books', id);
}

// Track local upload count
async function getLocalBookCount() {
    const db = await initDB();
    if (!db) return 0;
    const allBooks = await db.getAll('books');
    return allBooks.filter(b => b.id.startsWith('local_')).length;
}

// V5: Language Cache Operations
async function cacheLanguage(bookId, langCode) {
    const db = await initDB();
    if (!db) return;
    return db.put('languageCache', {
        bookId,
        verifiedLanguage: langCode
    });
}

async function getCachedLanguage(bookId) {
    const db = await initDB();
    if (!db) return null;
    const record = await db.get('languageCache', bookId);
    return record ? record.verifiedLanguage : null;
}

// V6.1: Dual Hub Operations (Verification & Blacklist)
async function verifyBook(meta) {
    const db = await initDB();
    if (!db) return;
    return db.put('verifiedBooks', {
        id: meta.id,
        meta: meta,
        timestamp: Date.now()
    });
}

async function getVerifiedBooks() {
    const db = await initDB();
    if (!db) return [];
    return db.getAll('verifiedBooks');
}

async function blacklistBook(id) {
    const db = await initDB();
    if (!db) return;
    return db.put('blacklist', {
        id: id,
        timestamp: Date.now()
    });
}

async function getBlacklist() {
    const db = await initDB();
    if (!db) return [];
    const BL = await db.getAll('blacklist');
    return BL.map(b => b.id);
}

// V6.2: Local Vault (Zero Latency Search Engine)
async function cacheSearchResults(queryKey, resultsArray) {
    const db = await initDB();
    if (!db) return;
    return db.put('localLibrary', {
        queryKey: queryKey,
        results: resultsArray,
        timestamp: Date.now()
    });
}

async function getCachedSearchResults(queryKey) {
    const db = await initDB();
    if (!db) return null;
    const record = await db.get('localLibrary', queryKey);
    return record ? record.results : null;
}

// V6.5: Gutenberg Shelves Cache
async function saveGutenbergShelf(lang, booksArray) {
    const db = await initDB();
    if (!db) return;
    return db.put('gutenbergShelves', {
        lang: lang,
        books: booksArray,
        timestamp: Date.now()
    });
}

async function getGutenbergShelf(lang) {
    const db = await initDB();
    if (!db) return null;
    const record = await db.get('gutenbergShelves', lang);
    return record ? record.books : null;
}

// V7: Single-Fetch Book Content Operations
async function saveBookContent(id, text) {
    const db = await initDB();
    if (!db) return;
    return db.put('bookContent', {
        id: id,
        text: text,
        timestamp: Date.now()
    });
}

async function getBookContent(id) {
    const db = await initDB();
    if (!db) return null;
    const record = await db.get('bookContent', id);
    return record ? record.text : null;
}

// V8 (LingoBooks): Gamification Operations
async function getUserProfile() {
    const db = await initDB();
    if (!db) return null;
    let profile = await db.get('userProfile', 'me');
    if (!profile) {
        profile = {
            id: 'me',
            xp: 0,
            level: 0,
            streak: 0,
            lastActiveDate: null
        };
        await db.put('userProfile', profile);
    }
    return profile;
}

async function saveUserProfile(profileData) {
    const db = await initDB();
    if (!db) return;
    profileData.id = 'me';
    return db.put('userProfile', profileData);
}

async function updateWordCount(id, isCorrect) {
    const db = await initDB();
    if (!db) return null;
    const tx = db.transaction('words', 'readwrite');
    const store = tx.objectStore('words');
    const wordRecord = await store.get(id);
    if (wordRecord) {
        if (isCorrect) {
            wordRecord.correctCount = (wordRecord.correctCount || 0) + 1;
        } else {
            wordRecord.errorCount = (wordRecord.errorCount || 0) + 1;
        }
        await store.put(wordRecord);
    }
    await tx.done;
    return wordRecord;
}

// Expose globally
window.dbAPI = {
    initDB,
    saveWord,
    getAllWords,
    deleteWord,
    saveProgress,
    getProgress,
    saveBook,
    getBook,
    deleteBook,
    getLocalBookCount,
    cacheLanguage,
    getCachedLanguage,
    verifyBook,
    getVerifiedBooks,
    blacklistBook,
    getBlacklist,
    cacheSearchResults,
    getCachedSearchResults,
    saveGutenbergShelf,
    getGutenbergShelf,
    saveBookContent,
    getBookContent,
    getUserProfile,
    saveUserProfile,
    updateWordCount
};
