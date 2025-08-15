const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const checkUser = require('./middleware/auth');

dotenv.config();

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(checkUser);
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('port', port); // Set port for use in routes

// Initialize database connection
(async () => {
    try {
        const db = await connectDB();
        app.set('db', db); // Attach database connection to app

        // Import and mount routes with database
        require('./routes/index')(db, app);
        require('./routes/auth')(db, app);
        require('./routes/tools')(db, app);

        // app.use('/', indexRoutes);
        // app.use('/auth', authRoutes);
        // app.use('/tools', toolRoutes);
        // app.use('/', authRoutes);
        // app.use('/', toolRoutes);

        // Frontend routes
        app.get('/', (req, res) => res.render('search_results', { tools: [], query: '', user: req.user }));
        app.get('/register', (req, res) => res.render('register', { user: req.user }));
        app.get('/login', (req, res) => res.render('login', { user: req.user }));
        app.get('/upload', (req, res) => {
            if (!req.user) return res.status(401).send('Unauthorized');
            res.render('upload', { user: req.user });
        });

        app.listen(port, () => {
            console.log(`Server running on http://localhost:${port}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
    }
})();