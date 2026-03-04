/**
 * MyMemory Translation API Wrapper V4
 * Translates from currently selected language directly to Turkish (or English fallback).
 */

const MYMEMORY_API_BASE = 'https://api.mymemory.translated.net/get?q=';

async function fetchTranslation(word) {
    if (!word) return null;
    try {
        // Build the language pair using the global V4 Language State
        const map = window.globals.getActiveLanguageMap();
        // Target language is strictly Turkish for this PWA
        const targetLang = 'tr';

        // If mymem mapping is missing, default to English.
        const sourceLang = map && map.mymem ? map.mymem : 'en';

        const url = `${MYMEMORY_API_BASE}${encodeURIComponent(word)}&langpair=${sourceLang}|${targetLang}`;

        const res = await fetch(url);
        const data = await res.json();

        if (data.responseStatus === 200 && data.responseData.translatedText) {
            return {
                word: word,
                translation: data.responseData.translatedText,
                phonetic: `[${sourceLang.toUpperCase()}]`,
                source_lang: sourceLang,
                match: data.responseData.match
            };
        }

        return { error: "Translation not found." };

    } catch (err) {
        console.error("MyMemory Translation API error:", err);
        return { error: "Network error occurred." };
    }
}

window.dictionaryAPI = {
    fetchDefinition: fetchTranslation // kept original name for backward compatibility with older saving logic
};
