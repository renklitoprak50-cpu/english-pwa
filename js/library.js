/**
 * External Library Integrations
 * - OpenLibrary for generic public domain Text books
 * - LibriVox for Audiobooks
 */

// OPEN LIBRARY API (Text Books)
const OPEN_LIBRARY_BASE = 'https://openlibrary.org/search.json?q=';

async function searchOpenLibrary(query) {
    if (!query) return [];
    try {
        const res = await fetch(`${OPEN_LIBRARY_BASE}${encodeURIComponent(query)}&limit=10`);
        const data = await res.json();

        // Map to our standard book card format
        return data.docs.map(book => ({
            id: `ol_${book.key}`,
            title: book.title,
            author: book.author_name ? book.author_name[0] : 'Unknown',
            cover: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : 'assets/placeholder-book.png',
            type: 'text',
            category: 'OpenLibrary',
            language_level: mockLanguageLevel(book.title) // Mocking A1-C2 level
        }));
    } catch (err) {
        console.error("OpenLibrary search failed", err);
        return [];
    }
}

// LIBRIVOX API (Audiobooks)
const LIBRIVOX_BASE = 'https://librivox.org/api/feed/audiobooks?format=json&title=';

async function searchLibriVox(query) {
    if (!query) return [];
    try {
        // LibriVox API might block direct CORS sometimes from certain domains, but usually works fine.
        const res = await fetch(`${LIBRIVOX_BASE}^${encodeURIComponent(query)}`);
        const data = await res.json();

        if (!data.books) return [];

        return data.books.slice(0, 10).map(book => ({
            id: `lv_${book.id}`,
            title: book.title,
            author: `${book.authors[0].first_name} ${book.authors[0].last_name}`,
            cover: 'assets/librivox-cover.png', // Librivox doesn't freely provide covers in the base xml/json
            type: 'audio',
            category: 'LibriVox',
            language_level: mockLanguageLevel(book.title),
            url: book.url_zip_file, // we can download the whole sip or stream
            project_url: book.url_librivox
        }));
    } catch (err) {
        console.error("LibriVox search failed", err);
        return [];
    }
}

// Simple heuristic mock for Language Levels based on string length/hash
function mockLanguageLevel(title) {
    const levels = ['A1 (Beginner)', 'A2 (Elementary)', 'B1 (Intermediate)', 'B2 (Upper)', 'C1 (Advanced)', 'C2 (Mastery)'];
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
        hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % levels.length;
    return levels[index];
}

window.libraryAPI = {
    searchOpenLibrary,
    searchLibriVox
};
