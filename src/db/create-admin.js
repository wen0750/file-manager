const { initDatabase } = require('./init');

initDatabase({ forceAdminCreation: true })
    .then(() => {
        console.log('Admin bootstrap finished.');
    })
    .catch((error) => {
        console.error('Admin bootstrap failed:', error);
        process.exitCode = 1;
    });
