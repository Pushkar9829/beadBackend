const jwt = require('jsonwebtoken');
const User = require('../models/User');

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES || '7d',
  });
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
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(payload.id);
  } catch {
    req.user = null;
  }
  next();
}

async function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
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

module.exports = {
  signToken,
  setAuthCookie,
  clearAuthCookie,
  optionalAuth,
  requireAuth,
  requireAdmin,
  requirePermission,
  STAFF_ROLES,
};
