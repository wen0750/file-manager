require('dotenv').config();

const app = require('./app');
const { initDatabase } = require('./db/init');
const { closeDatabase } = require('./db/database');

const PORT = process.env.PORT || 3000;

async function start() {
    try {
        // Initialize database: run schema, create default admin
        await initDatabase();

        app.listen(PORT, () => {
            console.log(`\n========================================`);
            console.log(`  File Manager is running on port ${PORT}`);
            console.log(`  http://localhost:${PORT}`);
            console.log(`========================================\n`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        await closeDatabase();
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down...');
    await closeDatabase();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down...');
    await closeDatabase();
    process.exit(0);
});

start();
