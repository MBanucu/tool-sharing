const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

module.exports = (db, app) => {
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, 'public/uploads/');
        },
        filename: (req, file, cb) => {
            cb(null, Date.now() + path.extname(file.originalname));
        }
    });
    const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

    // Search tools
    app.get('/search', async (req, res) => {
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
        const [results] = await db.query(searchQuery, [`%${query}%`, `%${query}%`]);
        res.render('search_results', { tools: results, query, user: req.user });
    });

    // Tool details
    app.get('/tool/:id', async (req, res) => {
        const { id } = req.params;
        const [toolResults] = await db.query('SELECT * FROM tools WHERE id = ?', [id]);
        if (toolResults.length === 0) return res.status(404).send('Tool not found');
        const [imageResults] = await db.query('SELECT image_path FROM tool_images WHERE tool_id = ?', [id]);
        res.render('tool_details', { tool: toolResults, images: imageResults, user: req.user });
    });

    // Upload tool (authenticated)
    app.post('/upload', (req, res, next) => {
        if (!req.user) return res.status(401).send('Unauthorized');
        next();
    }, upload.fields([{ name: 'images', maxCount: 5 }, { name: 'manual', maxCount: 1 }]), async (req, res) => {
        const { title, description, location } = req.body;
        const manualPath = req.files['manual'] ? req.files['manual'][0].path.replace('public/', '') : null;
        const [result] = await db.query('INSERT INTO tools (title, description, location, user_manual_path, user_id) VALUES (?, ?, ?, ?, ?)',
            [title, description, location, manualPath, req.user.id]);
        const toolId = result.insertId;
        if (req.files['images']) {
            const imageInserts = req.files['images'].map(file => [toolId, file.path.replace('public/', '')]);
            await db.query('INSERT INTO tool_images (tool_id, image_path) VALUES ?', [imageInserts]);
            res.redirect('/search');
        } else {
            res.redirect('/search');
        }
    });

    // Delete tool (authenticated)
    app.delete('/delete/:id', async (req, res) => {
        if (!req.user) return res.status(401).send('Unauthorized');
        const toolId = req.params.id;

        try {
            // Check ownership and fetch tool details
            const [toolResults] = await db.execute('SELECT user_id, user_manual_path FROM tools WHERE id = ?', [toolId]);
            if (toolResults.length === 0) return res.status(404).send('Tool not found');
            if (toolResults[0].user_id !== req.user.id) return res.status(403).send('Unauthorized to delete this tool');

            // Delete manual file if it exists
            if (toolResults[0].user_manual_path) {
                const manualPath = path.join(__dirname, '..', 'public', toolResults[0].user_manual_path);
                try {
                    await fs.access(manualPath);
                    await fs.unlink(manualPath);
                } catch (err) {
                    console.warn('Manual file not found or could not be deleted:', err.message);
                }
            }

            // Fetch and delete image files
            const [imageResults] = await db.execute('SELECT image_path FROM tool_images WHERE tool_id = ?', [toolId]);
            for (const image of imageResults) {
                const imagePath = path.join(__dirname, '..', 'public', image.image_path);
                try {
                    await fs.access(imagePath);
                    await fs.unlink(imagePath);
                } catch (err) {
                    console.warn('Image file not found or could not be deleted:', err.message);
                }
            }

            // Delete the tool from the database
            await db.execute('DELETE FROM tools WHERE id = ?', [toolId]);
            res.json({ ok: true });
        } catch (err) {
            console.error('Error deleting tool:', err);
            res.status(500).send('Error deleting tool');
        }
    });
};