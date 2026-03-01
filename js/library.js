/**
 * External Library Integrations V3.4 (Strict Language Mapping)
 */

const OPEN_LIBRARY_BASE = 'https://openlibrary.org/search.json';

async function searchText(query) {
    if (!query) return [];
    try {
        const langMap = window.globals.getActiveLanguageMap();

        // V3.4 FIX: OpenLibrary requires advanced search syntax for language: `q=alice+language:fre`
        const safeQuery = encodeURIComponent(`${query} language:${langMap.ol}`);
        const url = `${OPEN_LIBRARY_BASE}?q=${safeQuery}&has_fulltext=true&limit=25`;

        const res = await fetch(url);
        const data = await res.json();
        const validBooks = [];

        for (const book of data.docs) {
            let ia_id = null;
            if (book.ia && book.ia.length > 0) ia_id = book.ia[0];
            else if (book.lending_identifier_s) ia_id = book.lending_identifier_s;

            if (ia_id) {
                const pages = book.number_of_pages_median || 0;
                validBooks.push({
                    id: `txt_${book.key.replace('/works/', '')}`,
                    ia_id: ia_id,
                    title: book.title,
                    author: book.author_name ? book.author_name[0] : 'Unknown',
                    cover: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : 'assets/placeholder-book.png',
                    type: 'text',
                    pages: pages,
                    language_level: heuristcLevelByPages(pages, book.title)
                });
            }
            if (validBooks.length >= 15) break;
        }

        return validBooks;
    } catch (err) {
        console.error("OpenLibrary search failed", err);
        return [];
    }
}

// LIBRIVOX API (Audiobooks)
const LIBRIVOX_BASE = 'https://librivox.org/api/feed/audiobooks?format=json&title=';

async function searchAudio(query) {
    if (!query) return [];
    try {
        const langMap = window.globals.getActiveLanguageMap();

        const res = await fetch(`${LIBRIVOX_BASE}^${encodeURIComponent(query)}`);
        const data = await res.json();

        if (!data.books) return [];

        const validAudio = data.books.filter(b => {
            return b.language && b.language.toLowerCase().includes(langMap.label.toLowerCase());
        });

        return validAudio.slice(0, 15).map(book => ({
            id: `aud_${book.id}`,
            title: book.title,
            author: `${book.authors[0].first_name} ${book.authors[0].last_name}`,
            cover: 'assets/librivox-cover.png',
            type: 'audio',
            language_level: heuristcLevelByPages(0, book.title),
            url: book.url_zip_file,
            project_url: book.url_librivox
        }));
    } catch (err) {
        console.error("LibriVox search failed", err);
        return [];
    }
}

// ----------------------------------------------------
// HYBRID COMBO ENGINE & SORTING
// ----------------------------------------------------
async function searchCombined(query) {
    const [textBooks, audioBooks] = await Promise.all([
        searchText(query),
        searchAudio(query)
    ]);

    const combos = [];
    const texts = [];
    const usedAudioIds = new Set();

    textBooks.forEach(tb => {
        const normalize = (str) => str.toLowerCase().replace(/[^\w\s]/gi, '').trim();
        const tbNorm = normalize(tb.title);

        const match = audioBooks.find(ab =>
            !usedAudioIds.has(ab.id) &&
            (normalize(ab.title).includes(tbNorm) || tbNorm.includes(normalize(ab.title)))
        );

        if (match) {
            usedAudioIds.add(match.id);
            combos.push({
                ...tb,
                id: `combo_${tb.id}_${match.id}`,
                type: 'combo',
                audio_url: match.url,
                project_url: match.project_url
            });
        } else {
            texts.push(tb);
        }
    });

    const audios = audioBooks.filter(ab => !usedAudioIds.has(ab.id));
    return [...combos, ...texts, ...audios];
}

function heuristcLevelByPages(pages, fallbackTitle) {
    if (pages > 0) {
        if (pages < 100) return 'A1-A2 (Kolay)';
        if (pages <= 300) return 'B1-B2 (Orta)';
        return 'C1-C2 (İleri)';
    }
    const levels = ['A1-A2 (Kolay)', 'B1-B2 (Orta)', 'C1-C2 (İleri)'];
    let hash = 0;
    for (let i = 0; i < fallbackTitle.length; i++) hash = fallbackTitle.charCodeAt(i) + ((hash << 5) - hash);
    return levels[Math.abs(hash) % 3];
}

window.libraryAPI = { searchCombined };
