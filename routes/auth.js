const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');

module.exports = (db, app) => {
    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    // Register
    app.post('/register', async (req, res) => {
        const { email, password } = req.body;
        try {
            const hash = await bcrypt.hash(password, 10);
            const token = crypto.randomBytes(32).toString('hex');
            await db.query('INSERT INTO users (email, password_hash, verification_token) VALUES (?, ?, ?)', [email, hash, token]);
            await transporter.sendMail({
                to: email,
                subject: 'Verify Your Email',
                html: `<a href="http://${process.env.SERVER_HOST}/verify?token=${token}">Verify Email</a>`
            });
            res.send('Verification email sent');
        } catch (err) {
            res.status(500).send('Server error');
        }
    });

    // Verify email
    app.get('/verify', async (req, res) => {
        const { token } = req.query;
        const [result] = await db.query('UPDATE users SET verified = TRUE, verification_token = NULL WHERE verification_token = ?', [token]);
        if (result.affectedRows === 0) return res.status(400).send('Invalid or expired token');
        res.send('Email verified. <a href="/login">Login</a>');
    });

    // Login
    app.post('/login', async (req, res) => {
        const { email, password } = req.body;
        const [results] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (results.length === 0 || !results[0].verified) return res.status(400).send('Invalid email or unverified account');
        const match = await bcrypt.compare(password, results[0].password_hash); // Fixed to compare password_hash
        if (!match) return res.status(400).send('Invalid password');
        const token = jwt.sign({ id: results[0].id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
        });
        res.json({ ok: true });
    });
};