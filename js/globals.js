/**
 * Global State & V4 Multi-Language Engine
 * V4 Rule: Maximum Accessibility + Polyglot Translation Mapping
 */

const isPremiumUser = true;

function checkPremiumAction(actionName) {
    if (isPremiumUser) return true;
    // V7.8: Unlocked for everyone on Vercel
    return true;
}

// Global Language Mappings
// ol: OpenLibrary 3-letter code
// mymem: MyMemory 2-letter code
// speech: Web Speech API BCP 47 Locale
// label: LibriVox Array filtering target
const SUPPORTED_LANGS = {
    'en': { ol: 'eng', mymem: 'en', speech: 'en-US', label: 'English' },
    'de': { ol: 'ger', mymem: 'de', speech: 'de-DE', label: 'German' },
    'fr': { ol: 'fre', mymem: 'fr', speech: 'fr-FR', label: 'French' },
    'es': { ol: 'spa', mymem: 'es', speech: 'es-ES', label: 'Spanish' },
    'tr': { ol: 'tur', mymem: 'tr', speech: 'tr-TR', label: 'Turkish' },
    'it': { ol: 'ita', mymem: 'it', speech: 'it-IT', label: 'Italian' }
};

// Application Language State (Persisted)
let activeContentLang = localStorage.getItem('contentLanguage') || 'en';

function setContentLanguage(langKey) {
    if (SUPPORTED_LANGS[langKey]) {
        activeContentLang = langKey;
        localStorage.setItem('contentLanguage', langKey);
    }
}

function getActiveLanguageMap() {
    return SUPPORTED_LANGS[activeContentLang] || SUPPORTED_LANGS['en'];
}

window.globals = {
    isPremium: isPremiumUser,
    checkPremiumAction,
    SUPPORTED_LANGS,
    setContentLanguage,
    getActiveLanguageMap,
    get activeContentLang() { return activeContentLang; }
};
