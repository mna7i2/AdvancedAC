'use strict';
const { z } = require('zod');

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => (i.path.length ? i.path.join('.') + ': ' : '') + i.message).join('; ');
    throw Object.assign(new Error(msg), { status: 400 });
  }
  return r.data;
}

const page = (q) => {
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);
  return { limit, offset };
};

const uuid = z.string().uuid();
const notFound = (what = 'not found') => Object.assign(new Error(what), { status: 404 });
const forbidden = (what = 'forbidden') => Object.assign(new Error(what), { status: 403 });

/** Audit context from a dashboard request. */
const actor = (req) => {
  const acting = !!(req.user.platform && req.user.platform.acting);
  return { orgId: req.user.orgId, actorType: acting ? 'platform' : 'admin', actorId: req.user.id,
    actorName: acting ? `${req.user.name} (Sentinel support)` : req.user.name, ip: req.ip };
};

module.exports = { h, parse, page, uuid, notFound, forbidden, actor, z };
