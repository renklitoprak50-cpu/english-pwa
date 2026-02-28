// Wraps IndexedDB using the idb library
const DB_NAME = 'EnglishReaderDB';
const DB_VERSION = 1;

let dbPromise;

// Initialize Database
async function initDB() {
    if (dbPromise) return dbPromise;

    if (!window.idb) {
        console.warn("idb library not loaded yet.");
        return null;
    }

    dbPromise = idb.openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            // Create a store for saved words
            if (!db.objectStoreNames.contains('words')) {
                const store = db.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
                store.createIndex('word', 'word', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }

            // Create a store for reading progress (e.g. current location in book)
            if (!db.objectStoreNames.contains('progress')) {
                db.createObjectStore('progress', { keyPath: 'bookId' });
            }
        },
    });

    return dbPromise;
}

// Word Operations
async function saveWord(word, contextSentence, definitionData) {
    const db = await initDB();
    if (!db) return;
    return db.put('words', {
        word: word.toLowerCase().trim(),
        context: contextSentence,
        definition: definitionData, // Storing the full API response or a parsed version
        timestamp: Date.now()
    });
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
async function saveProgress(bookId, cfiLocation) {
    const db = await initDB();
    if (!db) return;
    return db.put('progress', {
        bookId,
        location: cfiLocation,
        lastRead: Date.now()
    });
}

async function getProgress(bookId) {
    const db = await initDB();
    if (!db) return null;
    return db.get('progress', bookId);
}

// Expose globally
window.dbAPI = {
    initDB,
    saveWord,
    getAllWords,
    deleteWord,
    saveProgress,
    getProgress
};
