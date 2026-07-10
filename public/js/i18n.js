/**
 * Frontend i18n module.
 * Loads locale files and translates keys.
 */
const I18n = {
    currentLang: 'en',
    locales: {},
    supportedLangs: ['en', 'zh-CN', 'zh-HK'],

    async load(lang) {
        if (this.locales[lang]) return;
        try {
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), 5000)
            );
            const res = await Promise.race([fetch(`/locales/${lang}.json`), timeout]);
            this.locales[lang] = await res.json();
        } catch (e) {
            console.error('Failed to load locale:', lang, e);
            if (lang !== 'en') {
                await this.load('en');
            }
        }
    },

    t(key, params = {}) {
        const locale = this.locales[this.currentLang] || {};
        const keys = key.split('.');
        let value = locale;
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return key;
            }
        }
        if (typeof value === 'string') {
            for (const [param, val] of Object.entries(params)) {
                value = value.replace(new RegExp(`\\{${param}\\}`, 'g'), val);
            }
            return value;
        }
        return key;
    },

    async setLanguage(lang) {
        if (!this.supportedLangs.includes(lang)) lang = 'en';
        this.currentLang = lang;
        await this.load(lang);
        this.applyTranslations();
        document.documentElement.lang = lang;

        // Update language selectors
        const selectors = ['loginLanguage', 'appLanguage'];
        selectors.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = lang;
        });
    },

    applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const text = this.t(key);
            if (text) el.textContent = text;
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const text = this.t(key);
            if (text) el.placeholder = text;
        });
    }
};
