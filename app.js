const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// MySQL connection
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    socketPath: process.env.DB_SOCKET
});

// Table initialization
const initializeTables = () => {
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

    queries.forEach(query => {
        db.query(query, (err) => {
            if (err) {
                console.error('Error creating table:', err);
                throw err;
            }
        });
    });
    console.log('Tables checked/created');
};

// Connect to MySQL and initialize tables
db.connect(err => {
    if (err) {
        console.error('MySQL Connection Error:', err);
        throw err;
    }
    console.log('MySQL Connected');
    initializeTables();
});

// Multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// Email transporter
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Middleware to check user authentication
const checkUser = (req, res, next) => {
    const token = req.cookies.token;
    if (token) {
        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (!err) {
                req.user = user;
            }
            next();
        });
    } else {
        next();
    }
};

app.use(require('cookie-parser')());
// Apply checkUser to all routes
app.use(checkUser);

// Routes

// Register
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        const token = crypto.randomBytes(32).toString('hex');
        db.query('INSERT INTO users (email, password_hash, verification_token) VALUES (?, ?, ?)', [email, hash, token], err => {
            if (err) return res.status(500).send('Error registering user');
            transporter.sendMail({
                to: email,
                subject: 'Verify Your Email',
                html: `<a href="http://localhost:${port}/verify?token=${token}">Verify Email</a>`
            });
            res.send('Verification email sent');
        });
    } catch (err) {
        res.status(500).send('Server error');
    }
});

// Verify email
app.get('/verify', (req, res) => {
    const { token } = req.query;
    db.query('UPDATE users SET verified = TRUE, verification_token = NULL WHERE verification_token = ?', [token], (err, result) => {
        if (err || result.affectedRows === 0) return res.status(400).send('Invalid or expired token');
        res.send('Email verified. <a href="/login">Login</a>');
    });
});

// Login
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err || results.length === 0 || !results[0].verified) return res.status(400).send('Invalid email or unverified account');
        const match = await bcrypt.compare(password, results[0].password_hash);
        if (!match) return res.status(400).send('Invalid password');
        const token = jwt.sign({ id: results[0].id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',    // or 'strict' depending on your flows
            maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
        })
        res.json({ ok: true });
    });
});

app.get('/logout', (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    });
    req.user = undefined;
    res.redirect('/');
});

// Search tools
app.get('/search', (req, res) => {
    const { query } = req.query;
    const searchQuery = `
    SELECT t.*, i.image_path 
    FROM tools t 
    LEFT JOIN (
      SELECT tool_id, MIN(id) as min_id 
      FROM tool_images 
      GROUP BY tool_id
    ) sub ON t.id = sub.tool_id 
    LEFT JOIN tool_images i ON sub.min_id = i.id 
    WHERE t.title LIKE ? OR t.description LIKE ?
  `;
    db.query(searchQuery, [`%${query}%`, `%${query}%`], (err, results) => {
        if (err) return res.status(500).send('Error searching tools');
        res.render('search_results', { tools: results, query, user: req.user });
    });
});

// Tool details
app.get('/tool/:id', (req, res) => {
    const { id } = req.params;
    db.query('SELECT * FROM tools WHERE id = ?', [id], (err, toolResults) => {
        if (err || toolResults.length === 0) return res.status(404).send('Tool not found');
        db.query('SELECT image_path FROM tool_images WHERE tool_id = ?', [id], (err, imageResults) => {
            if (err) return res.status(500).send('Error fetching images');
            res.render('tool_details', { tool: toolResults[0], images: imageResults, user: req.user });
        });
    });
});

// Upload tool (authenticated)
app.post('/upload', (req, res, next) => {
    if (!req.user) return res.status(401).send('Unauthorized');
    next();
}, upload.fields([{ name: 'images', maxCount: 5 }, { name: 'manual', maxCount: 1 }]), (req, res) => {
    const { title, description, location } = req.body;
    const manualPath = req.files['manual'] ? req.files['manual'][0].path.replace('public/', '') : null;
    db.query('INSERT INTO tools (title, description, location, user_manual_path, user_id) VALUES (?, ?, ?, ?, ?)',
        [title, description, location, manualPath, req.user.id], (err, result) => {
            if (err) return res.status(500).send('Error uploading tool');
            const toolId = result.insertId;
            if (req.files['images']) {
                const imageInserts = req.files['images'].map(file => [toolId, file.path.replace('public/', '')]);
                db.query('INSERT INTO tool_images (tool_id, image_path) VALUES ?', [imageInserts], err => {
                    if (err) return res.status(500).send('Error uploading images');
                    res.redirect('/search');
                });
            } else {
                res.redirect('/search');
            }
        });
});

// Frontend routes
app.get('/', (req, res) => res.render('search_results', { tools: [], query: '', user: req.user }));
app.get('/register', (req, res) => res.render('register', { user: req.user }));
app.get('/login', (req, res) => res.render('login', { user: req.user }));
app.get('/upload', (req, res) => {
    if (!req.user) return res.status(401).send('Unauthorized');
    res.render('upload', { user: req.user });
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));