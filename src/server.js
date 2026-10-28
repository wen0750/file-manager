require('dotenv').config();

const app = require('./app');
const { initDatabase } = require('./db/init');
const { closeDatabase } = require('./db/database');
const { startWatcher, stopWatcher } = require('./services/file-watcher.service');
const { reconcileAll } = require('./services/reconcile.service');

const PORT = process.env.PORT || 3000;
const RECONCILE_INTERVAL_MS = parseInt(
    process.env.RECONCILE_INTERVAL_MS || String(24 * 60 * 60 * 1000),
    10
);
const RECONCILE_STARTUP_DELAY_MS = parseInt(
    process.env.RECONCILE_STARTUP_DELAY_MS || '5000',
    10
);

let startupReconcileTimer = null;
let reconcileTimer = null;

async function start() {
    try {
        // Initialize database: run schema, apply migrations, create default admin
        await initDatabase();

        app.listen(PORT, () => {
            console.log(`\n========================================`);
            console.log(`  File Manager is running on port ${PORT}`);
            console.log(`  http://localhost:${PORT}`);
            console.log(`========================================\n`);
        });

        // Watch for files written outside the application (logs, files copied
        // directly into the storage directory, auto-generated files).
        startWatcher();

        // Reconcile drift from the database shortly after boot, then daily.
        startupReconcileTimer = setTimeout(() => {
            reconcileAll().catch((err) => console.error('[reconcile] startup run failed:', err));
        }, RECONCILE_STARTUP_DELAY_MS);
        reconcileTimer = setInterval(() => {
            reconcileAll().catch((err) => console.error('[reconcile] scheduled run failed:', err));
        }, RECONCILE_INTERVAL_MS);
    } catch (err) {
        console.error('Failed to start server:', err);
        await closeDatabase();
        process.exit(1);
    }
}

// Graceful shutdown
async function shutdown(signal) {
    console.log(`${signal} received, shutting down...`);
    if (startupReconcileTimer) clearTimeout(startupReconcileTimer);
    if (reconcileTimer) clearInterval(reconcileTimer);
    await stopWatcher().catch(() => {});
    await closeDatabase();
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
