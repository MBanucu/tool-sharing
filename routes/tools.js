const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');

async function checkFileExists(filePath) {
    try {
        await fs.access(path.join('public', filePath));
        return true; // File exists
    } catch {
        return false; // File does not exist
    }
}

function getPostfixPath(originalPath, postfix) {
    const ext = path.extname(originalPath); // Get the file extension (e.g., '.jpg')
    const filename = path.basename(originalPath, ext); // Get the filename without extension (e.g., 'image')
    return path.join(path.dirname(originalPath), `${filename}_${postfix}${ext}`);
}

function getThumbnailPath(originalPath) {
    return getPostfixPath(originalPath, 'thumb');
}

function getPreviewPath(originalPath) {
    return getPostfixPath(originalPath, 'preview');
}

async function createThumbnail(originalPath) {
    const thumbnailPath = getThumbnailPath(originalPath);
    await sharp(path.join('public', originalPath))
        .resize(200, 200, { fit: 'cover' })
        .toFormat('jpeg', { quality: 80 })
        .toFile(path.join('public', thumbnailPath));
}

async function createPreview(originalPath) {
    const previewPath = getPreviewPath(originalPath);
    await sharp(path.join('public', originalPath))
        .resize(null, null, { fit: 'cover', height: 300, withoutEnlargement: true })
        .toFormat('jpeg', { quality: 80 })
        .toFile(path.join('public', previewPath));
}

async function checkThumbnail(originalPath) {
    const thumbnailPath = getThumbnailPath(originalPath);

    if (await checkFileExists(thumbnailPath)) {
        return thumbnailPath;
    }

    await createThumbnail(originalPath);
    return thumbnailPath;
}

async function checkPreview(originalPath) {
    const previewPath = getPreviewPath(originalPath);

    if (await checkFileExists(previewPath)) {
        return previewPath;
    }

    await createPreview(originalPath);
    return previewPath;
}

module.exports = (db, app) => {
    const storage = multer.diskStorage({
        destination: async (req, file, cb) => {
            const uploadPath = path.join('public', 'uploads');
            try {
                await fs.access(uploadPath);
            } catch (err) {
                await fs.mkdir(uploadPath, { recursive: true });
                console.log('Created uploads directory:', uploadPath);
            }
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
        for (const tool of results) {
            tool.image_path = await checkThumbnail(tool.image_path);
        }
        res.render('search_results', { tools: results, query, user: req.user });
    });

    // Search users by email
    app.get('/search/users', async (req, res) => {
        const { query } = req.query;
        const [results] = await db.query('SELECT id, email FROM users WHERE email LIKE ?', [`%${query}%`]);
        res.render('search_users', { users: results, query, user: req.user });
    });

    // User details (list tools by user)
    app.get('/users/:id', async (req, res) => {
        const userId = req.params.id;
        const [userResult] = await db.query('SELECT id, email FROM users WHERE id = ?', [userId]);
        if (userResult.length === 0) return res.status(404).send('User not found');

        const searchQuery = `
            SELECT t.*, i.image_path 
            FROM tools t 
            LEFT JOIN (
                SELECT tool_id, MIN(id) as min_id 
                FROM tool_images 
                GROUP BY tool_id
            ) sub ON t.id = sub.tool_id 
            LEFT JOIN tool_images i ON sub.min_id = i.id 
            WHERE t.user_id = ?
        `;
        const [tools] = await db.query(searchQuery, [userId]);
        for (const tool of tools) {
            tool.image_path = await checkThumbnail(tool.image_path);
        }
        res.render('user_details', { user: userResult[0], tools, currentUser: req.user });
    });

    // Tool details
    app.get('/tool/:id', async (req, res) => {
        const { id } = req.params;
        const [toolResults] = await db.query('SELECT * FROM tools WHERE id = ?', [id]);
        if (toolResults.length === 0) return res.status(404).send('Tool not found');
        const [imageResults] = await db.query('SELECT image_path FROM tool_images WHERE tool_id = ?', [id]);
        for (const image of imageResults) {
            image.image_path_preview = await checkPreview(image.image_path);
        }
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
            const imageInserts = [];
            for (const file of req.files['images']) {
                const originalPath = file.path;
                await createThumbnail(originalPath.replace('public/', ''));

                imageInserts.push([toolId, originalPath.replace('public/', '')]); // Store original path
            }
            await db.query('INSERT INTO tool_images (tool_id, image_path) VALUES ?', [imageInserts]);
        }
        res.redirect('/search');
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
                const imagePath = path.join('public', image.image_path);
                try {
                    await fs.access(imagePath);
                    await fs.unlink(imagePath);
                } catch (err) {
                    console.warn('Image file not found or could not be deleted:', err.message);
                }
                const filename = path.basename(imagePath);
                const thumbnailPath = getThumbnailPath(image.image_path);
                const thumbnailPathDisk = path.join('public', thumbnailPath);
                try {
                    await fs.access(thumbnailPathDisk);
                    await fs.unlink(thumbnailPathDisk);
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