(() => {
    const STORAGE_KEY = 'file_manager_view_mode';
    const VIEW_VALUES = new Set(['grid', 'list']);

    function detectViewFromElement(element) {
        if (!element) {
            return null;
        }

        const datasetValue =
            element.dataset?.view ||
            element.dataset?.mode ||
            element.getAttribute?.('data-view') ||
            element.getAttribute?.('data-mode');

        if (VIEW_VALUES.has(datasetValue)) {
            return datasetValue;
        }

        const text = `${element.id || ''} ${element.className || ''} ${element.getAttribute?.('aria-label') || ''}`.toLowerCase();
        if (text.includes('grid')) {
            return 'grid';
        }
        if (text.includes('list')) {
            return 'list';
        }

        return null;
    }

    function getViewButtons() {
        return Array.from(
            document.querySelectorAll('button, a, [role="button"], input[type="button"]')
        ).filter((element) => detectViewFromElement(element));
    }

    function saveMode(mode) {
        if (!VIEW_VALUES.has(mode)) {
            return;
        }

        window.localStorage.setItem(STORAGE_KEY, mode);
    }

    function getSavedMode() {
        const mode = window.localStorage.getItem(STORAGE_KEY);
        return VIEW_VALUES.has(mode) ? mode : null;
    }

    function updateActiveState(mode) {
        const buttons = getViewButtons();
        for (const button of buttons) {
            const buttonMode = detectViewFromElement(button);
            const isActive = buttonMode === mode;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        }

        document.body.dataset.viewMode = mode;
    }

    function triggerMatchingButton(mode) {
        const button = getViewButtons().find((item) => detectViewFromElement(item) === mode);
        if (!button) {
            updateActiveState(mode);
            return;
        }

        updateActiveState(mode);

        // Reuse existing click handlers so current rendering logic stays in one place.
        if (!button.classList.contains('active')) {
            button.click();
        }
    }

    function restoreSavedMode() {
        const savedMode = getSavedMode();
        if (!savedMode) {
            return;
        }

        window.requestAnimationFrame(() => {
            triggerMatchingButton(savedMode);
        });
    }

    document.addEventListener('click', (event) => {
        const target = event.target.closest('button, a, [role="button"], input[type="button"]');
        const mode = detectViewFromElement(target);
        if (!mode) {
            return;
        }

        saveMode(mode);
        updateActiveState(mode);
    });

    document.addEventListener('DOMContentLoaded', restoreSavedMode);
    window.addEventListener('load', restoreSavedMode);
})();
