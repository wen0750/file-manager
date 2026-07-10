const fs = require('fs');
const path = require('path');

const locales = {};
const localeDir = path.join(__dirname, '..', '..', 'public', 'locales');

const supportedLanguages = ['en', 'zh-HK', 'zh-CN'];

/**
 * Load all locale files into memory.
 */
function loadLocales() {
    for (const lang of supportedLanguages) {
        const filePath = path.join(localeDir, `${lang}.json`);
        if (fs.existsSync(filePath)) {
            locales[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    }
}

/**
 * Translate a key for a given language.
 * Supports nested keys with dot notation: "common.save"
 */
function translate(lang, key, params = {}) {
    const locale = locales[lang] || locales['en'] || {};
    const keys = key.split('.');
    let value = locale;

    for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
            value = value[k];
        } else {
            // Fallback to English
            value = locales['en'];
            for (const k2 of keys) {
                if (value && typeof value === 'object' && k2 in value) {
                    value = value[k2];
                } else {
                    return key;
                }
            }
            break;
        }
    }

    if (typeof value === 'string') {
        // Replace parameters like {name}
        for (const [param, val] of Object.entries(params)) {
            value = value.replace(new RegExp(`\\{${param}\\}`, 'g'), val);
        }
        return value;
    }

    return key;
}

/**
 * Get the best matching language from Accept-Language header or user preference.
 */
function getBestLanguage(acceptLang, userLang) {
    if (userLang && supportedLanguages.includes(userLang)) {
        return userLang;
    }
    if (acceptLang) {
        const langs = acceptLang.split(',').map(l => l.trim().split(';')[0]);
        for (const l of langs) {
            if (supportedLanguages.includes(l)) return l;
            // Check base language (e.g., "zh-CN" from "zh")
            const base = l.split('-')[0];
            const match = supportedLanguages.find(s => s.startsWith(base));
            if (match) return match;
        }
    }
    return 'en';
}

// Load on module init
loadLocales();

module.exports = {
    translate,
    getBestLanguage,
    supportedLanguages,
    loadLocales
};
