const express = require('express');

module.exports = (db, app) => {
    app.get('/', (req, res) => res.render('search_results', { tools: [], query: '', user: req.user }));
};