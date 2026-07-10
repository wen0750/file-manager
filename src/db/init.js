const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

function getEnv(...keys) {
    for (const key of keys) {
        const value = process.env[key];
        if (value !== undefined && value !== '') {
            return value;
        }
    }
    return undefined;
}

function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    return /^(1|true|yes|on)$/i.test(String(value));
}

function buildConfig(withDatabase) {
    const database = getEnv('DB_NAME', 'MYSQL_DATABASE', 'DATABASE_NAME');
    const config = {
        host: getEnv('DB_HOST', 'MYSQL_HOST', 'DATABASE_HOST') || '127.0.0.1',
        port: Number(getEnv('DB_PORT', 'MYSQL_PORT', 'DATABASE_PORT') || 3306),
        user: getEnv('DB_USER', 'MYSQL_USER', 'DATABASE_USER', 'DB_USERNAME') || 'root',
        password: getEnv('DB_PASSWORD', 'MYSQL_PASSWORD', 'DATABASE_PASSWORD') || '',
        charset: 'utf8mb4',
        multipleStatements: true
    };

    if (withDatabase) {
        if (!database) {
            throw new Error('Missing database name. Set DB_NAME in .env.');
        }
        config.database = database;
    }

    return { config, database };
}

function normalizeSchema(sql) {
    return sql
        .replace(/,\s*\n\s*ENGINE=InnoDB/g, '\n) ENGINE=InnoDB');
}

function splitSqlStatements(sql) {
    return sql
        .split(/;\s*(?:\r?\n|$)/g)
        .map((statement) => statement.trim())
        .filter(Boolean);
}

async function executeSchemaStatements(connection, sql) {
    const statements = splitSqlStatements(sql);

    for (const statement of statements) {
        try {
            await connection.query(statement);
        } catch (error) {
            const normalizedStatement = statement
                .replace(/^\s*--.*$/gm, '')
                .trim();
            const isDuplicateIndex =
                error &&
                (error.code === 'ER_DUP_KEYNAME' || error.errno === 1061) &&
                /^CREATE\s+INDEX/i.test(normalizedStatement);

            if (isDuplicateIndex) {
                continue;
            }

            console.error('Failed SQL statement:', statement);
            error.sql = statement;
            throw error;
        }
    }
}

async function ensureAdminUser(connection, options = {}) {
    const autoCreateAdmin = parseBoolean(
        getEnv('AUTO_CREATE_ADMIN'),
        process.env.NODE_ENV !== 'production'
    );
    const forceCreate = options.forceCreate === true;

    if (!autoCreateAdmin && !forceCreate) {
        console.log('Admin bootstrap skipped because AUTO_CREATE_ADMIN is disabled.');
        return;
    }

    const adminUsername = getEnv('ADMIN_USERNAME') || 'admin';
    const adminPassword = getEnv('ADMIN_PASSWORD') || 'Admin@123456';
    const adminEmail = getEnv('ADMIN_EMAIL') || 'admin@local.test';
    const resetAdminPassword = parseBoolean(getEnv('RESET_ADMIN_PASSWORD'), false);

    const [rows] = await connection.query(
        'SELECT id FROM users WHERE username = ? LIMIT 1',
        [adminUsername]
    );

    if (rows.length > 0) {
        await connection.query(
            'UPDATE users SET role = ?, is_active = ?, email = COALESCE(?, email) WHERE id = ?',
            ['admin', 1, adminEmail, rows[0].id]
        );

        if (resetAdminPassword) {
            const passwordHash = await bcrypt.hash(adminPassword, 12);
            await connection.query(
                'UPDATE users SET password_hash = ? WHERE id = ?',
                [passwordHash, rows[0].id]
            );
            console.log(`Admin account password reset for "${adminUsername}".`);
        } else {
            console.log(`Admin account already exists: "${adminUsername}".`);
        }

        return;
    }

    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await connection.query(
        `INSERT INTO users (
            username,
            password_hash,
            email,
            role,
            quota_bytes,
            used_bytes,
            language,
            is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [adminUsername, passwordHash, adminEmail, 'admin', 10737418240, 0, 'en', 1]
    );

    console.log(`Admin account created: "${[adminUsername, passwordHash, adminEmail, 'admin', 10737418240, 0, 'en', 1]}".`);

    if (getEnv('ADMIN_PASSWORD')) {
        console.log(`Admin account created: "${adminUsername}".`);
    } else {
        console.log(
            `Admin account created with default development credentials. Username: ${adminUsername}, Password: ${adminPassword}`
        );
    }
}

async function initDatabase(options = {}) {
    console.log('Initializing database...');

    const schemaPath = path.join(__dirname, 'schema.sql');
    const rawSchema = fs.readFileSync(schemaPath, 'utf8');
    const schema = normalizeSchema(rawSchema);
    const { config: serverConfig, database } = buildConfig(false);
    const databaseName = database || getEnv('DB_NAME', 'MYSQL_DATABASE', 'DATABASE_NAME');

    let serverConnection;
    let dbConnection;

    try {
        if (!databaseName) {
            throw new Error('Missing database name. Set DB_NAME in .env.');
        }

        serverConnection = await mysql.createConnection(serverConfig);
        await serverConnection.query(
            `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        await serverConnection.end();
        serverConnection = null;

        const { config: dbConfig } = buildConfig(true);
        dbConnection = await mysql.createConnection(dbConfig);
        await executeSchemaStatements(dbConnection, schema);
        await ensureAdminUser(dbConnection, {
            forceCreate: options.forceAdminCreation === true
        });

        console.log('Database initialized successfully.');
    } catch (error) {
        console.error('Database initialization failed:', error);
        process.exitCode = 1;
    } finally {
        if (serverConnection) {
            await serverConnection.end();
        }
        if (dbConnection) {
            await dbConnection.end();
        }
    }
}

if (require.main === module) {
    initDatabase();
}

module.exports = {
    initDatabase,
    ensureAdminUser
};
