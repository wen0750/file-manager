/**
 * File Manager - Main Application Logic
 */

// State
const state = {
    currentFolderId: null,
    currentView: 'grid',
    selectedItems: new Set(),
    items: { folders: [], files: [] },
    breadcrumbs: [],
    editor: null,
    editingFileId: null,
    moveCopyAction: null,
    moveCopyTargetFolder: null,
    renameTarget: null,
    renameType: null,
    searchQuery: ''
};

// ===== Initialization =====
async function init() {
    try {
        // Detect language from browser or localStorage
        const savedLang = localStorage.getItem('language') || detectLanguage();
        await I18n.setLanguage(savedLang);

        // Check auth status
        try {
            const res = await API.auth.me();
            if (res.user) {
                showApp(res.user);
            } else {
                showLogin();
            }
        } catch (e) {
            showLogin();
        }

        setupEventListeners();
        checkRegistrationAllowed();
    } catch (e) {
        console.error('Initialization error:', e);
        showLogin();
        // Fallback: attach basic event listeners even on error
        try { setupEventListeners(); } catch (err) {}
    }
}

function detectLanguage() {
    const browser = navigator.language || 'en';
    if (browser.startsWith('zh-CN') || browser.startsWith('zh-Hans')) return 'zh-CN';
    if (browser.startsWith('zh') || browser.startsWith('zh-Hant')) return 'zh-HK';
    return 'en';
}

function showLogin() {
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('appPage').style.display = 'none';
    // Reset to login form view
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginLink').style.display = 'none';
}

function showApp(user) {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('appPage').style.display = 'block';
    document.getElementById('navUsername').textContent = user.username;

    if (user.language) {
        I18n.setLanguage(user.language);
        localStorage.setItem('language', user.language);
    }

    // Show admin section
    if (user.role === 'admin') {
        document.getElementById('adminSection').style.display = 'block';
    }

    // Load initial data
    loadFiles();
    loadQuota();
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Login form
    document.getElementById('loginForm').addEventListener('submit', handleLogin);

    // Register form
    document.getElementById('registerForm').addEventListener('submit', handleRegister);

    // Search
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            state.searchQuery = e.target.value.trim();
            document.getElementById('searchClearBtn').style.display = state.searchQuery ? 'flex' : 'none';
            loadFiles();
        }, 300);
    });

    // File input
    document.getElementById('fileInput').addEventListener('change', handleFileSelect);

    // Dropzone
    const dropzone = document.getElementById('dropzone');
    dropzone.addEventListener('click', () => document.getElementById('fileInput').click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('userDropdown');
        const btn = document.querySelector('.user-menu-btn');
        if (dropdown && !dropdown.contains(e.target) && btn && !btn.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });
}

// ===== Auth =====
async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');

    try {
        const res = await API.auth.login(username, password);
        if (res.success) {
            localStorage.setItem('language', res.user.language || 'en');
            showApp(res.user);
        }
    } catch (err) {
        errorEl.textContent = I18n.t('auth.login_failed');
    }
}

async function logout() {
    try {
        await API.auth.logout();
    } catch (e) {}
    showLogin();
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    checkRegistrationAllowed();
}

// ===== Registration =====
async function checkRegistrationAllowed() {
    try {
        const res = await API.settings.get();
        const allowed = res.settings && res.settings.allow_registration === '1';
        const link = document.getElementById('registerLink');
        if (link) link.style.display = allowed ? 'block' : 'none';
    } catch (e) {
        // If settings API fails (not logged in), hide register link
        document.getElementById('registerLink').style.display = 'none';
    }
}

function showRegisterForm() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerLink').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('loginLink').style.display = 'block';
    document.getElementById('registerError').textContent = '';
}

function showLoginForm() {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginLink').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    checkRegistrationAllowed();
    document.getElementById('registerError').textContent = '';
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;
    const errorEl = document.getElementById('registerError');

    if (!username) {
        errorEl.textContent = I18n.t('auth.username');
        return;
    }
    if (password.length < 6) {
        errorEl.textContent = I18n.t('auth.password_too_short');
        return;
    }
    if (password !== confirmPassword) {
        errorEl.textContent = I18n.t('auth.passwords_not_match');
        return;
    }

    try {
        const lang = localStorage.getItem('language') || 'en';
        const res = await API.auth.register({ username, password, email, language: lang });
        if (res.success) {
            showToast('success', I18n.t('auth.register_success'));
            localStorage.setItem('language', res.user.language || 'en');
            showApp(res.user);
        }
    } catch (err) {
        errorEl.textContent = err.message || I18n.t('auth.register_failed');
    }
}

// ===== Language =====
async function changeLanguage(lang) {
    localStorage.setItem('language', lang);
    await I18n.setLanguage(lang);

    // Save to user profile if logged in
    try {
        await API.settings.setLanguage(lang);
    } catch (e) {}
}

// ===== File Operations =====
async function loadFiles(folderId = state.currentFolderId) {
    showLoading(true);
    try {
        const data = await API.files.list(folderId, state.searchQuery);
        state.items = { folders: data.folders || [], files: data.files || [] };
        state.breadcrumbs = data.breadcrumbs || [];
        state.currentFolderId = folderId;

        renderFiles();
        renderBreadcrumbs();
    } catch (e) {
        showToast('error', e.message);
    } finally {
        showLoading(false);
    }
}

function renderBreadcrumbs() {
    const container = document.getElementById('breadcrumbs');
    let html = `<a onclick="navigateTo(null)" class="${!state.currentFolderId ? 'current' : ''}">${I18n.t('files.my_files')}</a>`;

    for (const crumb of state.breadcrumbs) {
        html += `<span class="separator"><i class="fas fa-chevron-right"></i></span>`;
        html += `<a onclick="navigateTo(${crumb.id})" class="${crumb.id === state.currentFolderId ? 'current' : ''}">${escapeHtml(crumb.name)}</a>`;
    }

    container.innerHTML = html;
}

function renderFiles() {
    const grid = document.getElementById('fileGrid');
    const listBody = document.getElementById('fileListBody');
    const emptyState = document.getElementById('emptyState');

    const { folders, files } = state.items;
    const totalItems = folders.length + files.length;

    if (totalItems === 0) {
        grid.innerHTML = '';
        listBody.innerHTML = '';
        document.getElementById('fileGrid').style.display = 'none';
        document.getElementById('fileList').style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    if (state.currentView === 'grid') {
        document.getElementById('fileGrid').style.display = 'grid';
        document.getElementById('fileList').style.display = 'none';
        grid.innerHTML = folders.map(f => renderFolderCard(f)).join('') +
                         files.map(f => renderFileCard(f)).join('');
    } else {
        document.getElementById('fileGrid').style.display = 'none';
        document.getElementById('fileList').style.display = 'block';
        listBody.innerHTML = folders.map(f => renderFolderRow(f)).join('') +
                             files.map(f => renderFileRow(f)).join('');
    }

    updateSelectionUI();
}

function renderFolderCard(folder) {
    const selected = state.selectedItems.has(`folder-${folder.id}`) ? 'selected' : '';
    return `
        <div class="file-card ${selected}" onclick="onItemClick(event, 'folder', ${folder.id})" ondblclick="navigateTo(${folder.id})">
            <input type="checkbox" class="file-checkbox" ${selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect('folder', ${folder.id})">
            <div class="file-actions-menu">
                <button class="btn-icon" onclick="event.stopPropagation(); showItemMenu(event, 'folder', ${folder.id})">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
            </div>
            <i class="fas fa-folder file-icon folder"></i>
            <div class="file-name" title="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</div>
            <div class="file-size">${formatDate(folder.created_at)}</div>
        </div>
    `;
}

function renderFileCard(file) {
    const selected = state.selectedItems.has(`file-${file.id}`) ? 'selected' : '';
    const iconHtml = file.is_image
        ? `<img class="file-thumb" src="${API.files.thumbnail(file.id)}" onerror="this.outerHTML='<i class=\\'fas fa-image file-icon image\\'></i>'">`
        : `<i class="fas ${getFileIcon(file)} file-icon ${getFileIconClass(file)}"></i>`;

    return `
        <div class="file-card ${selected}" onclick="onItemClick(event, 'file', ${file.id})" ondblclick="previewFile(${file.id})">
            <input type="checkbox" class="file-checkbox" ${selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect('file', ${file.id})">
            <div class="file-actions-menu">
                <button class="btn-icon" onclick="event.stopPropagation(); showItemMenu(event, 'file', ${file.id})">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
            </div>
            ${iconHtml}
            <div class="file-name" title="${escapeHtml(file.original_name || file.name)}">${escapeHtml(file.original_name || file.name)}</div>
            <div class="file-size">${formatBytes(file.size)}</div>
        </div>
    `;
}

function renderFolderRow(folder) {
    const selected = state.selectedItems.has(`folder-${folder.id}`) ? 'selected' : '';
    return `
        <div class="file-list-row ${selected}" onclick="onItemClick(event, 'folder', ${folder.id})" ondblclick="navigateTo(${folder.id})">
            <div class="fl-col fl-name">
                <input type="checkbox" class="file-checkbox" ${selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect('folder', ${folder.id})">
                <i class="fas fa-folder file-icon-sm" style="color:#f59e0b"></i>
                <span>${escapeHtml(folder.name)}</span>
            </div>
            <div class="fl-col fl-size">—</div>
            <div class="fl-col fl-date">${formatDate(folder.created_at)}</div>
            <div class="fl-col fl-actions">
                <button class="btn-icon" onclick="event.stopPropagation(); showItemMenu(event, 'folder', ${folder.id})">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
            </div>
        </div>
    `;
}

function renderFileRow(file) {
    const selected = state.selectedItems.has(`file-${file.id}`) ? 'selected' : '';
    return `
        <div class="file-list-row ${selected}" onclick="onItemClick(event, 'file', ${file.id})" ondblclick="previewFile(${file.id})">
            <div class="fl-col fl-name">
                <input type="checkbox" class="file-checkbox" ${selected ? 'checked' : ''} onclick="event.stopPropagation(); toggleSelect('file', ${file.id})">
                <i class="fas ${getFileIcon(file)} file-icon-sm" style="color:${getFileColor(file)}"></i>
                <span title="${escapeHtml(file.original_name || file.name)}">${escapeHtml(file.original_name || file.name)}</span>
            </div>
            <div class="fl-col fl-size">${formatBytes(file.size)}</div>
            <div class="fl-col fl-date">${formatDate(file.updated_at || file.created_at)}</div>
            <div class="fl-col fl-actions">
                <button class="btn-icon" onclick="event.stopPropagation(); showItemMenu(event, 'file', ${file.id})">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
            </div>
        </div>
    `;
}

function getFileIcon(file) {
    const ext = (file.extension || '').toLowerCase();
    if (file.is_image || ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) return 'fa-file-image';
    if (['.mp4', '.webm', '.mov', '.avi', '.mkv'].includes(ext)) return 'fa-file-video';
    if (['.mp3', '.wav', '.flac', '.ogg'].includes(ext)) return 'fa-file-audio';
    if (ext === '.pdf') return 'fa-file-pdf';
    if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return 'fa-file-archive';
    if (['.css', '.js', '.html', '.py', '.php', '.java', '.ts'].includes(ext)) return 'fa-file-code';
    if (['.txt', '.md', '.csv', '.json', '.xml'].includes(ext)) return 'fa-file-alt';
    return 'fa-file';
}

function getFileIconClass(file) {
    const ext = (file.extension || '').toLowerCase();
    if (file.is_image) return 'image';
    if (['.mp4', '.webm', '.mov'].includes(ext)) return 'video';
    if (['.mp3', '.wav', '.flac'].includes(ext)) return 'audio';
    if (ext === '.pdf') return 'pdf';
    if (['.css', '.js', '.html', '.py', '.php'].includes(ext)) return 'code';
    if (['.txt', '.md', '.csv', '.json'].includes(ext)) return 'text';
    if (['.zip', '.rar', '.7z'].includes(ext)) return 'archive';
    return 'default';
}

function getFileColor(file) {
    const cls = getFileIconClass(file);
    const colors = { image: '#22c55e', video: '#ec4899', audio: '#8b5cf6', pdf: '#ef4444', code: '#3b82f6', text: '#64748b', archive: '#78716c', default: '#94a3b8' };
    return colors[cls] || colors.default;
}

// ===== Navigation =====
function navigateTo(folderId) {
    state.currentFolderId = folderId;
    state.selectedItems.clear();
    state.searchQuery = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClearBtn').style.display = 'none';
    loadFiles(folderId);
}

// ===== Selection =====
function onItemClick(e, type, id) {
    if (e.target.classList.contains('file-checkbox') || e.target.tagName === 'INPUT') return;
    if (e.target.closest('.file-actions-menu')) return;
    // Single click - toggle selection with Ctrl, or just highlight
    if (e.ctrlKey || e.metaKey) {
        toggleSelect(type, id);
    }
}

function toggleSelect(type, id) {
    const key = `${type}-${id}`;
    if (state.selectedItems.has(key)) {
        state.selectedItems.delete(key);
    } else {
        state.selectedItems.add(key);
    }
    renderFiles();
}

function toggleSelectAll() {
    const allKeys = [
        ...state.items.folders.map(f => `folder-${f.id}`),
        ...state.items.files.map(f => `file-${f.id}`)
    ];

    if (state.selectedItems.size === allKeys.length && allKeys.length > 0) {
        state.selectedItems.clear();
    } else {
        state.selectedItems = new Set(allKeys);
    }
    renderFiles();
}

function updateSelectionUI() {
    const count = state.selectedItems.size;
    document.getElementById('batchActions').style.display = count > 0 ? 'flex' : 'none';
    document.getElementById('selectedCount').textContent = count > 0 ? I18n.t('files.selected_count', { count }) : '';
}

function getSelectedFileIds() {
    return [...state.selectedItems]
        .filter(k => k.startsWith('file-'))
        .map(k => parseInt(k.split('-')[1]));
}

function getSelectedFolderIds() {
    return [...state.selectedItems]
        .filter(k => k.startsWith('folder-'))
        .map(k => parseInt(k.split('-')[1]));
}

// ===== Item Actions Menu =====
function showItemMenu(e, type, id) {
    e.stopPropagation();
    // Simple context menu - for now use prompt-based actions
    const item = type === 'folder'
        ? state.items.folders.find(f => f.id === id)
        : state.items.files.find(f => f.id === id);

    if (!item) return;

    // Create a simple dropdown
    const existing = document.getElementById('contextMenu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'contextMenu';
    menu.className = 'dropdown-menu show';
    menu.style.position = 'fixed';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.style.zIndex = '10000';

    let actions = `
        <a onclick="renameItem('${type}', ${id}); closeContextMenu()"><i class="fas fa-i-cursor"></i> ${I18n.t('files.rename')}</a>
        <a onclick="downloadItem('${type}', ${id}); closeContextMenu()"><i class="fas fa-download"></i> ${I18n.t('files.download')}</a>
    `;

    if (type === 'file') {
        actions += `
            <a onclick="previewFile(${id}); closeContextMenu()"><i class="fas fa-eye"></i> ${I18n.t('files.preview')}</a>
        `;
        if (isEditableFile(item)) {
            actions += `<a onclick="editFile(${id}); closeContextMenu()"><i class="fas fa-code"></i> ${I18n.t('files.edit')}</a>`;
        }
        actions += `<a onclick="showFileInfo(${id}); closeContextMenu()"><i class="fas fa-info-circle"></i> ${I18n.t('files.file_info')}</a>`;
    }

    actions += `
        <div class="dropdown-divider"></div>
        <a onclick="deleteItem('${type}', ${id}); closeContextMenu()" class="logout-link"><i class="fas fa-trash"></i> ${I18n.t('files.delete')}</a>
    `;

    menu.innerHTML = actions;
    document.body.appendChild(menu);

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', closeContextMenu, { once: true });
    }, 0);
}

function closeContextMenu() {
    const menu = document.getElementById('contextMenu');
    if (menu) menu.remove();
}

// ===== Folder Operations =====
async function createFolder() {
    const name = prompt(I18n.t('folder.enter_name'));
    if (!name) return;

    try {
        await API.folders.create(name, state.currentFolderId);
        showToast('success', I18n.t('files.folder_created'));
        loadFiles();
    } catch (e) {
        showToast('error', e.message);
    }
}

function navigateToFolder(folderId) {
    navigateTo(folderId);
}

// ===== Upload =====
function showUploadModal() {
    document.getElementById('uploadList').innerHTML = '';
    document.getElementById('fileInput').value = '';
    showModal('uploadModal');
}

function handleFileSelect(e) {
    handleFiles(e.target.files);
}

let pendingFiles = [];

function handleFiles(fileList) {
    const uploadList = document.getElementById('uploadList');
    pendingFiles = [...pendingFiles, ...Array.from(fileList)];

    uploadList.innerHTML = pendingFiles.map((file, i) => `
        <div class="upload-item" data-index="${i}">
            <div class="upload-name">
                <i class="fas ${getFileIcon({ extension: '.' + file.name.split('.').pop() })}"></i>
                <span>${escapeHtml(file.name)}</span>
            </div>
            <div class="upload-size">${formatBytes(file.size)}</div>
            <button class="btn-icon" onclick="removePendingFile(${i})"><i class="fas fa-times"></i></button>
        </div>
    `).join('');
}

function removePendingFile(index) {
    pendingFiles.splice(index, 1);
    handleFiles([]);
    pendingFiles.forEach(f => {});
    // Re-render
    const uploadList = document.getElementById('uploadList');
    uploadList.innerHTML = pendingFiles.map((file, i) => `
        <div class="upload-item" data-index="${i}">
            <div class="upload-name">
                <i class="fas ${getFileIcon({ extension: '.' + file.name.split('.').pop() })}"></i>
                <span>${escapeHtml(file.name)}</span>
            </div>
            <div class="upload-size">${formatBytes(file.size)}</div>
            <button class="btn-icon" onclick="removePendingFile(${i})"><i class="fas fa-times"></i></button>
        </div>
    `).join('');
}

async function startUpload() {
    if (pendingFiles.length === 0) {
        showToast('warning', I18n.t('files.no_files_selected'));
        return;
    }

    const formData = new FormData();
    formData.append('folder_id', state.currentFolderId || '');

    for (const file of pendingFiles) {
        formData.append('files', file);
    }

    const uploadBtn = document.getElementById('uploadBtn');
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';

    try {
        const res = await API.files.upload(formData);
        showToast('success', I18n.t('files.upload_success', { count: res.uploaded }));
        closeModal('uploadModal');
        pendingFiles = [];
        loadFiles();
        loadQuota();
    } catch (e) {
        showToast('error', e.message);
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = I18n.t('files.upload');
    }
}

// ===== Download =====
function downloadItem(type, id) {
    if (type === 'file') {
        API.files.download(id);
    }
}

async function batchDownload() {
    const fileIds = getSelectedFileIds();
    if (fileIds.length === 0) {
        showToast('warning', I18n.t('files.no_files_selected'));
        return;
    }
    try {
        await API.files.downloadZip(fileIds);
    } catch (e) {
        showToast('error', e.message);
    }
}

// ===== Preview =====
async function previewFile(id) {
    const file = state.items.files.find(f => f.id === id);
    if (!file) return;

    document.getElementById('previewFilename').textContent = file.original_name || file.name;
    const body = document.getElementById('previewBody');
    body.innerHTML = '<div class="spinner"></div>';

    showModal('previewModal');

    const ext = (file.extension || '').toLowerCase();

    if (file.is_image) {
        body.innerHTML = `<img src="${API.files.preview(id)}" alt="${escapeHtml(file.original_name)}">`;
    } else if (['.mp4', '.webm', '.mov'].includes(ext)) {
        body.innerHTML = `<video controls><source src="${API.files.preview(id)}" type="${file.mime_type}"></video>`;
    } else if (['.mp3', '.wav', '.flac', '.ogg'].includes(ext)) {
        body.innerHTML = `<audio controls><source src="${API.files.preview(id)}" type="${file.mime_type}"></audio>`;
    } else if (ext === '.pdf') {
        body.innerHTML = `<iframe src="${API.files.preview(id)}"></iframe>`;
    } else {
        // Text preview
        try {
            const res = await API.files.content(id);
            body.innerHTML = `<pre>${escapeHtml(res.content)}</pre>`;
        } catch (e) {
            body.innerHTML = `<p style="color:#fff;padding:20px">Preview not available</p>`;
        }
    }
}

// ===== Edit =====
async function editFile(id) {
    const file = state.items.files.find(f => f.id === id);
    if (!file) return;

    document.getElementById('editorFilename').textContent = file.original_name || file.name;
    document.getElementById('editorStatus').textContent = '';
    state.editingFileId = id;

    showModal('editorModal');

    try {
        const res = await API.files.content(id);
        const textarea = document.getElementById('codeEditor');

        if (state.editor) {
            state.editor.toTextArea();
            state.editor = null;
        }

        textarea.value = res.content;

        const mode = getEditorMode(file.extension);
        state.editor = CodeMirror.fromTextArea(textarea, {
            mode: mode,
            theme: 'material-darker',
            lineNumbers: true,
            lineWrapping: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            indentUnit: 4,
            tabSize: 4,
            extraKeys: {
                'Ctrl-S': () => saveFileContent(),
                'Cmd-S': () => saveFileContent(),
                'F11': (cm) => cm.setOption('fullScreen', !cm.getOption('fullScreen')),
                'Esc': (cm) => {
                    if (cm.getOption('fullScreen')) cm.setOption('fullScreen', false);
                }
            }
        });

        state.editor.on('change', () => {
            document.getElementById('editorStatus').textContent = 'Modified';
        });
    } catch (e) {
        showToast('error', e.message);
    }
}

async function saveFileContent() {
    if (!state.editingFileId || !state.editor) return;

    const content = state.editor.getValue();

    try {
        await API.files.updateContent(state.editingFileId, content);
        document.getElementById('editorStatus').textContent = 'Saved';
        showToast('success', I18n.t('files.save_success'));
        loadFiles();
        loadQuota();
    } catch (e) {
        showToast('error', e.message);
    }
}

// ===== File Info =====
async function showFileInfo(id) {
    try {
        const file = await API.files.info(id);
        const body = document.getElementById('infoModalBody');

        let html = `
            <div class="info-row"><span class="info-label">${I18n.t('files.name')}</span><span class="info-value">${escapeHtml(file.original_name || file.name)}</span></div>
            <div class="info-row"><span class="info-label">${I18n.t('files.size')}</span><span class="info-value">${formatBytes(file.size)}</span></div>
            <div class="info-row"><span class="info-label">${I18n.t('files.type')}</span><span class="info-value">${escapeHtml(file.mime_type || file.extension || 'Unknown')}</span></div>
            <div class="info-row"><span class="info-label">${I18n.t('files.created')}</span><span class="info-value">${formatDate(file.created_at)}</span></div>
            <div class="info-row"><span class="info-label">${I18n.t('files.modified')}</span><span class="info-value">${formatDate(file.updated_at)}</span></div>
        `;

        if (file.is_image && file.imageMeta) {
            html += `<div class="info-row"><span class="info-label">${I18n.t('files.dimensions')}</span><span class="info-value">${file.imageMeta.width} × ${file.imageMeta.height}</span></div>`;
            if (file.imageMeta.format) {
                html += `<div class="info-row"><span class="info-label">Format</span><span class="info-value">${file.imageMeta.format.toUpperCase()}</span></div>`;
            }

            // EXIF data section
            const exif = file.imageMeta.exif;
            if (exif) {
                html += `
                    <div class="info-section">
                        <div class="info-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                            <i class="fas fa-camera"></i>
                            <span>${I18n.t('files.exif_data')}</span>
                            <i class="fas fa-chevron-down info-chevron"></i>
                        </div>
                        <div class="info-section-body">
                `;

                if (exif.camera) {
                    const cameraStr = [exif.camera.make, exif.camera.model].filter(Boolean).join(' ');
                    html += `<div class="info-row"><span class="info-label">${I18n.t('files.exif_camera')}</span><span class="info-value">${escapeHtml(cameraStr)}</span></div>`;
                }
                if (exif.dateTaken) {
                    html += `<div class="info-row"><span class="info-label">${I18n.t('files.exif_date_taken')}</span><span class="info-value">${formatDate(exif.dateTaken)}</span></div>`;
                }
                if (exif.exposure) {
                    const expParts = [];
                    if (exif.exposure.aperture) expParts.push(`f/${exif.exposure.aperture}`);
                    if (exif.exposure.shutter) {
                        const shutter = exif.exposure.shutter;
                        expParts.push(shutter < 1 ? `1/${Math.round(1 / shutter)}s` : `${shutter}s`);
                    }
                    if (exif.exposure.iso) expParts.push(`ISO ${exif.exposure.iso}`);
                    if (expParts.length > 0) {
                        html += `<div class="info-row"><span class="info-label">${I18n.t('files.exif_exposure')}</span><span class="info-value">${expParts.join(' | ')}</span></div>`;
                    }
                }
                if (exif.focalLength) {
                    html += `<div class="info-row"><span class="info-label">${I18n.t('files.exif_focal_length')}</span><span class="info-value">${exif.focalLength}mm</span></div>`;
                }
                if (exif.orientation) {
                    html += `<div class="info-row"><span class="info-label">${I18n.t('files.exif_orientation')}</span><span class="info-value">${exif.orientation}</span></div>`;
                }
                if (exif.gps) {
                    html += `<div class="info-row"><span class="info-label">${I18n.t('files.exif_gps')}</span><span class="info-value">${exif.gps.lat.toFixed(6)}, ${exif.gps.lng.toFixed(6)}</span></div>`;
                }
                if (exif.software) {
                    html += `<div class="info-row"><span class="info-label">${I18n.t('files.exif_software')}</span><span class="info-value">${escapeHtml(exif.software)}</span></div>`;
                }

                html += `</div></div>`;
            } else if (file.is_image) {
                html += `<div class="info-row"><span class="info-label">${I18n.t('files.exif_data')}</span><span class="info-value">${I18n.t('files.exif_no_data')}</span></div>`;
            }
        }

        body.innerHTML = html;
        showModal('infoModal');
    } catch (e) {
        showToast('error', e.message);
    }
}

// ===== Rename =====
function renameItem(type, id) {
    state.renameTarget = { type, id };
    state.renameType = type;

    const item = type === 'folder'
        ? state.items.folders.find(f => f.id === id)
        : state.items.files.find(f => f.id === id);

    if (!item) return;

    const input = document.getElementById('renameInput');
    input.value = type === 'folder' ? item.name : (item.original_name || item.name);
    showModal('renameModal');
    input.focus();
    input.select();
}

async function confirmRename() {
    const newName = document.getElementById('renameInput').value.trim();
    if (!newName) return;

    const { type, id } = state.renameTarget;

    try {
        if (type === 'folder') {
            await API.folders.rename(id, newName);
        } else {
            await API.files.rename(id, newName);
        }
        showToast('success', I18n.t('files.rename_success'));
        closeModal('renameModal');
        loadFiles();
    } catch (e) {
        showToast('error', e.message);
    }
}

// ===== Delete =====
async function deleteItem(type, id) {
    const item = type === 'folder'
        ? state.items.folders.find(f => f.id === id)
        : state.items.files.find(f => f.id === id);

    const confirmMsg = type === 'folder'
        ? I18n.t('files.confirm_delete_folder')
        : I18n.t('files.confirm_delete');

    if (!confirm(confirmMsg)) return;

    try {
        if (type === 'folder') {
            await API.folders.delete(id);
        } else {
            await API.files.delete(id);
        }
        showToast('success', I18n.t('files.delete_success'));
        loadFiles();
        loadQuota();
    } catch (e) {
        showToast('error', e.message);
    }
}

async function batchDelete() {
    const fileIds = getSelectedFileIds();
    const folderIds = getSelectedFolderIds();

    if (fileIds.length === 0 && folderIds.length === 0) {
        showToast('warning', I18n.t('files.no_files_selected'));
        return;
    }

    if (!confirm(I18n.t('files.confirm_delete_multiple', { count: fileIds.length + folderIds.length }))) return;

    try {
        if (fileIds.length > 0) {
            await API.files.batchDelete(fileIds);
        }
        for (const fid of folderIds) {
            await API.folders.delete(fid);
        }
        showToast('success', I18n.t('files.delete_success'));
        state.selectedItems.clear();
        loadFiles();
        loadQuota();
    } catch (e) {
        showToast('error', e.message);
    }
}

// ===== Move/Copy =====
async function showMoveCopyModal(action) {
    const fileIds = getSelectedFileIds();
    if (fileIds.length === 0) {
        showToast('warning', I18n.t('files.no_files_selected'));
        return;
    }

    state.moveCopyAction = action;
    document.getElementById('moveCopyTitle').innerHTML = `<i class="fas fa-folder"></i> ${I18n.t('files.select_folder')}`;

    // Load folder tree
    try {
        const tree = await API.folders.tree();
        renderFolderTree(tree, 'folderTree');
        showModal('moveCopyModal');
    } catch (e) {
        showToast('error', e.message);
    }
}

function renderFolderTree(nodes, containerId, level = 0) {
    const container = document.getElementById(containerId);
    let html = '';
    for (const node of nodes) {
        const isCurrent = node.id === state.currentFolderId;
        html += `
            <div class="tree-item ${isCurrent ? 'disabled' : ''}" style="padding-left:${12 + level * 20}px"
                 onclick="${isCurrent ? '' : `selectMoveCopyTarget(${node.id}, this)`}">
                <i class="fas fa-folder"></i>
                <span>${escapeHtml(node.name)}</span>
            </div>
        `;
        if (node.children && node.children.length > 0) {
            html += `<div class="tree-children">`;
            for (const child of node.children) {
                html += renderTreeNode(child, level + 1);
            }
            html += `</div>`;
        }
    }
    container.innerHTML = html;
}

function renderTreeNode(node, level) {
    let html = `
        <div class="tree-item" style="padding-left:${12 + level * 20}px"
             onclick="selectMoveCopyTarget(${node.id}, this)">
            <i class="fas fa-folder"></i>
            <span>${escapeHtml(node.name)}</span>
        </div>
    `;
    if (node.children && node.children.length > 0) {
        html += `<div class="tree-children">`;
        for (const child of node.children) {
            html += renderTreeNode(child, level + 1);
        }
        html += `</div>`;
    }
    return html;
}

function selectMoveCopyTarget(folderId, el) {
    document.querySelectorAll('.tree-item').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
    state.moveCopyTargetFolder = folderId;
}

async function confirmMoveCopy() {
    if (!state.moveCopyTargetFolder) {
        showToast('warning', I18n.t('files.select_folder'));
        return;
    }

    const fileIds = getSelectedFileIds();

    try {
        if (state.moveCopyAction === 'move') {
            await API.files.move(fileIds, state.moveCopyTargetFolder);
            showToast('success', I18n.t('files.move_success'));
        } else {
            await API.files.copy(fileIds, state.moveCopyTargetFolder);
            showToast('success', I18n.t('files.copy_success'));
        }
        closeModal('moveCopyModal');
        state.selectedItems.clear();
        loadFiles();
        loadQuota();
    } catch (e) {
        showToast('error', e.message);
    }
}

// ===== Search =====
function clearSearch() {
    document.getElementById('searchInput').value = '';
    state.searchQuery = '';
    document.getElementById('searchClearBtn').style.display = 'none';
    loadFiles();
}

// ===== View Toggle =====
function setView(view) {
    state.currentView = view;
    document.getElementById('gridViewBtn').classList.toggle('active', view === 'grid');
    document.getElementById('listViewBtn').classList.toggle('active', view === 'list');
    localStorage.setItem('viewMode', view);
    renderFiles();
}

// ===== Quota =====
async function loadQuota() {
    try {
        const res = await API.auth.me();
        if (!res.user) return;
        const quota = await API.users.quota(res.user.id);

        const percentage = quota.percentage;
        const fill = document.getElementById('quotaFill');
        fill.style.width = percentage + '%';
        fill.className = 'quota-fill' + (percentage > 90 ? ' danger' : percentage > 75 ? ' warning' : '');

        document.getElementById('quotaPercentage').textContent = percentage + '%';
        document.getElementById('quotaText').textContent = `${formatBytes(quota.used)} / ${formatBytes(quota.quota)}`;
    } catch (e) {
        // Ignore quota errors
    }
}

// ===== Settings =====
async function openSettings() {
    try {
        const res = await API.settings.get();
        const settings = res.settings || {};
        const isAdmin = res.settings && 'max_file_size' in res.settings;

        const body = document.getElementById('settingsModalBody');
        let html = '';

        if (isAdmin) {
            html = `
                <div class="form-group">
                    <label>${I18n.t('settings.app_name')}</label>
                    <input type="text" id="setAppName" value="${escapeHtml(settings.app_name || '')}">
                </div>
                <div class="form-group">
                    <label>${I18n.t('settings.default_language')}</label>
                    <select id="setDefaultLang">
                        <option value="en" ${settings.default_language === 'en' ? 'selected' : ''}>English</option>
                        <option value="zh-CN" ${settings.default_language === 'zh-CN' ? 'selected' : ''}>简体中文</option>
                        <option value="zh-HK" ${settings.default_language === 'zh-HK' ? 'selected' : ''}>繁體中文</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>${I18n.t('settings.allow_registration')}</label>
                    <select id="setAllowReg">
                        <option value="0" ${settings.allow_registration === '0' ? 'selected' : ''}>No</option>
                        <option value="1" ${settings.allow_registration === '1' ? 'selected' : ''}>Yes</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>${I18n.t('settings.max_file_size')}</label>
                    <input type="number" id="setMaxFileSize" value="${settings.max_file_size || ''}">
                </div>
                <div class="form-group">
                    <label>${I18n.t('settings.default_quota')}</label>
                    <input type="number" id="setDefaultQuota" value="${settings.default_quota || ''}">
                </div>
                <div class="form-group">
                    <label>${I18n.t('settings.allowed_extensions')}</label>
                    <input type="text" id="setAllowedExt" value="${escapeHtml(settings.allowed_extensions || '')}" placeholder=".jpg,.png,.pdf">
                </div>
            `;
        } else {
            html = `<p>${I18n.t('settings.default_language')}: ${settings.default_language || 'en'}</p>`;
        }

        body.innerHTML = html;
        showModal('settingsModal');
    } catch (e) {
        showToast('error', e.message);
    }
}

async function saveSettings() {
    const data = {};
    const fields = [
        ['setAppName', 'app_name'],
        ['setDefaultLang', 'default_language'],
        ['setAllowReg', 'allow_registration'],
        ['setMaxFileSize', 'max_file_size'],
        ['setDefaultQuota', 'default_quota'],
        ['setAllowedExt', 'allowed_extensions']
    ];

    for (const [elId, key] of fields) {
        const el = document.getElementById(elId);
        if (el) data[key] = el.value;
    }

    try {
        await API.settings.update(data);
        showToast('success', I18n.t('settings.saved'));
        closeModal('settingsModal');
    } catch (e) {
        showToast('error', e.message);
    }
}

// ===== User Management =====
async function openUserManagement() {
    try {
        const res = await API.users.list();
        const body = document.getElementById('userMgmtBody');

        let html = `
            <div style="margin-bottom:16px">
                <button class="btn btn-primary" onclick="showCreateUserForm()"><i class="fas fa-user-plus"></i> ${I18n.t('admin.add_user')}</button>
            </div>
            <table class="user-table">
                <thead>
                    <tr>
                        <th>${I18n.t('admin.username')}</th>
                        <th>${I18n.t('admin.email')}</th>
                        <th>${I18n.t('admin.role')}</th>
                        <th>${I18n.t('admin.status')}</th>
                        <th>${I18n.t('admin.quota')}</th>
                        <th>${I18n.t('admin.actions')}</th>
                    </tr>
                </thead>
                <tbody>
        `;

        for (const user of res.users) {
            html += `
                <tr>
                    <td>${escapeHtml(user.username)}</td>
                    <td>${escapeHtml(user.email || '—')}</td>
                    <td><span class="badge ${user.role}">${user.role}</span></td>
                    <td><span class="badge ${user.is_active ? 'active' : 'inactive'}">${user.is_active ? I18n.t('admin.active') : I18n.t('admin.inactive')}</span></td>
                    <td>${formatBytes(user.used_bytes)} / ${formatBytes(user.quota_bytes)}</td>
                    <td>
                        <button class="btn-icon" onclick="editUser(${user.id})" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon" onclick="deleteUser(${user.id})" title="Delete"><i class="fas fa-trash" style="color:var(--danger)"></i></button>
                    </td>
                </tr>
            `;
        }

        html += '</tbody></table>';
        body.innerHTML = html;
        showModal('userMgmtModal');
    } catch (e) {
        showToast('error', e.message);
    }
}

function showCreateUserForm() {
    const body = document.getElementById('userMgmtBody');
    body.innerHTML = `
        <div style="max-width:500px;margin:12px">
            <h3 style="margin-bottom:20px">${I18n.t('admin.create_user')}</h3>
            <div class="form-group">
                <label>${I18n.t('admin.username')}</label>
                <input type="text" id="newUsername">
            </div>
            <div class="form-group">
                <label>${I18n.t('auth.password')}</label>
                <input type="password" id="newPassword">
            </div>
            <div class="form-group">
                <label>${I18n.t('admin.email')}</label>
                <input type="email" id="newEmail">
            </div>
            <div class="form-group">
                <label>${I18n.t('admin.role')}</label>
                <select id="newRole">
                    <option value="user">${I18n.t('admin.user')}</option>
                    <option value="admin">${I18n.t('admin.admin')}</option>
                </select>
            </div>
            <div class="form-group">
                <label>${I18n.t('admin.quota')} (bytes)</label>
                <input type="number" id="newQuota" value="10737418240">
            </div>
            <div style="display:flex;gap:10px;margin-top:20px">
                <button class="btn btn-outline" onclick="openUserManagement()">${I18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="createUser()">${I18n.t('common.save')}</button>
            </div>
        </div>
    `;
}

async function createUser() {
    const data = {
        username: document.getElementById('newUsername').value,
        password: document.getElementById('newPassword').value,
        email: document.getElementById('newEmail').value,
        role: document.getElementById('newRole').value,
        quotaBytes: parseInt(document.getElementById('newQuota').value)
    };

    if (!data.username || !data.password) {
        showToast('warning', I18n.t('auth.username') + ' & ' + I18n.t('auth.password'));
        return;
    }

    try {
        await API.users.create(data);
        showToast('success', I18n.t('common.success'));
        openUserManagement();
    } catch (e) {
        showToast('error', e.message);
    }
}

async function editUser(id) {
    try {
        const res = await API.users.list();
        const user = res.users.find(u => u.id === id);
        if (!user) return;

        const body = document.getElementById('userMgmtBody');
        body.innerHTML = `
            <div style="max-width:700px;margin:0 auto">
                <h3 style="margin-bottom:20px">${I18n.t('admin.edit_user')}: ${escapeHtml(user.username)}</h3>
                <div class="form-group">
                    <label>${I18n.t('admin.email')}</label>
                    <input type="email" id="editEmail" value="${escapeHtml(user.email || '')}">
                </div>
                <div class="form-group">
                    <label>${I18n.t('admin.role')}</label>
                    <select id="editRole">
                        <option value="user" ${user.role === 'user' ? 'selected' : ''}>${I18n.t('admin.user')}</option>
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>${I18n.t('admin.admin')}</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>${I18n.t('admin.status')}</label>
                    <select id="editActive">
                        <option value="1" ${user.is_active ? 'selected' : ''}>${I18n.t('admin.active')}</option>
                        <option value="0" ${!user.is_active ? 'selected' : ''}>${I18n.t('admin.inactive')}</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>${I18n.t('admin.quota')} (bytes)</label>
                    <input type="number" id="editQuota" value="${user.quota_bytes}">
                </div>
                <div class="form-group">
                    <label>${I18n.t('auth.new_password')} (leave blank to keep)</label>
                    <input type="password" id="editPassword">
                </div>

                <div class="permissions-section" id="permissionsSection">
                    <h4 style="margin:24px 0 12px;border-bottom:1px solid var(--border);padding-bottom:8px">
                        <i class="fas fa-shield-alt"></i> ${I18n.t('admin.folder_permissions')}
                    </h4>
                    <div id="permissionsList" style="margin-bottom:16px">
                        <p style="color:var(--text-secondary)">${I18n.t('common.loading')}</p>
                    </div>
                    <div class="permission-add-form" id="permissionAddForm" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
                        <div class="form-group" style="flex:1;min-width:200px;margin-bottom:0">
                            <label>${I18n.t('admin.select_folder_permission')}</label>
                            <select id="permFolderSelect"><option value="">${I18n.t('admin.select_folder_permission')}</option></select>
                        </div>
                        <div class="form-group" style="min-width:140px;margin-bottom:0">
                            <label>${I18n.t('admin.permission_level')}</label>
                            <select id="permLevelSelect">
                                <option value="read">${I18n.t('admin.permission_read')}</option>
                                <option value="write">${I18n.t('admin.permission_write')}</option>
                                <option value="admin">${I18n.t('admin.permission_admin')}</option>
                            </select>
                        </div>
                        <button class="btn btn-primary" onclick="addUserPermission(${id})" style="margin-bottom:0">
                            <i class="fas fa-plus"></i> ${I18n.t('admin.add_permission')}
                        </button>
                    </div>
                </div>

                <div style="display:flex;gap:10px;margin-top:24px">
                    <button class="btn btn-outline" onclick="openUserManagement()">${I18n.t('common.cancel')}</button>
                    <button class="btn btn-primary" onclick="saveUser(${id})">${I18n.t('common.save')}</button>
                </div>
            </div>
        `;

        // Load permissions and folder tree asynchronously
        loadUserPermissions(id);
    } catch (e) {
        showToast('error', e.message);
    }
}

async function loadUserPermissions(userId) {
    try {
        const [permsRes, treeRes] = await Promise.all([
            API.users.permissions(userId),
            API.folders.tree()
        ]);
        renderUserPermissions(userId, permsRes.permissions || []);

        // Populate folder select
        const select = document.getElementById('permFolderSelect');
        let options = '<option value="">' + I18n.t('admin.select_folder_permission') + '</option>';
        function walkTree(nodes, prefix) {
            for (const node of nodes) {
                options += `<option value="${node.id}">${escapeHtml(prefix + node.name)}</option>`;
                if (node.children && node.children.length > 0) {
                    walkTree(node.children, prefix + node.name + ' / ');
                }
            }
        }
        walkTree(treeRes.folders || treeRes || [], '');
        select.innerHTML = options;
    } catch (e) {
        document.getElementById('permissionsList').innerHTML =
            '<p style="color:var(--danger)">' + escapeHtml(e.message) + '</p>';
    }
}

function renderUserPermissions(userId, permissions) {
    const container = document.getElementById('permissionsList');
    if (!permissions || permissions.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary)">' + I18n.t('admin.no_permissions') + '</p>';
        return;
    }

    const permLabels = {
        'read': I18n.t('admin.permission_read'),
        'write': I18n.t('admin.permission_write'),
        'admin': I18n.t('admin.permission_admin')
    };
    const permBadges = {
        'read': '<span class="badge" style="background:#3b82f6">read</span>',
        'write': '<span class="badge" style="background:#22c55e">write</span>',
        'admin': '<span class="badge" style="background:#ef4444">admin</span>'
    };

    container.innerHTML = permissions.map(p => `
        <div class="permission-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:8px">
                <i class="fas fa-folder" style="color:#f59e0b"></i>
                <span>${escapeHtml(p.folder_name || 'Folder #' + p.folder_id)}</span>
                ${permBadges[p.permission] || p.permission}
            </div>
            <button class="btn-icon" onclick="removeUserPermission(${userId}, ${p.folder_id})" title="${I18n.t('common.delete')}">
                <i class="fas fa-trash" style="color:var(--danger)"></i>
            </button>
        </div>
    `).join('');
}

async function addUserPermission(userId) {
    const folderId = document.getElementById('permFolderSelect').value;
    const permission = document.getElementById('permLevelSelect').value;

    if (!folderId) {
        showToast('warning', I18n.t('admin.select_folder_permission'));
        return;
    }

    try {
        await API.users.setPermission(userId, parseInt(folderId), permission);
        showToast('success', I18n.t('admin.permission_added'));
        // Reload permissions
        const permsRes = await API.users.permissions(userId);
        renderUserPermissions(userId, permsRes.permissions || []);
        // Reset select
        document.getElementById('permFolderSelect').value = '';
    } catch (e) {
        showToast('error', e.message);
    }
}

async function removeUserPermission(userId, folderId) {
    try {
        await API.users.removePermission(userId, folderId);
        showToast('success', I18n.t('admin.permission_removed'));
        // Reload permissions
        const permsRes = await API.users.permissions(userId);
        renderUserPermissions(userId, permsRes.permissions || []);
    } catch (e) {
        showToast('error', e.message);
    }
}

async function saveUser(id) {
    const updates = {
        email: document.getElementById('editEmail').value,
        role: document.getElementById('editRole').value,
        is_active: parseInt(document.getElementById('editActive').value),
        quota_bytes: parseInt(document.getElementById('editQuota').value)
    };

    const password = document.getElementById('editPassword').value;
    if (password) updates.password = password;

    try {
        await API.users.update(id, updates);
        showToast('success', I18n.t('common.success'));
        openUserManagement();
    } catch (e) {
        showToast('error', e.message);
    }
}

async function deleteUser(id) {
    if (!confirm(I18n.t('admin.confirm_delete_user'))) return;
    try {
        await API.users.delete(id);
        showToast('success', I18n.t('common.success'));
        openUserManagement();
    } catch (e) {
        showToast('error', e.message);
    }
}

// ===== Change Password =====
function openChangePassword() {
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    document.getElementById('passwordError').textContent = '';
    showModal('passwordModal');
}

async function changePassword() {
    const current = document.getElementById('currentPassword').value;
    const newPass = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;
    const errorEl = document.getElementById('passwordError');

    if (newPass !== confirm) {
        errorEl.textContent = I18n.t('auth.passwords_not_match');
        return;
    }

    if (newPass.length < 6) {
        errorEl.textContent = I18n.t('auth.password_too_short');
        return;
    }

    try {
        await API.auth.changePassword(current, newPass);
        showToast('success', I18n.t('auth.password_changed'));
        closeModal('passwordModal');
    } catch (e) {
        errorEl.textContent = e.message;
    }
}

// ===== UI Helpers =====
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('collapsed');
    document.getElementById('sidebar').classList.toggle('show');
}

function toggleUserMenu() {
    document.getElementById('userDropdown').classList.toggle('show');
}

function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

function showModal(id) {
    document.getElementById(id).style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
    if (state.editor && id === 'editorModal') {
        state.editor.toTextArea();
        state.editor = null;
    }
}

function showLoading(show) {
    document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
}

function showToast(type, message) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };

    toast.innerHTML = `
        <i class="fas ${icons[type] || icons.info}"></i>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ===== Utility Functions =====
function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'Z');
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return dateStr;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isEditableFile(file) {
    const ext = (file.extension || '').toLowerCase();
    return ['.css', '.js', '.html', '.txt', '.json', '.xml', '.md', '.csv', '.yaml', '.yml', '.log', '.ini', '.conf', '.py', '.php', '.sql', '.sh', '.ts'].includes(ext);
}

function getEditorMode(ext) {
    const modes = {
        '.css': 'css', '.js': 'javascript', '.html': 'htmlmixed', '.txt': 'text',
        '.json': 'application/json', '.xml': 'xml', '.md': 'markdown', '.csv': 'text',
        '.yaml': 'yaml', '.yml': 'yaml', '.log': 'text', '.ini': 'properties',
        '.conf': 'properties', '.py': 'python', '.php': 'php', '.sql': 'sql',
        '.sh': 'shell', '.ts': 'text/typescript'
    };
    return modes[ext] || 'text';
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
        const id = e.target.id;
        closeModal(id);
    }
});

// Restore view mode
const savedView = localStorage.getItem('viewMode');
if (savedView) {
    state.currentView = savedView;
}

// Initialize
init();
