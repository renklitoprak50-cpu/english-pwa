/**
 * External Library Integrations V3.4 (Strict Language Mapping)
 */

const GUTENDEX_BASE = 'https://gutendex.com/books/';

async function searchText(query, blacklist = []) {
    if (!query) return [];
    try {
        const langMap = window.globals.getActiveLanguageMap();

        // V7.6 FIX: Gutendex API works strictly with 2-letter codes
        const url = `${GUTENDEX_BASE}?search=${encodeURIComponent(query)}&languages=${langMap.mymem}`;

        const res = await fetch(url);
        const data = await res.json();
        const validBooks = [];

        for (const book of data.results) {
            const bookId = `gtn_${book.id}`;
            if (blacklist.includes(bookId)) continue;

            const htmlUrl = book.formats['text/html'] || book.formats['text/html; charset=utf-8'];
            const txtUrl = book.formats['text/plain'] || book.formats['text/plain; charset=utf-8'] || book.formats['text/plain; charset=us-ascii'];
            const formatUrl = txtUrl || htmlUrl;

            if (formatUrl) {
                validBooks.push({
                    id: bookId,
                    ia_id: book.id, // For backwards compatibility
                    title: book.title,
                    author: book.authors && book.authors.length > 0 ? book.authors[0].name.split(',').reverse().join(' ').trim() : 'Unknown',
                    cover: book.formats['image/jpeg'] || 'assets/placeholder-book.png',
                    type: 'text',
                    pages: 0,
                    language_level: heuristcLevelByPages(0, book.title),
                    format_url: formatUrl,
                    isGutenberg: true, // Tag for UI
                    langMap: langMap
                });

                // V5: Permanent Language Cache
                if (window.dbAPI && window.dbAPI.cacheLanguage) {
                    window.dbAPI.cacheLanguage(bookId, window.globals.activeContentLang);
                }
            }
            if (validBooks.length >= 15) break;
        }

        return validBooks;
    } catch (err) {
        console.error("Gutendex search failed", err);
        return [];
    }
}

// LIBRIVOX API (Audiobooks)
const LIBRIVOX_BASE = 'https://librivox.org/api/feed/audiobooks?format=json&title=';

async function searchAudio(query, blacklist = []) {
    if (!query) return [];
    try {
        const langMap = window.globals.getActiveLanguageMap();

        const res = await fetch(`${LIBRIVOX_BASE}^${encodeURIComponent(query)}`);
        const data = await res.json();

        if (!data.books) return [];

        const validAudio = data.books.filter(b => {
            const bookId = `aud_${b.id}`;
            return b.language &&
                b.language.toLowerCase().includes(langMap.label.toLowerCase()) &&
                !blacklist.includes(bookId);
        });

        return validAudio.slice(0, 15).map(book => {
            const bookId = `aud_${book.id}`;
            // V5: Permanent Language Cache
            if (window.dbAPI && window.dbAPI.cacheLanguage) {
                window.dbAPI.cacheLanguage(bookId, window.globals.activeContentLang);
            }
            return {
                id: bookId,
                title: book.title,
                author: `${book.authors[0].first_name} ${book.authors[0].last_name}`,
                cover: 'assets/librivox-cover.png',
                type: 'audio',
                language_level: heuristcLevelByPages(0, book.title),
                url: book.url_zip_file,
                project_url: book.url_librivox
            };
        });
    } catch (err) {
        console.error("LibriVox search failed", err);
        return [];
    }
}

// ----------------------------------------------------
// HYBRID COMBO ENGINE & SORTING
// ----------------------------------------------------
async function searchCombined(query) {
    if (!query) return [];

    // V6.2: Local Vault Check (Zero Latency)
    const langCode = window.globals.activeContentLang;
    const queryKey = `${query.toLowerCase()}_${langCode}`;

    if (window.dbAPI && window.dbAPI.getCachedSearchResults) {
        const cached = await window.dbAPI.getCachedSearchResults(queryKey);
        if (cached && cached.length > 0) {
            console.log("Serving from Local Vault:", queryKey);
            return cached;
        }
    }

    const blacklist = await window.dbAPI.getBlacklist();

    const [textBooks, audioBooks] = await Promise.all([
        searchText(query, blacklist),
        searchAudio(query, blacklist)
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
    const finalResults = [...combos, ...texts, ...audios];

    // V6.2: Save to Local Vault
    if (window.dbAPI && window.dbAPI.cacheSearchResults && finalResults.length > 0) {
        await window.dbAPI.cacheSearchResults(queryKey, finalResults);
    }

    return finalResults;
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

// ==========================================
// V6.5/V7.6: GUTENBERG AUTOMATED LIBRARY ENGINE
// ==========================================
async function fetchGutenbergShelf(langMap) {
    if (!langMap || !langMap.mymem) return [];

    // 1. Check Local DB Cache
    if (window.dbAPI && window.dbAPI.getGutenbergShelf) {
        try {
            const cached = await window.dbAPI.getGutenbergShelf(langMap.mymem);
            if (cached && cached.length > 0) {
                console.log("Serving Gutenberg Shelf from cache:", langMap.label);
                return cached;
            }
        } catch (e) {
            console.warn("Cache read failed for shelf, proceeding to fetch");
        }
    }

    // 2. Fallback to Gutendex API (Strict Filtering, Popular sort)
    try {
        const url = `${GUTENDEX_BASE}?languages=${langMap.mymem}&sort=popular`;

        const res = await fetch(url);
        const data = await res.json();
        const validBooks = [];

        for (const book of data.results) {
            const bookId = `gtn_${book.id}`;
            const epubUrl = book.formats['application/epub+zip'];
            const htmlUrl = book.formats['text/html'] || book.formats['text/html; charset=utf-8'];
            const txtUrl = book.formats['text/plain'] || book.formats['text/plain; charset=utf-8'] || book.formats['text/plain; charset=us-ascii'];
            const formatUrl = txtUrl || htmlUrl;

            if (epubUrl || formatUrl) {
                validBooks.push({
                    id: bookId,
                    ia_id: book.id,
                    title: book.title,
                    author: book.authors && book.authors.length > 0 ? book.authors[0].name.split(',').reverse().join(' ').trim() : 'Unknown',
                    cover: book.formats['image/jpeg'] || 'assets/placeholder-book.png',
                    type: 'text',
                    pages: 0,
                    language_level: heuristcLevelByPages(0, book.title),
                    isGutenberg: true, // Tag for UI
                    format_url: formatUrl,
                    epub_url: epubUrl, // V8 Elite EPUB Source
                    langMap: langMap   // Tag for UI Flag
                });
            }
            if (validBooks.length >= 20) break; // Fetch up to 20 for shelf
        }

        // 3. Cache the fetched shelf
        if (window.dbAPI && window.dbAPI.saveGutenbergShelf && validBooks.length > 0) {
            await window.dbAPI.saveGutenbergShelf(langMap.mymem, validBooks);
        }

        return validBooks;

    } catch (err) {
        console.error("Gutenberg Shelf Fetch Failed for", langMap.label, err);
        return [];
    }
}

window.libraryAPI = { searchCombined, fetchGutenbergShelf };
