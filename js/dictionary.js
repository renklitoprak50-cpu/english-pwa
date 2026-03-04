/**
 * Google Translate API Wrapper
 * Translates directly to Turkish using a free Google Translate endpoint.
 */

async function fetchTranslation(word) {
    if (!word) return null;
    try {
        const map = window.globals.getActiveLanguageMap();
        const sourceLang = "auto";
        const targetLang = "tr";

        // Free Google Translate GoogleAPI endpoint
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(word)}`;

        const res = await fetch(url);
        const data = await res.json();

        // data[0][0][0] contains the translated text
        if (data && data[0] && data[0][0] && data[0][0][0]) {
            return {
                word: word,
                translation: data[0][0][0],
                phonetic: `[${(map && map.label ? map.label.substring(0, 2) : sourceLang).toUpperCase()}]`,
                source_lang: sourceLang
            };
        }

        return { error: "Translation not found." };

    } catch (err) {
        console.error("Google Translate API error:", err);
        return { error: "Network error occurred." };
    }
}

window.dictionaryAPI = { fetchDefinition: fetchTranslation };
