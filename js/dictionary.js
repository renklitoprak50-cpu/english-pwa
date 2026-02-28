const DICTIONARY_API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

/**
 * Fetches the definition of a word from the Free Dictionary API.
 * @param {string} word - The word to look up.
 * @returns {Promise<Object|null>} The parsed definition data or null if not found.
 */
async function fetchDefinition(word) {
    try {
        // Clean word: remove punctuation
        const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim().toLowerCase();

        if (!cleanWord) return null;

        const response = await fetch(`${DICTIONARY_API_BASE}${cleanWord}`);

        if (!response.ok) {
            if (response.status === 404) {
                console.log(`Word not found in dictionary: ${cleanWord}`);
                return { error: 'Not found', word: cleanWord };
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data[0]; // The API returns an array of entries, we usually just need the first one
    } catch (error) {
        console.error('Error fetching definition:', error);
        return null;
    }
}

window.dictionaryAPI = {
    fetchDefinition
};
