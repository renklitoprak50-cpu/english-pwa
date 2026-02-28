/**
 * Utility wrapper for the Web Speech API to provide TTS (Text-to-Speech) capabilities.
 */

class SpeechService {
    constructor() {
        this.synth = window.speechSynthesis;
        this.voices = [];
        this.selectedVoice = null;
        this.baseRate = 0.9; // Slightly slower for language learning
        this.basePitch = 1;

        // Load voices when they become available
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = this._loadVoices.bind(this);
        } else {
            this._loadVoices();
        }
    }

    _loadVoices() {
        this.voices = this.synth.getVoices();

        // Try to find a good English voice (preferably US or UK)
        this.selectedVoice = this.voices.find(voice => voice.lang.includes('en-US') && voice.name.includes('Google'))
            || this.voices.find(voice => voice.lang.includes('en-GB') && voice.name.includes('Google'))
            || this.voices.find(voice => voice.lang.includes('en-US'))
            || this.voices.find(voice => voice.lang.includes('en'));
    }

    /**
     * Synthesize and speak text.
     * @param {string} text - The text to speak.
     * @param {number} rateMod - Optional rate modifier (1.0 is normal, 0.5 is half speed).
     */
    speak(text, rateMod = 1.0) {
        if (!this.synth) {
            console.error("SpeechSynthesis API not supported in this browser.");
            return;
        }

        // Cancel any ongoing speech
        if (this.synth.speaking) {
            this.synth.cancel();
        }

        if (text !== '') {
            const utterThis = new SpeechSynthesisUtterance(text);

            // Prefer our selected English voice
            if (this.selectedVoice) {
                utterThis.voice = this.selectedVoice;
            }

            utterThis.pitch = this.basePitch;
            utterThis.rate = this.baseRate * rateMod;

            this.synth.speak(utterThis);
        }
    }

    stop() {
        if (this.synth) this.synth.cancel();
    }
}

// Expose single instance
window.speechAPI = new SpeechService();
