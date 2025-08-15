const mysql = require('mysql2/promise');

const connectDB = async () => {

    const dbConfig = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        socketPath: process.env.DB_SOCKET
    };
    const connection = await mysql.createConnection(dbConfig);
    console.log('MySQL Connected');

    const initializeTables = async () => {
        const queries = [
            `CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                verified BOOLEAN DEFAULT FALSE,
                verification_token VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS tools (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                location VARCHAR(255),
                user_manual_path VARCHAR(255),
                user_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )`,
            `CREATE TABLE IF NOT EXISTS tool_images (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tool_id INT,
                image_path VARCHAR(255) NOT NULL,
                FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE
            )`
        ];

        for (const query of queries) {
            try {
                await connection.execute(query);
            } catch (err) {
                console.error('Error creating table:', err);
                throw err;
            }
        }
        console.log('Tables checked/created');
    };

    await initializeTables();
    return connection;
};

module.exports = connectDB;