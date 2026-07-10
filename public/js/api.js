/**
 * API client for communicating with the backend.
 */
const API = {
    baseUrl: '/api',

    async request(method, path, body = null, isFormData = false) {
        const options = {
            method,
            headers: {}
        };

        if (body && !isFormData) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        } else if (body && isFormData) {
            options.body = body;
        }

        const res = await fetch(this.baseUrl + path, options);
        const contentType = res.headers.get('content-type');

        if (contentType && contentType.includes('application/json')) {
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || data.message || 'Request failed');
            }
            return data;
        }

        if (!res.ok) {
            throw new Error('Request failed');
        }

        return res;
    },

    get(path) {
        return this.request('GET', path);
    },

    post(path, body) {
        return this.request('POST', path, body);
    },

    put(path, body) {
        return this.request('PUT', path, body);
    },

    delete(path) {
        return this.request('DELETE', path);
    },

    // Auth
    auth: {
        login: (username, password) => API.post('/auth/login', { username, password }),
        logout: () => API.post('/auth/logout'),
        me: () => API.get('/auth/me'),
        register: (data) => API.post('/auth/register', data),
        changePassword: (currentPassword, newPassword) =>
            API.post('/auth/change-password', { currentPassword, newPassword })
    },

    // Files
    files: {
        list: (folderId, search) => {
            let qs = '';
            if (folderId) qs += `?folder_id=${folderId}`;
            if (search) qs += `${qs ? '&' : '?'}search=${encodeURIComponent(search)}`;
            return API.get('/files' + qs);
        },
        upload: (formData) => API.request('POST', '/files/upload', formData, true),
        download: (id) => window.open(`/api/files/download/${id}`, '_blank'),
        downloadZip: (fileIds) => {
            return fetch('/api/files/download-zip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileIds })
            }).then(res => {
                if (!res.ok) throw new Error('Download failed');
                return res.blob();
            }).then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `files-${Date.now()}.zip`;
                a.click();
                URL.revokeObjectURL(url);
            });
        },
        preview: (id) => `/api/files/preview/${id}`,
        thumbnail: (id) => `/api/files/thumbnail/${id}`,
        info: (id) => API.get(`/files/info/${id}`),
        content: (id) => API.get(`/files/content/${id}`),
        updateContent: (id, content) => API.put(`/files/content/${id}`, { content }),
        rename: (id, name) => API.put(`/files/rename/${id}`, { name }),
        copy: (fileIds, targetFolderId) => API.post('/files/copy', { fileIds, targetFolderId }),
        move: (fileIds, targetFolderId) => API.post('/files/move', { fileIds, targetFolderId }),
        delete: (id) => API.delete(`/files/${id}`),
        batchDelete: (fileIds) => API.post('/files/batch-delete', { fileIds })
    },

    // Folders
    folders: {
        list: (parentId) => {
            let qs = '';
            if (parentId) qs += `?parent_id=${parentId}`;
            return API.get('/folders' + qs);
        },
        tree: () => API.get('/folders?tree=true'),
        create: (name, parentId) => API.post('/folders', { name, parentId }),
        rename: (id, name) => API.put(`/folders/${id}`, { name }),
        delete: (id) => API.delete(`/folders/${id}`)
    },

    // Users
    users: {
        list: () => API.get('/users'),
        create: (data) => API.post('/users', data),
        update: (id, data) => API.put(`/users/${id}`, data),
        delete: (id) => API.delete(`/users/${id}`),
        quota: (id) => API.get(`/users/${id}/quota`),
        permissions: (id) => API.get(`/users/${id}/permissions`),
        setPermission: (id, folderId, permission) =>
            API.post(`/users/${id}/permissions`, { folderId, permission }),
        removePermission: (id, folderId) =>
            API.delete(`/users/${id}/permissions/${folderId}`)
    },

    // Settings
    settings: {
        get: () => API.get('/settings'),
        update: (data) => API.put('/settings', data),
        setLanguage: (lang) => API.put('/settings/language', { language: lang })
    }
};
