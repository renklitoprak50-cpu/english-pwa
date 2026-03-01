// Wraps IndexedDB using the idb library
const DB_NAME = 'EnglishReaderDB_V2';
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
                db.createObjectStore('books', { keyPath: 'id' }); // id: 'local_upload_1' etc.
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
        definition: definitionData,
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
        id, // 'current_local_book' or 'librivox_x' 
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

// Track local upload count for Free users
async function getLocalBookCount() {
    const db = await initDB();
    if (!db) return 0;
    const allBooks = await db.getAll('books');
    return allBooks.filter(b => b.id.startsWith('local_')).length;
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
    getLocalBookCount
};
