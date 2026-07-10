require('dotenv').config();

const app = require('./app');
const { initDatabase } = require('./db/init');

const PORT = process.env.PORT || 3000;

async function start() {
    try {
        // Initialize database and create default admin
        await initDatabase();

        app.listen(PORT, () => {
            console.log(`\n========================================`);
            console.log(`  File Manager is running on port ${PORT}`);
            console.log(`  http://localhost:${PORT}`);
            console.log(`========================================\n`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();
