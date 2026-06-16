'use strict';
const express = require('express');
const router     = require('express').Router();
const controller = require('../controllers/analyzerController');

// Request logger
router.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

router.post  ('/analyze/:username',  controller.analyzeProfile);
router.get   ('/profiles',           controller.getAllProfiles);
router.get   ('/profiles/:username', controller.getProfileByUsername);
router.delete('/profiles/:username', controller.deleteProfile);
router.get   ('/stats',              controller.getAnalyticsStats);

// 404 fallback
router.use((_req, res) => res.status(404).json({
  success: false,
  message: 'Endpoint not found.',
  available: ['POST /api/analyze/:username', 'GET /api/profiles', 'GET /api/profiles/:username', 'DELETE /api/profiles/:username', 'GET /api/stats'],
}));

module.exports = router;
