const jwt = require('jsonwebtoken');
const User = require('../models/User');

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || secret === 'change-me') {
    throw new Error('JWT_SECRET must be set to a random string of at least 32 characters.');
  }
  return secret;
}

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role, tv: user.tokenVersion || 0 }, jwtSecret(), {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_EXPIRES || '7d',
  });
}

// Resolves the user for a token, rejecting tokens revoked by logout or a password change.
async function userFromToken(token) {
  const payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
  const user = await User.findById(payload.id);
  if (!user) return null;
  if (user.isActive === false) return null;
  if ((payload.tv || 0) !== (user.tokenVersion || 0)) return null;
  return user;
}

function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

function setAuthCookie(res, token) {
  res.cookie('token', token, cookieOptions());
}

function clearAuthCookie(res) {
  res.clearCookie('token', { ...cookieOptions(), maxAge: 0 });
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.token || null;
}

async function optionalAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return next();
  try {
    req.user = await userFromToken(token);
  } catch {
    req.user = null;
  }
  next();
}

async function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });
  try {
    const user = await userFromToken(token);
    if (!user) return res.status(401).json({ message: 'Session expired. Please sign in again.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Session expired. Please sign in again.' });
  }
}

const STAFF_ROLES = ['admin', 'manager', 'staff'];

function requireAdmin(req, res, next) {
  if (!req.user || !STAFF_ROLES.includes(req.user.role)) {
    return res.status(403).json({ message: 'Admin access required.' });
  }
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user || !STAFF_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: 'Admin access required.' });
    }
    if (req.user.role === 'admin') return next();
    const perms = req.user.permissions || [];
    if (perms.includes(permission) || perms.includes('all')) return next();
    return res.status(403).json({ message: 'You do not have permission for this action.' });
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Only an administrator can do this.' });
    }
    next();
  };
}

module.exports = {
  jwtSecret,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  optionalAuth,
  requireAuth,
  requireAdmin,
  requirePermission,
  requireRole,
  STAFF_ROLES,
};
