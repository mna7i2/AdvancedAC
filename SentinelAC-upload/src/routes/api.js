'use strict';
const express = require('express');
const { requireAuth } = require('../middleware/auth');

/**
 * Dashboard API (/api/v1). Every route below `requireAuth` is session-authenticated, CSRF-protected
 * (custom header) and org-scoped; each route additionally checks its own permission.
 */
const router = express.Router();
router.use(express.json({ limit: '1mb' }));

router.use(require('./api/auth'));                // /auth/*, /meta (own auth handling)
router.use(require('./api/bans'));                // includes public /public/appeal (no auth)
router.use(requireAuth);
router.use(require('./api/overview'));
router.use(require('./api/servers').router);
router.use(require('./api/players').router);
router.use(require('./api/detections').router);
router.use(require('./api/evidence'));
router.use(require('./api/admin'));

module.exports = router;
